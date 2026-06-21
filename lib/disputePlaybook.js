// ─────────────────────────────────────────────
//  CREDITOS — AI Dispute Playbook (tradeline analysis engine)
//  lib/disputePlaybook.js
//
//  Layers a per-tradeline analysis on top of the deterministic recommender in
//  disputeStrategy.js. Given a structured account (the fields a credit report
//  exposes) it derives the dispute signals, detects likely reporting problems,
//  produces a 0-100 Dispute Strength Score with a factor breakdown and a
//  High/Medium/Low label, a 6-step action plan, a categorized document
//  checklist, and a deterministic Case Analyst summary.
//
//  Pure functions only — no I/O, no AI. The optional live-LLM Case Analyst
//  narrative is composed in routes/disputes.js using caseAnalystPrompt() and
//  falls back to buildCaseAnalyst() here when AI is unavailable.
// ─────────────────────────────────────────────

import { recommendStrategy, STRATEGIES } from './disputeStrategy.js';
import { getTemplate } from './disputeLibrary.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const num = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// Operational metadata per strategy: who receives the letter, the response
// window the law gives them, the standard next move, and the escalation path.
export const STRATEGY_PLAYS = {
  [STRATEGIES.FACTUAL]:     { recipient: 'bureau',    responseDays: 30, basis: 'FCRA §611', followUp: STRATEGIES.MOV,        escalation: STRATEGIES.CFPB },
  [STRATEGIES.METRO2]:      { recipient: 'bureau',    responseDays: 30, basis: 'FCRA §611 / Metro 2', followUp: STRATEGIES.FURNISHER, escalation: STRATEGIES.CFPB },
  [STRATEGIES.VALIDATION]:  { recipient: 'collector', responseDays: 30, basis: 'FDCPA §809(b)', followUp: STRATEGIES.FCRA,   escalation: STRATEGIES.CFPB },
  [STRATEGIES.FURNISHER]:   { recipient: 'furnisher', responseDays: 30, basis: 'FCRA §623(b)', followUp: STRATEGIES.MOV,     escalation: STRATEGIES.CFPB },
  [STRATEGIES.IDENTITY]:    { recipient: 'bureau',    responseDays: 4,  basis: 'FCRA §605B',  followUp: STRATEGIES.FCRA,     escalation: STRATEGIES.CFPB },
  [STRATEGIES.PERMISSIBLE]: { recipient: 'bureau',    responseDays: 30, basis: 'FCRA §604',   followUp: STRATEGIES.FURNISHER, escalation: STRATEGIES.CFPB },
  [STRATEGIES.GOODWILL]:    { recipient: 'furnisher', responseDays: 30, basis: 'Creditor goodwill', followUp: STRATEGIES.MOV, escalation: STRATEGIES.FCRA },
  [STRATEGIES.MOV]:         { recipient: 'bureau',    responseDays: 15, basis: 'FCRA §611(a)(7)', followUp: STRATEGIES.FURNISHER, escalation: STRATEGIES.CFPB },
  [STRATEGIES.FCRA]:        { recipient: 'bureau',    responseDays: 30, basis: 'FCRA §611',   followUp: STRATEGIES.MOV,      escalation: STRATEGIES.CFPB },
  [STRATEGIES.PROCEDURAL]:  { recipient: 'bureau',    responseDays: 30, basis: 'FCRA §611',   followUp: STRATEGIES.MOV,      escalation: STRATEGIES.CFPB },
  [STRATEGIES.CFPB]:        { recipient: 'cfpb',      responseDays: 15, basis: 'CFPB / 12 CFR 1006', followUp: 'State Attorney General complaint', escalation: 'Consumer attorney (FCRA §616/§617)' },
};

// Document checklist groups (mirrors the spec's Document Checklist).
export const DOCUMENT_GROUPS = {
  identity: { id: 'identity', label: 'Identity Verification', items: ['Driver license or state ID', 'Passport (if available)', 'Social Security card'] },
  address:  { id: 'address',  label: 'Address Verification',  items: ['Utility bill (last 60 days)', 'Bank statement', 'Lease or mortgage statement'] },
  payment:  { id: 'payment',  label: 'Payment Verification',  items: ['Bank statements', 'Payment receipts / confirmations', 'Cancelled checks or transaction records'] },
  fraud:    { id: 'fraud',    label: 'Fraud Verification',    items: ['FTC Identity Theft Report (IdentityTheft.gov)', 'Police report', 'Notarized fraud affidavit'] },
};

function yearsSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
}

function truthy(v) {
  if (typeof v === 'string') return !['', 'no', 'false', 'none', 'n'].includes(v.trim().toLowerCase());
  return !!v;
}

