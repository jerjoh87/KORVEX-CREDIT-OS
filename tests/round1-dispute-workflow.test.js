import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  NO_CASE_LAW,
  buildRound1Workflow,
  generatePacketPdfs
} from '../lib/round1-dispute-workflow.js';

const oldDofd = new Date(Date.now() - 8 * 365.25 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const sampleReport = `
TransUnion Experian Equifax Credit Report
Consumer Name: Jordan Sample
Credit Score TransUnion 612

Account Name: Capital One
Account Number: 123456789
Account Type: Credit Card
Balance: $5,200
Credit Limit: $5,000
Account Status: Open
Payment Status: 30 days late 60 days late
Date Opened: 01/02/2021
Date Reported: 05/10/2026

Creditor: Portfolio Recovery
Account Number: 9988776655
Account Type: Collection
Balance: $740
Status: Collection
Date of First Delinquency: ${oldDofd}
Date Reported: 04/15/2026
`;

test('Round 1 workflow audits report and classifies factual candidates only', () => {
  const workflow = buildRound1Workflow({ reportText: sampleReport });
  assert.ok(workflow.auditMarkdown.includes('Master Credit Audit'));
  assert.ok(workflow.candidates.some(item => item.status === 'Strong Dispute Candidate'));
  assert.ok(workflow.candidates.some(item => item.status === 'Needs Client Confirmation'));
  assert.ok(workflow.candidates.every(item => item.case_law_support === NO_CASE_LAW));
});

test('Round 1 workflow stops final PDFs when consumer mailing address is missing', () => {
  const workflow = buildRound1Workflow({ reportText: sampleReport, consumer: { name: 'Jordan Sample' } });
  assert.equal(workflow.canGeneratePdfs, false);
  assert.ok(workflow.hardStops.some(item => /mailing address/i.test(item)));
});

test('Round 1 packet creates bureau letters with required item fields', () => {
  const workflow = buildRound1Workflow({
    reportText: sampleReport,
    consumer: { name: 'Jordan Sample', address_lines: ['123 Main St', 'Baltimore, MD 21201'] }
  });
  assert.ok(workflow.letterPacket.letters.length >= 1);
  const item = workflow.letterPacket.letters[0].items[0];
  assert.ok(item.name);
  assert.ok(item.account);
  assert.ok(item.bureau);
  assert.ok(item.issue);
  assert.ok(item.audit_error);
  assert.ok(item.violation);
  assert.equal(item.case_law, NO_CASE_LAW);
  assert.ok(item.legal_explanation);
  assert.ok(item.requested_action);
});

test('PDF engine writes black-and-white Round 1 PDFs from packet JSON', async () => {
  const workflow = buildRound1Workflow({
    reportText: sampleReport,
    consumer: { name: 'Jordan Sample', address_lines: ['123 Main St', 'Baltimore, MD 21201'] }
  });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'round1-pdfs-'));
  const files = await generatePacketPdfs({ packet: workflow.letterPacket, outputDir: dir });
  assert.ok(files.length >= 1);
  const stat = await fs.stat(files[0].path);
  assert.ok(stat.size > 1000);
});
