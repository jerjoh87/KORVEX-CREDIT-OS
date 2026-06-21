import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeTradeline, scoreTradeline, buildActionPlan, buildDocumentChecklist,
  buildPlaybook, enrichRecommendation, caseAnalystPrompt, DOCUMENT_GROUPS,
} from '../lib/disputePlaybook.js';
import { recommendStrategy, STRATEGIES } from '../lib/disputeStrategy.js';

const yearsAgo = y => new Date(Date.now() - y * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10);

// ── Tradeline analysis ──────────────────────────────────────────────────────
test('analyze: balance over the credit limit is flagged as a Metro 2 inconsistency', () => {
  const { issues, signals } = analyzeTradeline({ accountType: 'credit-card', balance: 5200, creditLimit: 5000, errorType: 'incorrect-balance' });
  assert.ok(issues.some(i => i.code === 'balance-exceeds-limit' && i.severity === 'high'));
  assert.equal(signals.problem, 'incorrect-balance');
});

test('analyze: a 8-year-old DOFD is flagged obsolete (FCRA §605 window)', () => {
  const { issues, signals } = analyzeTradeline({ collectionStatus: true, dateOfFirstDelinquency: yearsAgo(8) });
  assert.ok(issues.some(i => i.code === 'obsolete'));
  assert.equal(signals.accountAge, 'obsolete');
});

test('analyze: an unrecognized account routes to the identity-theft path', () => {
  const { signals, issues } = analyzeTradeline({ accountType: 'credit-card', recognized: false });
  assert.equal(signals.disputeType, 'identity');
  assert.ok(issues.some(i => i.code === 'not-recognized'));
});

// ── Strength score + probability label ──────────────────────────────────────
test('score: obsolete debt with documentation scores High; weak goodwill scores Low', () => {
  const strongAcct = { collectionStatus: true, dateOfFirstDelinquency: yearsAgo(8), supportingDocumentation: ['DOFD records', 'original statement'] };
  const strong = buildPlaybook(strongAcct);
  assert.equal(strong.score.probability, 'High');
  assert.ok(strong.score.score >= 80);

  const weak = buildPlaybook({ disputeType: 'late', problem: 'other', disputedBefore: true, hasDocuments: false });
  assert.equal(weak.recommendation.primary, STRATEGIES.GOODWILL);
  assert.equal(weak.score.probability, 'Low');
  assert.ok(weak.score.score < strong.score.score);
});

test('score: every factor is present and within 0-100', () => {
  const analysis = analyzeTradeline({ accountType: 'credit-card', balance: 5200, creditLimit: 5000, errorType: 'incorrect-balance' });
  const { score, probability, factors } = scoreTradeline(analysis, recommendStrategy(analysis.signals));
  for (const key of ['reportingInconsistencies', 'documentationQuality', 'evidenceStrength', 'ageOfAccount', 'typeOfError', 'previousResults']) {
    assert.ok(typeof factors[key] === 'number' && factors[key] >= 0 && factors[key] <= 100, `factor ${key} out of range`);
  }
  assert.ok(score >= 1 && score <= 99);
  assert.ok(['High', 'Medium', 'Low'].includes(probability));
});

// ── Action plan ─────────────────────────────────────────────────────────────
test('action plan: always 6 ordered steps ending in an escalation path', () => {
  const pb = buildPlaybook({ collectionStatus: true, problem: 'not-mine' });
  assert.equal(pb.actionPlan.length, 6);
  assert.deepEqual(pb.actionPlan.map(s => s.step), [1, 2, 3, 4, 5, 6]);
  assert.match(pb.actionPlan[3].detail, /\d+ days/);                 // step 4 has a timeline
  assert.equal(pb.actionPlan[2].meta.templateId, pb.recommendation.recommendedTemplateId); // step 3 names the letter
  assert.ok(pb.actionPlan[5].detail.includes(STRATEGIES.CFPB));      // step 6 escalates to CFPB
});

// ── Document checklist ──────────────────────────────────────────────────────
test('checklist: identity + address are always included; fraud added for identity theft', () => {
  const fraud = buildPlaybook({ recognized: false, accountType: 'credit-card' });
  const ids = fraud.documentChecklist.map(g => g.id);
  assert.ok(ids.includes('identity') && ids.includes('address'));
  assert.ok(ids.includes('fraud'));
  // de-duped
  assert.equal(new Set(ids).size, ids.length);
});

// ── /recommend enrichment ───────────────────────────────────────────────────
test('enrichRecommendation: adds score/plan/checklist without dropping base fields', () => {
  const base = recommendStrategy({ disputeType: 'collection', problem: 'not-mine' });
  const rich = enrichRecommendation(base, { disputeType: 'collection', problem: 'not-mine' });
  assert.equal(rich.primary, base.primary);                  // base preserved
  assert.ok(rich.escalationPath.includes(STRATEGIES.CFPB));
  assert.ok(typeof rich.score === 'number');
  assert.ok(['High', 'Medium', 'Low'].includes(rich.probability));
  assert.equal(rich.actionPlan.length, 6);
  assert.ok(Array.isArray(rich.documentChecklist) && rich.documentChecklist.length);
});

// ── Case Analyst (deterministic) + AI prompt ────────────────────────────────
test('case analyst: deterministic summary carries score, risks, and next action', () => {
  const pb = buildPlaybook({ collectionStatus: true, dateOfFirstDelinquency: yearsAgo(8) });
  assert.equal(pb.caseAnalyst.probabilityScore, pb.score.score);
  assert.ok(pb.caseAnalyst.risks.length >= 1);
  assert.ok(pb.caseAnalyst.suggestedNextAction.length > 0);
});

test('caseAnalystPrompt: grounds the model in the engine output and forbids invention', () => {
  const pb = buildPlaybook({ recognized: false, accountType: 'credit-card' });
  const prompt = caseAnalystPrompt(pb);
  assert.match(prompt, /Recommended strategy: Identity Theft Dispute/);
  assert.match(prompt, /Return ONLY valid JSON/);
  assert.match(prompt, /never invent/i);
});
