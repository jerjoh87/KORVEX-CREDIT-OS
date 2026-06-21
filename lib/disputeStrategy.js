// ─────────────────────────────────────────────
//  CREDITOS — Dispute Recommendation Engine
//  lib/disputeStrategy.js
//
//  Deterministic, rules-based strategy selection. No AI, no I/O — given the
//  smart-questionnaire answers it returns a primary + secondary strategy, a
//  confidence score, a plain-English reason, suggested documents, and the
//  best-matching letter template from the library. Also builds a professional
//  CFPB complaint narrative from structured input.
// ─────────────────────────────────────────────

import { getTemplate } from './disputeLibrary.js';

// Canonical strategies (mirrors the spec's recommendation vocabulary).
export const STRATEGIES = {
  METRO2:        'Metro 2 Compliance Dispute',
  FACTUAL:       'Factual Accuracy Dispute',
  VALIDATION:    'Debt Validation Dispute',
  FURNISHER:     'Direct Furnisher Dispute',
  IDENTITY:      'Identity Theft Dispute',
  PROCEDURAL:    'Procedural Request',
  MOV:           'Method of Verification Request',
  GOODWILL:      'Goodwill Strategy',
  CFPB:          'CFPB Escalation',
  FCRA:          'FCRA Investigation Request',
  PERMISSIBLE:   'Permissible Purpose Dispute',
};

const REASONS = {
  [STRATEGIES.IDENTITY]:   'This item resulted from identity theft, so an FCRA §605B block supported by an FTC identity-theft report is the fastest, strongest path to removal.',
  [STRATEGIES.VALIDATION]: 'For a third-party collection you have the right under FDCPA §809(b) to force the collector to validate the debt before paying or before it can keep collecting.',
  [STRATEGIES.METRO2]:     'This account contains reporting-format inconsistencies (balance, dates, or payment grid) commonly associated with Metro 2 reporting violations, which are highly disputable.',
  [STRATEGIES.FACTUAL]:    'The information is factually inaccurate, so a direct FCRA §611 accuracy dispute with the bureau is the appropriate first move.',
  [STRATEGIES.PERMISSIBLE]:'A hard inquiry without your authorization lacks a permissible purpose under FCRA §604 and should be removed.',
  [STRATEGIES.GOODWILL]:   'The mark appears to be accurate, so a goodwill request to the creditor is the realistic route rather than a factual dispute.',
  [STRATEGIES.MOV]:        'You already disputed this once and it was "verified." Demanding the method of verification under FCRA §611(a)(7) exposes whether a real investigation occurred.',
  [STRATEGIES.FCRA]:       'This item needs a documented reinvestigation; an FCRA §611 investigation request puts the bureau on notice to verify every field or delete it.',
  [STRATEGIES.FURNISHER]:  'Disputing directly with the furnisher under FCRA §623(b) targets the source of the inaccurate data.',
};

const DOCS = {
  late:       ['Bank/payment confirmations', 'Cancelled checks', 'Statements showing on-time payment'],
  balance:    ['Most recent statement', 'Payoff/settlement letter', 'Payment receipts'],
  collection: ['Any payment records', 'Prior collector correspondence', 'Proof of mailing'],
  fraud:      ['FTC Identity Theft Report (IdentityTheft.gov)', 'Government ID', 'Police report (if filed)'],
  inquiry:    ['List of inquiries you do not recognize', 'Government ID'],
  personal:   ['Government ID', 'Proof of current address', 'Social Security card'],
  generic:    ['Government ID', 'Any documents supporting your dispute'],
};

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/**
 * recommendStrategy(answers)
 *  answers: {
 *    disputeType: 'late'|'collection'|'chargeoff'|'inquiry'|'personal'|'identity'|'other',
 *    problem: 'not-mine'|'incorrect-balance'|'incorrect-date'|'duplicate'|'already-paid'|'fraud'|'other',
 *    disputedBefore: boolean,
 *    bureau: 'Experian'|'Equifax'|'TransUnion'|'All',
 *    accountAge: 'recent'|'old'|'obsolete' (optional),
 *    hasDocuments: boolean (optional),
 *    furnisherType: 'original'|'collector'|'bureau' (optional)
 *  }
 */
