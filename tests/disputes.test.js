import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORIES, TEMPLATE_COUNT, listTemplates, getTemplate, templatesByCategory, renderLetter, BUREAU_ADDRESSES,
} from '../lib/disputeLibrary.js';
import { recommendStrategy, buildCfpbComplaint, STRATEGIES } from '../lib/disputeStrategy.js';

// ── Library integrity ─────────────────────────────────────────────────────────
test('library: every category has at least one template', () => {
  for (const cat of CATEGORIES) {
    assert.ok(templatesByCategory(cat.id).length > 0, `category "${cat.id}" has no templates`);
  }
});

test('library: templates are well-formed and ids are unique', () => {
  const templates = listTemplates();
  assert.equal(templates.length, TEMPLATE_COUNT);
  assert.ok(TEMPLATE_COUNT >= 35, `expected a substantial library, got ${TEMPLATE_COUNT}`);

  const validRecipients = new Set(['bureau', 'furnisher', 'collector', 'cfpb']);
  const validCategories = new Set(CATEGORIES.map(c => c.id));
  const seen = new Set();

  for (const t of templates) {
    assert.ok(t.id && !seen.has(t.id), `duplicate or missing id: ${t.id}`);
    seen.add(t.id);
    assert.ok(validCategories.has(t.category), `bad category on ${t.id}`);
    assert.ok(validRecipients.has(t.recipient), `bad recipient on ${t.id}`);
    assert.ok(typeof t.strategy === 'string' && t.strategy.length, `missing strategy on ${t.id}`);
    assert.ok(Array.isArray(t.legalBasis), `legalBasis must be an array on ${t.id}`);
    assert.ok(Array.isArray(t.suggestedDocuments), `suggestedDocuments must be an array on ${t.id}`);
  }
});

// ── Letter rendering ──────────────────────────────────────────────────────────
test('renderLetter: fills provided data and uses bureau address', () => {
  const t = getTemplate('incorrect-late-payment');
  const letter = renderLetter(t, {
    fullName: 'Jordan Carter', address: '123 Main St', cityStateZip: 'Austin, TX 78701',
    bureau: 'Experian', creditor: 'Capital One', accountNumber: '****1234',
  });
  assert.match(letter, /Jordan Carter/);
  assert.match(letter, /Capital One/);
  assert.match(letter, /\*\*\*\*1234/);
  assert.match(letter, /P\.O\. Box 4500/);        // Experian dispute address
  assert.match(letter, /FCRA §611/);
  assert.match(letter, /Sincerely/);
});

test('renderLetter: missing fields become labelled placeholders, not literal tokens', () => {
  const t = getTemplate('debt-validation');
  const letter = renderLetter(t, {});
  assert.doesNotMatch(letter, /\{\{/, 'no unfilled {{tokens}} should remain');
  assert.match(letter, /\[YOUR FULL NAME\]/);
  assert.match(letter, /FDCPA §809/);
});

// ── Recommendation engine ─────────────────────────────────────────────────────
test('recommend: identity theft outranks everything', () => {
  const r = recommendStrategy({ disputeType: 'collection', problem: 'fraud', bureau: 'All' });
  assert.equal(r.primary, STRATEGIES.IDENTITY);
  assert.ok(r.confidence >= 90);
  assert.equal(r.recommendedTemplateId, 'fraudulent-account');
  assert.ok(r.escalationPath.includes(STRATEGIES.CFPB));
});

test('recommend: third-party collection not mine → debt validation', () => {
  const r = recommendStrategy({ disputeType: 'collection', problem: 'not-mine' });
  assert.equal(r.primary, STRATEGIES.VALIDATION);
  assert.equal(r.recommendedTemplateId, 'debt-validation');
});

test('recommend: unauthorized inquiry → permissible purpose', () => {
  const r = recommendStrategy({ disputeType: 'inquiry', problem: 'not-mine' });
  assert.equal(r.primary, STRATEGIES.PERMISSIBLE);
  assert.equal(r.recommendedTemplateId, 'unauthorized-hard-inquiry');
});

test('recommend: having disputed before pivots to Method of Verification', () => {
  const base = recommendStrategy({ disputeType: 'late', problem: 'incorrect-status', disputedBefore: false });
  const again = recommendStrategy({ disputeType: 'late', problem: 'incorrect-status', disputedBefore: true });
  assert.equal(again.primary, STRATEGIES.MOV);
  assert.ok(again.escalationPath.includes(STRATEGIES.CFPB));
  assert.ok(again.confidence <= base.confidence);
});

test('recommend: obsolete debt → factual deletion via out-of-statute template', () => {
  const r = recommendStrategy({ disputeType: 'collection', problem: 'other', accountAge: 'obsolete' });
  assert.equal(r.recommendedTemplateId, 'out-of-statute-debt');
  assert.equal(r.primary, STRATEGIES.FACTUAL);
});

test('recommend: documentation raises confidence on a factual dispute', () => {
  const without = recommendStrategy({ disputeType: 'late', problem: 'incorrect-status', hasDocuments: false });
  const withDocs = recommendStrategy({ disputeType: 'late', problem: 'incorrect-status', hasDocuments: true });
  assert.ok(withDocs.confidence > without.confidence);
});

test('recommend: requires at least one signal', () => {
  const r = recommendStrategy({});
  assert.ok(r.primary, 'still returns a safe default');
});

// ── CFPB complaint ────────────────────────────────────────────────────────────
test('cfpb: builds a narrative with the key sections', () => {
  const { complaint } = { complaint: buildCfpbComplaint({
    consumer: { name: 'Jordan Carter', cityStateZip: 'Austin, TX', email: 'j@example.com' },
    company: 'Midland Credit Management',
    issueCategory: 'Attempts to collect debt not owed',
    violations: ['Failed to validate the debt (FDCPA §809)'],
    requestedResolution: 'Delete the account from all bureaus.',
    evidence: ['Validation request letter', 'Certified mail receipt'],
  }) };
  assert.match(complaint.narrative, /Midland Credit Management/);
  assert.match(complaint.narrative, /FDCPA §809/);
  assert.match(complaint.narrative, /Delete the account from all bureaus/);
  assert.match(complaint.narrative, /Jordan Carter/);
  assert.equal(complaint.fields.company, 'Midland Credit Management');
  assert.match(complaint.filingUrl, /consumerfinance\.gov/);
});

test('cfpb: falls back to sensible defaults', () => {
  const c = buildCfpbComplaint({ company: 'Experian' });
  assert.match(c.narrative, /Experian/);
  assert.ok(c.fields.violations.length >= 1);
});