/**
 * analyzeTradeline(account) — turn a structured account into dispute signals
 * plus a list of detected reporting problems.
 *
 * account (all optional): {
 *   accountType, furnisher|creditor, balance, creditLimit, highBalance,
 *   paymentHistory, dateOpened, dateClosed, dateOfFirstDelinquency,
 *   accountStatus, collectionStatus, chargeOffStatus, recognized (bool),
 *   fraud (bool), duplicate (bool), errorType, inquiryHistory,
 *   previousDisputeAttempts (number), supportingDocumentation (string[])
 * }
 */
export function analyzeTradeline(account = {}) {
  const a = account || {};
  const balance = num(a.balance);
  const limit = num(a.creditLimit);
  const dofdYears = yearsSince(a.dateOfFirstDelinquency);
  const isCollection = truthy(a.collectionStatus) || /collection/i.test(String(a.accountType || a.accountStatus || ''));
  const isChargeOff = truthy(a.chargeOffStatus) || /charge[- ]?off/i.test(String(a.accountStatus || ''));
  const isInquiry = /inquiry/i.test(String(a.accountType || '')) || (!!a.inquiryHistory && !a.accountType);
  const notMine = a.recognized === false || truthy(a.fraud);
  const disputedBefore = (num(a.previousDisputeAttempts) || 0) > 0 || truthy(a.disputedBefore);
  const docsArr = Array.isArray(a.supportingDocumentation) ? a.supportingDocumentation.filter(Boolean) : [];
  // Honor the questionnaire's boolean hasDocuments when no explicit doc list is given.
  const docs = docsArr.length ? docsArr : (truthy(a.hasDocuments) ? ['(provided)'] : []);

  // ── Detected reporting problems (drive the strength score + analyst summary) ──
  const issues = [];
  const add = (code, label, severity) => issues.push({ code, label, severity });

  if (truthy(a.fraud) || a.recognized === false) add('not-recognized', 'Account is not recognized by the consumer (possible fraud / not mine).', 'high');
  if (balance != null && limit != null && limit > 0 && balance > limit) add('balance-exceeds-limit', 'Reported balance exceeds the credit limit — a Metro 2 field inconsistency.', 'high');
  if (isChargeOff && balance != null && balance > 0 && truthy(a.stillAccruing)) add('chargeoff-accruing', 'Charge-off shows an increasing balance, which Metro 2 does not permit.', 'high');
  if ((isCollection || isChargeOff) && !a.dateOfFirstDelinquency) add('missing-dofd', 'No Date of First Delinquency reported — required to age the item correctly (FCRA §605).', 'medium');
  if (dofdYears != null && dofdYears >= 7) add('obsolete', `Item is past the ${'~7-year'} FCRA §605 reporting window (DOFD ${dofdYears.toFixed(1)}y ago).`, 'high');
  if (truthy(a.duplicate)) add('duplicate', 'Account appears to be reported more than once.', 'medium');
  if (a.errorType === 'incorrect-date' || /date/i.test(String(a.errorType || ''))) add('date-error', 'Reported dates (opened / reported / DOFD) appear inaccurate.', 'medium');
  if (a.errorType === 'incorrect-status' || /status/i.test(String(a.errorType || ''))) add('status-error', 'Account status appears inaccurate.', 'medium');
  if (a.errorType === 'incorrect-balance' && !(balance != null && limit != null && balance > limit)) add('balance-error', 'Reported balance appears inaccurate.', 'medium');
  if (isInquiry && notMine) add('unauthorized-inquiry', 'Hard inquiry without a permissible purpose (FCRA §604).', 'high');

  // ── Map to the recommender's questionnaire vocabulary ──
  let disputeType = 'other';
  if (notMine && !isInquiry) disputeType = 'identity';
  else if (isInquiry) disputeType = 'inquiry';
  else if (isCollection) disputeType = 'collection';
  else if (isChargeOff) disputeType = 'chargeoff';
  else if (/personal|address|name|ssn|employ/i.test(String(a.accountType || a.errorType || ''))) disputeType = 'personal';
  else disputeType = 'late';

  let problem = 'other';
  if (truthy(a.fraud)) problem = 'fraud';
  else if (a.recognized === false) problem = 'not-mine';
  else if (truthy(a.duplicate)) problem = 'duplicate';
  else if (issues.some(i => i.code === 'balance-exceeds-limit' || i.code === 'balance-error')) problem = 'incorrect-balance';
  else if (issues.some(i => i.code === 'date-error')) problem = 'incorrect-date';
  else if (issues.some(i => i.code === 'status-error')) problem = 'incorrect-status';
  else if (a.errorType) problem = String(a.errorType);

  // Explicit questionnaire fields (disputeType/problem/accountAge/etc.) win over
  // values derived from raw tradeline fields, so /recommend and /playbook agree.
  const signals = {
    disputeType: a.disputeType ? String(a.disputeType) : disputeType,
    problem: a.problem ? String(a.problem) : problem,
    disputedBefore,
    bureau: a.bureau || 'All',
    accountAge: a.accountAge ? String(a.accountAge)
      : (dofdYears != null && dofdYears >= 7) ? 'obsolete'
      : (yearsSince(a.dateOpened) != null && yearsSince(a.dateOpened) >= 4 ? 'old' : 'recent'),
    hasDocuments: docs.length > 0,
    furnisherType: a.furnisherType ? String(a.furnisherType) : (isCollection ? 'collector' : 'original'),
  };

  return { signals, issues, derived: { balance, limit, dofdYears, isCollection, isChargeOff, isInquiry, notMine, disputedBefore, docs } };
}