export function recommendStrategy(answers = {}) {
  const a = {
    disputeType: String(answers.disputeType || 'other'),
    problem: String(answers.problem || 'other'),
    disputedBefore: !!answers.disputedBefore,
    bureau: answers.bureau || 'All',
    accountAge: answers.accountAge || 'unknown',
    hasDocuments: !!answers.hasDocuments,
    furnisherType: answers.furnisherType || '',
  };

  let primary, secondary, confidence, docs, templateId;

  // 1) Identity theft / fraud overrides everything.
  if (a.disputeType === 'identity' || a.problem === 'fraud') {
    primary = STRATEGIES.IDENTITY;
    secondary = STRATEGIES.CFPB;
    confidence = 93;
    docs = DOCS.fraud;
    templateId = a.disputeType === 'inquiry' ? 'identity-theft-inquiry' : 'fraudulent-account';

  // 2) Obsolete debt (past 7-year window) → factual deletion.
  } else if (a.accountAge === 'obsolete') {
    primary = STRATEGIES.FACTUAL;
    secondary = STRATEGIES.CFPB;
    confidence = 88;
    docs = ['Records showing the original Date of First Delinquency'];
    templateId = 'out-of-statute-debt';

  // 3) Unauthorized inquiry.
  } else if (a.disputeType === 'inquiry') {
    primary = STRATEGIES.PERMISSIBLE;
    secondary = STRATEGIES.CFPB;
    confidence = 80;
    docs = DOCS.inquiry;
    templateId = 'unauthorized-hard-inquiry';

  // 4) Collections.
  } else if (a.disputeType === 'collection') {
    if (a.problem === 'not-mine') {
      primary = STRATEGIES.VALIDATION; secondary = STRATEGIES.FCRA; confidence = 87; templateId = 'debt-validation';
    } else if (a.problem === 'already-paid') {
      primary = STRATEGIES.GOODWILL; secondary = STRATEGIES.FACTUAL; confidence = 72; templateId = 'paid-collection-removal';
    } else if (a.problem === 'duplicate') {
      primary = STRATEGIES.FACTUAL; secondary = STRATEGIES.FCRA; confidence = 84; templateId = 'duplicate-collection';
    } else {
      primary = STRATEGIES.VALIDATION; secondary = STRATEGIES.FCRA; confidence = 80; templateId = 'collection-verification';
    }
    docs = DOCS.collection;

  // 5) Charge-offs.
  } else if (a.disputeType === 'chargeoff') {
    if (a.problem === 'incorrect-balance') {
      primary = STRATEGIES.METRO2; secondary = STRATEGIES.FURNISHER; confidence = 85; templateId = 'chargeoff-balance-accuracy';
    } else if (a.problem === 'not-mine') {
      primary = STRATEGIES.FURNISHER; secondary = STRATEGIES.VALIDATION; confidence = 82; templateId = 'chargeoff-ownership-validation';
    } else {
      primary = STRATEGIES.METRO2; secondary = STRATEGIES.FCRA; confidence = 83; templateId = 'chargeoff-payment-history';
    }
    docs = DOCS.balance;

  // 6) Personal information.
  } else if (a.disputeType === 'personal') {
    primary = STRATEGIES.FACTUAL;
    secondary = STRATEGIES.FCRA;
    confidence = 78;
    docs = DOCS.personal;
    templateId = a.problem === 'not-mine' ? 'mixed-credit-file' : 'incorrect-personal-information';

  // 7) Late payments / general inaccuracies.
  } else if (a.disputeType === 'late') {
    if (a.problem === 'other') {
      // "accurate but asking for removal" → goodwill
      primary = STRATEGIES.GOODWILL; secondary = STRATEGIES.MOV; confidence = 70; templateId = 'goodwill-late-payment';
      docs = DOCS.late;
    } else if (a.problem === 'incorrect-balance' || a.problem === 'incorrect-date') {
      primary = STRATEGIES.METRO2; secondary = STRATEGIES.FCRA; confidence = 84;
      templateId = a.problem === 'incorrect-date' ? 'incorrect-account-dates' : 'incorrect-balance';
      docs = DOCS.balance;
    } else {
      primary = STRATEGIES.FACTUAL; secondary = STRATEGIES.MOV; confidence = 83; templateId = 'incorrect-late-payment';
      docs = DOCS.late;
    }

  // 8) Everything else.
  } else {
    if (a.problem === 'incorrect-balance' || a.problem === 'incorrect-date' || a.problem === 'duplicate') {
      primary = STRATEGIES.METRO2; secondary = STRATEGIES.FCRA; confidence = 80;
      templateId = a.problem === 'duplicate' ? 'duplicate-collection'
                 : a.problem === 'incorrect-date' ? 'incorrect-account-dates' : 'incorrect-balance';
    } else {
      primary = STRATEGIES.FACTUAL; secondary = STRATEGIES.FCRA; confidence = 72; templateId = 'furnisher-direct-dispute';
    }
    docs = DOCS.generic;
  }

  // ── Adjustments ──
  // Already disputed once: pivot the FIRST move toward Method-of-Verification /
  // escalation, and raise CFPB as the realistic backup.
  if (a.disputedBefore && primary !== STRATEGIES.IDENTITY && primary !== STRATEGIES.GOODWILL) {
    secondary = primary === STRATEGIES.MOV ? STRATEGIES.CFPB : STRATEGIES.MOV;
    primary = primary === STRATEGIES.VALIDATION ? STRATEGIES.VALIDATION : STRATEGIES.MOV;
    if (primary === STRATEGIES.MOV) secondary = STRATEGIES.CFPB;
    confidence = clamp(confidence - 6, 40, 99);
    if (primary === STRATEGIES.MOV) {
      templateId = 'method-of-verification';
      docs = ['Prior dispute letter', 'Bureau investigation result', 'Certified mail receipt', ...(a.hasDocuments ? ['Supporting evidence already submitted'] : [])];
    }
  }
  // Documentation strengthens a factual/Metro 2 case.
  if (a.hasDocuments && [STRATEGIES.FACTUAL, STRATEGIES.METRO2, STRATEGIES.FURNISHER].includes(primary)) {
    confidence = clamp(confidence + 6, 40, 99);
  }
  if (!a.hasDocuments && primary === STRATEGIES.GOODWILL) {
    confidence = clamp(confidence - 4, 40, 99);
  }

  const template = getTemplate(templateId);
  const reason = REASONS[primary] || 'This is the most appropriate first dispute given the situation you described.';

  return {
    primary,
    secondary,
    confidence,
    reason,
    suggestedDocuments: docs,
    recommendedTemplateId: templateId,
    recommendedTemplate: template
      ? { id: template.id, label: template.label, category: template.category, recipient: template.recipient, legalBasis: template.legalBasis }
      : null,
    escalationPath: buildEscalationPath(primary, secondary),
  };
}

