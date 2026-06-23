import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCreditIntelligenceAnalysis,
  enhanceCreditAnalysis,
  maskAccountNumber,
  normalizeCreditReport,
  runCreditValidationChecks
} from '../lib/credit-intelligence.js';

const eightYearsAgo = new Date(Date.now() - 8 * 365.25 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const sampleReport = `
Experian Credit Report
Consumer Name: Jordan Sample
Credit Score Experian 612

Account Name: Capital One
Account Number: 123456789
Account Type: Credit Card
Balance: $5,200
Credit Limit: $5,000
Account Status: Open
Payment Status: 30 days late 60 days late
Date Opened: 01/02/2021
Date Reported: 05/10/2026
Remarks: Account disputed by consumer

Creditor: Portfolio Recovery
Account Number: 9988776655
Account Type: Collection
Balance: $740
Status: Collection
Date of First Delinquency: ${eightYearsAgo}
Date Reported: 04/15/2026
`;

test('normalizeCreditReport extracts bureau, accounts, masked account numbers, and scores', () => {
  const report = normalizeCreditReport(sampleReport);
  assert.equal(report.bureau, 'Experian');
  assert.equal(report.scores.Experian, 612);
  assert.ok(report.accounts.length >= 2);
  assert.ok(report.accounts.every(account => !/123456789|9988776655/.test(account.account_number_masked)));
});

test('runCreditValidationChecks detects Metro 2 balance issue and obsolete collection', () => {
  const report = normalizeCreditReport(sampleReport);
  const checks = runCreditValidationChecks(report);
  assert.ok(checks.some(item => item.type === 'balance_error'));
  assert.ok(checks.some(item => item.type === 'obsolete_account'));
  assert.ok(checks.every(item => item.priority_score >= 1 && item.priority_score <= 99));
});

test('buildCreditIntelligenceAnalysis creates disputes and funding readiness without fake approvals', () => {
  const analysis = buildCreditIntelligenceAnalysis(sampleReport);
  assert.ok(analysis.disputes.length >= 2);
  assert.ok(analysis.funding_intelligence.score >= 1 && analysis.funding_intelligence.score <= 100);
  assert.match(analysis.funding_intelligence.approval_odds_note, /does not fabricate approvals/i);
});

test('enhanceCreditAnalysis masks model account numbers and preserves normalized report', () => {
  const enhanced = enhanceCreditAnalysis({
    summary: {},
    disputes: [{ creditor: 'Capital One', account_number: '123456789', priority: 'high' }]
  }, sampleReport);
  assert.equal(enhanced.disputes[0].account_number, '****6789');
  assert.ok(enhanced.normalized_report.accounts.length >= 2);
});

test('maskAccountNumber keeps only masked/last-four form', () => {
  assert.equal(maskAccountNumber('123456789'), '****6789');
  assert.equal(maskAccountNumber('xxxx4321'), '****4321');
});