/**
 * scoreTradeline — Dispute Strength Score (0-100) with the spec's factor
 * breakdown and a High/Medium/Low probability label.
 */
export function scoreTradeline(analysis, recommendation) {
  const { issues, derived } = analysis;
  const rec = recommendation;
  const hi = issues.filter(i => i.severity === 'high').length;
  const med = issues.filter(i => i.severity === 'medium').length;

  const strongType = [STRATEGIES.IDENTITY, STRATEGIES.PERMISSIBLE].includes(rec.primary)
    || analysis.signals.accountAge === 'obsolete';
  const weakType = rec.primary === STRATEGIES.GOODWILL;

  const factors = {
    reportingInconsistencies: clamp(42 + hi * 20 + med * 10, 0, 100),
    documentationQuality:     derived.docs.length ? clamp(58 + derived.docs.length * 12, 0, 100) : 34,
    evidenceStrength:         clamp((strongType ? 84 : weakType ? 46 : 70) + (derived.docs.length ? 8 : 0), 0, 100),
    ageOfAccount:             analysis.signals.accountAge === 'obsolete' ? 95 : analysis.signals.accountAge === 'old' ? 70 : 55,
    typeOfError:              strongType ? 90 : weakType ? 42 : 74,
    previousResults:          derived.disputedBefore ? 50 : 78,
  };

  const weights = {
    reportingInconsistencies: 0.26, documentationQuality: 0.18, evidenceStrength: 0.2,
    ageOfAccount: 0.14, typeOfError: 0.12, previousResults: 0.1,
  };
  const composite = Object.keys(weights).reduce((s, k) => s + factors[k] * weights[k], 0);

  // Blend the factor composite with the recommender's own confidence so the
  // headline number stays consistent with the chosen strategy.
  const score = clamp(Math.round(0.55 * composite + 0.45 * (rec.confidence ?? composite)), 1, 99);
  const probability = score >= 80 ? 'High' : score >= 55 ? 'Medium' : 'Low';
  return { score, probability, factors };
}

/** buildActionPlan — the spec's 6-step recommended action plan. */
export function buildActionPlan(recommendation, analysis) {
  const rec = recommendation;
  const play = STRATEGY_PLAYS[rec.primary] || STRATEGY_PLAYS[STRATEGIES.FACTUAL];
  const tmpl = rec.recommendedTemplate;
  return [
    { step: 1, title: 'Recommended dispute method', detail: rec.primary, meta: { recipient: play.recipient, basis: play.basis } },
    { step: 2, title: 'Supporting documents needed', detail: rec.suggestedDocuments || [] },
    { step: 3, title: 'Letter to generate', detail: tmpl ? tmpl.label : 'Dispute letter', meta: { templateId: rec.recommendedTemplateId } },
    { step: 4, title: 'Expected response timeline', detail: `${play.responseDays} days (${play.basis} window)`, meta: { responseDays: play.responseDays } },
    { step: 5, title: 'Follow-up action', detail: play.followUp },
    { step: 6, title: 'Escalation path if unsuccessful', detail: (rec.escalationPath || []).join(' → ') || play.escalation },
  ];
}

/** buildDocumentChecklist — categorized document groups relevant to the case. */
export function buildDocumentChecklist(recommendation, analysis) {
  const groups = [DOCUMENT_GROUPS.identity, DOCUMENT_GROUPS.address]; // every bureau dispute needs ID + address
  const t = analysis.signals.disputeType;
  if (recommendation.primary === STRATEGIES.IDENTITY || analysis.derived.notMine) groups.push(DOCUMENT_GROUPS.fraud);
  if (['late', 'chargeoff', 'collection'].includes(t) || /balance|payment|date/.test(analysis.signals.problem)) groups.push(DOCUMENT_GROUPS.payment);
  // de-dupe while preserving order
  const seen = new Set();
  return groups.filter(g => (seen.has(g.id) ? false : seen.add(g.id)));
}