// A simple ordered playbook the UI can show as "what happens next".
function buildEscalationPath(primary, secondary) {
  const path = [primary];
  if (secondary && secondary !== primary) path.push(secondary);
  if (!path.includes(STRATEGIES.CFPB)) path.push(STRATEGIES.CFPB);
  return path;
}

// ── CFPB complaint narrative ──────────────────────────────────────────────────
/**
 * buildCfpbComplaint(input)
 *  input: {
 *    consumer: { name, address, cityStateZip, email, phone },
 *    company,                       // creditor / bureau / collector name
 *    product,                       // e.g. "Credit reporting"
 *    issueCategory,                 // e.g. "Incorrect information on your report"
 *    accountNumber,
 *    timeline: [ { date, event } ] | string,
 *    violations: [ string ],
 *    requestedResolution,
 *    evidence: [ string ]
 *  }
 */
export function buildCfpbComplaint(input = {}) {
  const c = input.consumer || {};
  const company = input.company || '[COMPANY]';
  const product = input.product || 'Credit reporting, credit repair services, or other personal consumer reports';
  const issue = input.issueCategory || 'Incorrect information on your report';
  const acct = input.accountNumber ? ` (account ${input.accountNumber})` : '';

  const timelineText = Array.isArray(input.timeline)
    ? input.timeline.filter(t => t && (t.date || t.event)).map(t => `• ${[t.date, t.event].filter(Boolean).join(' — ')}`).join('\n')
    : (input.timeline ? String(input.timeline) : '• [Add the key dates of your dispute and their response]');

  const violations = (input.violations && input.violations.length)
    ? input.violations
    : ['Failure to conduct a reasonable reinvestigation (FCRA §611)', 'Reporting inaccurate information (FCRA §623)'];

  const evidence = (input.evidence && input.evidence.length)
    ? input.evidence
    : ['Copy of the disputed credit report entry', 'Copies of my prior dispute letters and proof of mailing'];

  const resolution = input.requestedResolution
    || 'I am asking that the inaccurate information be corrected or deleted and that I receive written confirmation of the results.';

  const narrative =
`COMPLAINT NARRATIVE

I am submitting this complaint regarding ${company}${acct} concerning ${product.toLowerCase()}. The issue is: ${issue}.

WHAT HAPPENED
${timelineText}

WHY THIS IS A VIOLATION
${company} has not met its obligations under federal law. Specifically:
${violations.map(v => `• ${v}`).join('\n')}

These failures have caused inaccurate information to remain on my consumer report, which affects my creditworthiness and my access to credit.

WHAT I HAVE DONE
I attempted to resolve this directly before filing this complaint. Despite my efforts, the issue has not been corrected.

SUPPORTING EVIDENCE
${evidence.map(e => `• ${e}`).join('\n')}

DESIRED RESOLUTION
${resolution}

I am requesting that the CFPB forward this complaint to ${company} for a response, and I ask that the company correct the matter promptly.

Respectfully,
${c.name || '[YOUR NAME]'}
${[c.cityStateZip, c.email, c.phone].filter(Boolean).join(' · ') || '[YOUR CONTACT INFORMATION]'}`;

  return {
    narrative,
    fields: {
      product,
      issue,
      company,
      consumer: {
        name: c.name || '',
        address: [c.address, c.cityStateZip].filter(Boolean).join(', '),
        email: c.email || '',
        phone: c.phone || '',
      },
      violations,
      evidence,
      requestedResolution: resolution,
    },
    filingUrl: 'https://www.consumerfinance.gov/complaint/',
  };
}