/** buildCaseAnalyst — deterministic Case Analyst summary (AI fallback). */
export function buildCaseAnalyst(recommendation, analysis, score) {
  const issues = analysis.issues;
  const top = issues[0];
  const summary = issues.length
    ? `This ${analysis.signals.disputeType} item shows ${issues.length} potential reporting problem${issues.length > 1 ? 's' : ''}${top ? `, most notably: ${top.label}` : ''}`
    : `This ${analysis.signals.disputeType} item has no obvious field-level errors, so removal depends on the furnisher being unable to verify it.`;
  const risks = [];
  if (analysis.signals.disputeType === 'late' && recommendation.primary === STRATEGIES.GOODWILL) risks.push('The mark may be accurate — goodwill is discretionary and not guaranteed.');
  if (analysis.derived.disputedBefore) risks.push('A prior dispute was already "verified," so a plain re-dispute may be dismissed as frivolous — escalate the method instead.');
  if (!analysis.derived.docs.length) risks.push('No supporting documentation attached — adding proof materially raises the odds.');
  if (!risks.length) risks.push('Main risk is a boilerplate "verified" response; be ready to demand the method of verification.');
  return {
    summary,
    recommendedStrategy: recommendation.primary,
    whyStrategy: recommendation.reason,
    risks,
    evidenceNeeded: recommendation.suggestedDocuments || [],
    probabilityScore: score.score,
    probability: score.probability,
    suggestedNextAction: `Generate the "${recommendation.recommendedTemplate?.label || 'dispute'}" letter and send it to the ${(STRATEGY_PLAYS[recommendation.primary] || {}).recipient || 'bureau'}.`,
  };
}

/** buildPlaybook — full deterministic per-tradeline playbook. */
export function buildPlaybook(account = {}) {
  const analysis = analyzeTradeline(account);
  const recommendation = recommendStrategy(analysis.signals);
  const score = scoreTradeline(analysis, recommendation);
  const actionPlan = buildActionPlan(recommendation, analysis);
  const documentChecklist = buildDocumentChecklist(recommendation, analysis);
  const caseAnalyst = buildCaseAnalyst(recommendation, analysis, score);
  return {
    account: {
      furnisher: account.furnisher || account.creditor || null,
      accountType: account.accountType || null,
      disputeType: analysis.signals.disputeType,
    },
    issues: analysis.issues,
    recommendation,
    score,
    actionPlan,
    documentChecklist,
    caseAnalyst,           // deterministic; route may overwrite with AI version
  };
}

/** enrichRecommendation — add playbook score/plan/checklist onto a /recommend result. */
export function enrichRecommendation(recommendation, account = {}) {
  const analysis = analyzeTradeline(account);
  const score = scoreTradeline(analysis, recommendation);
  return {
    ...recommendation,
    score: score.score,
    probability: score.probability,
    scoreFactors: score.factors,
    actionPlan: buildActionPlan(recommendation, analysis),
    documentChecklist: buildDocumentChecklist(recommendation, analysis),
  };
}

/** caseAnalystPrompt — strict-JSON prompt for the optional live-LLM analyst. */
export function caseAnalystPrompt(playbook) {
  return `You are a senior FCRA credit-dispute analyst. A deterministic engine has already chosen the strategy; write the human "Case Analyst" read-out. Use ONLY the facts below — never invent account details, never promise a score change or guaranteed deletion.

ENGINE OUTPUT (ground truth):
- Dispute type: ${playbook.account.disputeType}
- Recommended strategy: ${playbook.recommendation.primary} (backup: ${playbook.recommendation.secondary})
- Strength score: ${playbook.score.score}/100 (${playbook.score.probability} probability)
- Detected issues: ${playbook.issues.map(i => i.label).join(' | ') || 'none detected'}
- Suggested documents: ${(playbook.recommendation.suggestedDocuments || []).join(', ')}

Return ONLY valid JSON in this exact shape:
{
  "summary": "2-3 sentence plain-English read of the account's issues",
  "whyStrategy": "1-2 sentences on why this strategy fits",
  "risks": ["the main weakness or risk", "a second risk if any"],
  "evidenceNeeded": ["document 1", "document 2"],
  "suggestedNextAction": "the single best next step"
}`;
}
