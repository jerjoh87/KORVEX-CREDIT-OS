import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCreditIntelligenceAnalysis, maskAccountNumber } from './credit-intelligence.js';

const BUREAUS = ['TransUnion', 'Experian', 'Equifax'];
const NO_CASE_LAW = 'Not cited in this letter because no case authority was provided or verified for this specific issue.';
const CASE_ROOT = path.resolve(process.cwd(), 'client-cases');

const BUREAU_RECIPIENTS = {
  TransUnion: {
    name: 'TransUnion LLC',
    address_lines: ['P.O. Box 2000', 'Chester, PA 19016-2000']
  },
  Experian: {
    name: 'Experian',
    address_lines: ['P.O. Box 4500', 'Allen, TX 75013']
  },
  Equifax: {
    name: 'Equifax Information Services LLC',
    address_lines: ['P.O. Box 740256', 'Atlanta, GA 30374-0256']
  }
};

function clean(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeFileName(value) {
  return clean(value, 120).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'letter';
}

function splitAddressLines(value) {
  if (Array.isArray(value)) return value.map(line => clean(line, 120)).filter(Boolean);
  return String(value || '').split(/\n|,/).map(line => clean(line, 120)).filter(Boolean);
}

function hasConsumerAddress(consumer = {}) {
  return !!clean(consumer.name, 150) && splitAddressLines(consumer.address_lines || consumer.address || consumer.mailingAddress).length >= 2;
}

function dateLabel(date = new Date()) {
  return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function caseDirectory(caseId) {
  return path.join(CASE_ROOT, safeFileName(caseId));
}

function legalBasisFor(issue = {}) {
  const text = `${issue.type || ''} ${issue.title || ''} ${issue.evidence || ''} ${issue.applicable_law || ''}`.toLowerCase();
  if (text.includes('obsolete') || text.includes('dofd') || text.includes('first delinquency')) {
    return 'Potential FCRA section 1681c reporting-period issue and FCRA section 1681i reinvestigation issue.';
  }
  if (text.includes('collection') || text.includes('fdcpa')) {
    return 'Potential FCRA section 1681i reinvestigation issue and, for debt collectors only, possible FDCPA section 1692g/1692e issue if the reported debt details cannot be verified.';
  }
  if (text.includes('furnisher') || text.includes('623') || text.includes('1681s')) {
    return 'Potential FCRA section 1681e(b) accuracy issue, FCRA section 1681i reinvestigation issue, and possible FCRA section 1681s-2(b) furnisher investigation issue after CRA notice.';
  }
  return 'Potential FCRA section 1681e(b) accuracy issue and FCRA section 1681i reinvestigation issue.';
}

function candidateClass(issue = {}) {
  const type = String(issue.type || '').toLowerCase();
  const evidence = clean(issue.evidence, 1000).toLowerCase();
  const title = clean(issue.title, 300).toLowerCase();
  const supportedTypes = new Set(['duplicate_account', 'missing_dofd', 'obsolete_account', 'balance_error', 'wrong_status', 'mixed_file']);

  if (type === 'utilization') {
    return {
      classification: 'Do Not Dispute',
      reason: 'Utilization is a funding/scoring blocker, not a factual dispute candidate by itself.'
    };
  }
  if (/identity theft|fraud|unauthorized/.test(`${type} ${title} ${evidence}`)) {
    return {
      classification: 'Needs Documentation',
      reason: 'Identity theft, fraud, and unauthorized activity language requires client confirmation and supporting documentation before use.'
    };
  }
  if (supportedTypes.has(type) || Number(issue.priority_score) >= 80) {
    return {
      classification: 'Strong Dispute Candidate',
      reason: 'The audit found a specific factual accuracy, completeness, duplicate, obsolete, or field-level reporting issue.'
    };
  }
  if (['late_payment_sequence', 'address_mismatch'].includes(type)) {
    return {
      classification: 'Needs Client Confirmation',
      reason: 'The report suggests a possible issue, but the client must confirm the facts and documents before mailing.'
    };
  }
  if (Number(issue.priority_score) < 45) {
    return {
      classification: 'Do Not Dispute',
      reason: 'The audit evidence is too weak for an automatic Round 1 dispute.'
    };
  }
  return {
    classification: 'Human Review Required',
    reason: 'The item may involve a factual issue, but the extracted evidence is not clear enough for automatic mailing.'
  };
}

function accountForIssue(issue = {}, normalizedReport = {}) {
  return (normalizedReport.accounts || []).find(account => account.id === issue.account_id) || {};
}

function buildCandidate(issue, normalizedReport, index) {
  const account = accountForIssue(issue, normalizedReport);
  const classified = candidateClass(issue);
  const bureau = clean(issue.bureau || account.bureau || normalizedReport.bureau || 'All', 50);
  const legalBasis = legalBasisFor(issue);
  return {
    id: issue.id || `candidate-${index + 1}`,
    status: classified.classification,
    recommended_action: classified.reason,
    approved: classified.classification === 'Strong Dispute Candidate',
    name: clean(issue.creditor || account.creditor_name || issue.title || 'Review report item', 150),
    bureau,
    account: maskAccountNumber(account.account_number_masked || ''),
    account_number_fragment: maskAccountNumber(account.account_number_masked || ''),
    issue: clean(issue.title || issue.type || 'Potential reporting issue', 240),
    audit_error_found: clean(issue.evidence || issue.title || 'Audit evidence requires human review.', 500),
    violation_or_legal_basis: legalBasis,
    case_law_support: NO_CASE_LAW,
    why_it_applies: clean(issue.evidence || 'The disputed field affects the accuracy or completeness of the consumer report and should be verified at the field level.', 700),
    requested_action: clean(issue.recommended_strategy || 'Please verify, correct, or delete this item if it cannot be verified as complete and accurate.', 500),
    supporting_documents_needed: Array.isArray(issue.supporting_evidence) ? issue.supporting_evidence : [],
    source_issue: issue
  };
}

function fundingBlockers(analysis = {}) {
  const funding = analysis.funding_intelligence || {};
  const blockers = [];
  if (Number(funding.derogatory_count) > 0) blockers.push(`${funding.derogatory_count} derogatory item(s) detected for factual review.`);
  if (Number(funding.hard_inquiry_count) > 3) blockers.push('Hard inquiry count may affect funding readiness.');
  if (Number(funding.utilization_percent) > 29) blockers.push(`Aggregate utilization appears near ${funding.utilization_percent}%.`);
  return blockers.length ? blockers : ['No high-confidence funding blockers were added beyond normal underwriting review.'];
}

export function createMasterAuditMarkdown({ caseId, reportText, analysis, candidates }) {
  const normalized = analysis.normalized_report || {};
  const summary = analysis.summary || {};
  const scoreLines = Object.entries(summary.bureau_scores || {})
    .map(([bureau, score]) => `- ${bureau}: ${score || 'Not found'}`)
    .join('\n');
  const personal = normalized.personal_information || {};
  const findings = (analysis.validation_checks || []).map(item => `- ${item.severity?.toUpperCase?.() || 'REVIEW'}: ${item.title} (${item.creditor || 'Report item'}) - ${item.evidence}`).join('\n') || '- No validation findings were produced.';
  const candidateLines = candidates.map(item => `- ${item.status}: ${item.name} / ${item.bureau} - ${item.issue}`).join('\n') || '- No dispute candidates selected.';
  return [
    `# Master Credit Audit - ${caseId}`,
    '',
    '## Client Snapshot',
    `- Consumer detected: ${summary.consumer_name || personal.names?.[0] || 'Missing / not detected'}`,
    `- Report source: ${normalized.source || 'Unknown'}`,
    `- Parser confidence: ${normalized.parser_confidence || 0}/100`,
    `- Extracted characters: ${String(reportText || '').length}`,
    '',
    '## Bureau Score Summary',
    scoreLines || '- No explicit bureau scores were detected.',
    '',
    '## Personal Information Review',
    `- Names detected: ${(personal.names || []).join('; ') || 'None detected'}`,
    `- Addresses detected: ${(personal.addresses || []).join('; ') || 'None detected'}`,
    '',
    '## Account Findings',
    `- Accounts read: ${(normalized.accounts || []).length}`,
    `- Collections: ${(normalized.collections || []).length}`,
    `- Charge-offs: ${(normalized.charge_offs || []).length}`,
    `- Hard inquiry candidates: ${(normalized.hard_inquiries || []).length}`,
    '',
    '## Derogatory Items And Possible Reporting Errors',
    findings,
    '',
    '## Funding Blockers',
    ...fundingBlockers(analysis).map(item => `- ${item}`),
    '',
    '## Round 1 Dispute Candidate Review',
    candidateLines,
    '',
    '## Compliance Notes',
    '- Do not dispute accurate information without a factual basis.',
    '- Do not use identity theft, fraud, or unauthorized inquiry language without documentation.',
    '- Review every letter before mailing. No deletions, score increases, approvals, or funding are guaranteed.'
  ].join('\n');
}

export function buildRound1Workflow({ reportText, consumer = {}, caseId = null, currentDate = new Date(), supportingDocuments = [], caseLaw = {} } = {}) {
  const text = String(reportText || '').trim();
  if (text.length < 20) {
    const error = new Error('The report is unreadable or too short to audit.');
    error.status = 422;
    throw error;
  }
  const resolvedCaseId = caseId || `case-${randomUUID()}`;
  const analysis = buildCreditIntelligenceAnalysis(text, { reason: 'Round 1 workflow audit' });
  const candidates = (analysis.validation_checks || []).map((issue, index) => buildCandidate(issue, analysis.normalized_report, index));
  const approvedCandidates = candidates.filter(item => item.approved);
  const auditMarkdown = createMasterAuditMarkdown({ caseId: resolvedCaseId, reportText: text, analysis, candidates });
  const humanReviewFlags = buildHumanReviewFlags({ consumer, candidates, approvedCandidates, analysis });
  const packet = buildLetterPacket({
    caseId: resolvedCaseId,
    consumer,
    candidates: approvedCandidates,
    currentDate,
    supportingDocuments,
    caseLaw
  });
  return {
    caseId: resolvedCaseId,
    analysis,
    auditMarkdown,
    candidates,
    letterPacket: packet,
    humanReviewFlags,
    canGeneratePdfs: hasConsumerAddress(consumer) && !humanReviewFlags.hardStop,
    hardStops: humanReviewFlags.hardStops
  };
}

export function buildHumanReviewFlags({ consumer = {}, candidates = [], approvedCandidates = [], analysis = {} } = {}) {
  const hardStops = [];
  const flags = [
    'Human review required before any letter is mailed.',
    'Confirm each account name, bureau, account fragment, balance, dates, and status against the original report.',
    'No result is guaranteed; do not promise deletions, score increases, approvals, or funding.'
  ];
  if (!hasConsumerAddress(consumer)) hardStops.push('Consumer full name and mailing address are required before final PDFs can be generated.');
  const docItems = candidates.filter(item => item.approved && item.status === 'Needs Documentation');
  if (docItems.length) hardStops.push('Documentation is required before using identity theft, fraud, or unauthorized activity language.');
  if ((analysis.normalized_report?.parser_confidence || 0) < 45) hardStops.push('Report extraction confidence is low. Review the original PDF before mailing.');
  if (!approvedCandidates.length) flags.push('No strong automatic dispute candidates were selected. Use human review before drafting letters.');
  return {
    hardStop: hardStops.length > 0,
    hardStops,
    flags,
    documentsNeeded: [...new Set(candidates.flatMap(item => item.supporting_documents_needed || []))],
    excluded: candidates.filter(item => !item.approved).map(item => ({
      id: item.id,
      name: item.name,
      bureau: item.bureau,
      status: item.status,
      reason: item.recommended_action
    }))
  };
}

export function humanReviewFlagsMarkdown(flags = {}) {
  return [
    '# Human Review Flags',
    '',
    '## Hard Stops',
    ...(flags.hardStops?.length ? flags.hardStops.map(item => `- ${item}`) : ['- None.']),
    '',
    '## Required Review',
    ...(flags.flags || []).map(item => `- ${item}`),
    '',
    '## Documents Needed',
    ...(flags.documentsNeeded?.length ? flags.documentsNeeded.map(item => `- ${item}`) : ['- Standard identity and proof of address documents.']),
    '',
    '## Excluded Or Held Items',
    ...(flags.excluded?.length ? flags.excluded.map(item => `- ${item.status}: ${item.name} (${item.bureau}) - ${item.reason}`) : ['- None.'])
  ].join('\n');
}

export function buildLetterPacket({ caseId, consumer = {}, candidates = [], currentDate = new Date(), supportingDocuments = [], caseLaw = {} } = {}) {
  const consumerLines = splitAddressLines(consumer.address_lines || consumer.address || consumer.mailingAddress);
  const grouped = new Map();
  for (const item of candidates) {
    const bureaus = item.bureau === 'All' || item.bureau === 'Merged / tri-bureau' ? BUREAUS : [item.bureau].filter(Boolean);
    for (const bureau of bureaus) {
      if (!BUREAU_RECIPIENTS[bureau]) continue;
      if (!grouped.has(bureau)) grouped.set(bureau, []);
      grouped.get(bureau).push({
        name: item.name,
        account: item.account_number_fragment || item.account || 'Review report',
        bureau,
        issue: item.issue,
        audit_error: item.audit_error_found,
        violation: item.violation_or_legal_basis,
        case_law: caseLaw[item.id] || item.case_law_support || NO_CASE_LAW,
        legal_explanation: item.why_it_applies,
        requested_action: item.requested_action
      });
    }
  }

  const attachments = supportingDocuments.length
    ? supportingDocuments.map(item => clean(item, 120)).filter(Boolean)
    : ['Copy of ID', 'Proof of address', 'Credit report excerpt'];

  return {
    case_name: safeFileName(`${consumer.name || 'client'}-round-1-${caseId}`),
    round: 'Round 1',
    consumer: {
      name: clean(consumer.name, 150),
      address_lines: consumerLines
    },
    letters: [...grouped.entries()].map(([bureau, items]) => ({
      filename: `${safeFileName(bureau)}-round-1.pdf`,
      date: dateLabel(currentDate),
      recipient: BUREAU_RECIPIENTS[bureau],
      subject: 'Round 1 Factual Credit Report Dispute',
      opening: 'I am disputing the accuracy and completeness of the items listed below. Please conduct a reasonable investigation.',
      items,
      attachments,
      closing: 'Please send me the results of your investigation in writing.'
    }))
  };
}

function wrapText(text, maxChars = 92) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function pdfEscape(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function plainPdfBytes(title, bodyLines) {
  const objects = [];
  const add = content => {
    objects.push(content);
    return objects.length;
  };
  const pages = [];
  const linesPerPage = 48;
  const allLines = [title, '', ...bodyLines];
  for (let i = 0; i < allLines.length; i += linesPerPage) pages.push(allLines.slice(i, i + linesPerPage));
  const fontObj = add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>');
  const pageRefs = [];
  let pagesObjIndex = 0;
  pagesObjIndex = add('PAGES_PLACEHOLDER');
  for (const pageLines of pages) {
    let y = 730;
    const commands = ['BT', '/F1 11 Tf', '72 730 Td', '14 TL'];
    pageLines.forEach((line, index) => {
      const size = index === 0 && line === title ? 14 : 11;
      if (index === 0 && line === title) commands.push('/F1 14 Tf');
      commands.push(`(${pdfEscape(line)}) Tj`);
      commands.push('T*');
      if (index === 0 && line === title) commands.push('/F1 11 Tf');
      y -= size + 3;
    });
    commands.push('ET');
    const stream = commands.join('\n');
    const contentObj = add(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);
    const pageObj = add(`<< /Type /Page /Parent ${pagesObjIndex} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentObj} 0 R >>`);
    pageRefs.push(pageObj);
  }
  objects[pagesObjIndex - 1] = `<< /Type /Pages /Kids [${pageRefs.map(ref => `${ref} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`;
  const catalogObj = add(`<< /Type /Catalog /Pages ${pagesObjIndex} 0 R >>`);
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObj} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

export async function generatePacketPdfs({ packet, outputDir }) {
  await fs.mkdir(outputDir, { recursive: true });
  const files = [];
  for (const letter of packet.letters || []) {
    const bodyLines = [];
    const push = (text = '') => wrapText(text).forEach(line => bodyLines.push(line));
    push(letter.date);
    bodyLines.push('');
    push(packet.consumer.name);
    for (const line of packet.consumer.address_lines || []) push(line);
    bodyLines.push('');
    push(letter.recipient.name);
    for (const line of letter.recipient.address_lines || []) push(line);
    bodyLines.push('');
    push(`Re: ${letter.subject}`);
    bodyLines.push('');
    push(letter.opening);
    bodyLines.push('');
    for (const [index, item] of (letter.items || []).entries()) {
      push(`${index + 1}. ${item.name} - ${item.account}`);
      push(`Bureau: ${item.bureau}`);
      push(`Issue: ${item.issue}`);
      push(`Audit error found: ${item.audit_error}`);
      push(`Violation or legal basis: ${item.violation}`);
      push(`Case-law support: ${item.case_law || NO_CASE_LAW}`);
      push(`Why it applies: ${item.legal_explanation}`);
      push(`Requested action: ${item.requested_action}`);
      bodyLines.push('');
    }
    push('Attachments:');
    for (const attachment of letter.attachments || []) push(`- ${attachment}`);
    bodyLines.push('');
    push(letter.closing);
    bodyLines.push('', 'Sincerely,', '', '', packet.consumer.name || '');
    const bytes = plainPdfBytes(letter.subject || 'Round 1 Dispute Letter', bodyLines);
    const filename = safeFileName(letter.filename).endsWith('pdf') ? letter.filename : `${safeFileName(letter.filename)}.pdf`;
    const filePath = path.join(outputDir, filename);
    await fs.writeFile(filePath, bytes);
    files.push({ filename, path: filePath });
  }
  return files;
}

export async function saveRound1Artifacts({ caseId, originalBuffer = null, reportText, auditMarkdown, letterPacket, humanReviewFlags, generatePdfs = false }) {
  const dir = caseDirectory(caseId);
  await fs.mkdir(dir, { recursive: true });
  if (originalBuffer?.length) await fs.writeFile(path.join(dir, 'original-report.pdf'), originalBuffer);
  await fs.writeFile(path.join(dir, 'extracted-report.txt'), String(reportText || ''), 'utf8');
  await fs.writeFile(path.join(dir, 'master-credit-audit.md'), auditMarkdown, 'utf8');
  await fs.writeFile(path.join(dir, 'round-1-letter-packet.json'), JSON.stringify(letterPacket, null, 2), 'utf8');
  await fs.writeFile(path.join(dir, 'human-review-flags.md'), humanReviewFlagsMarkdown(humanReviewFlags), 'utf8');
  const pdfs = generatePdfs ? await generatePacketPdfs({ packet: letterPacket, outputDir: dir }) : [];
  return {
    dir,
    files: {
      originalReport: originalBuffer?.length ? path.join(dir, 'original-report.pdf') : null,
      extractedText: path.join(dir, 'extracted-report.txt'),
      audit: path.join(dir, 'master-credit-audit.md'),
      packet: path.join(dir, 'round-1-letter-packet.json'),
      flags: path.join(dir, 'human-review-flags.md'),
      pdfs
    }
  };
}

export { BUREAUS, BUREAU_RECIPIENTS, CASE_ROOT, NO_CASE_LAW, caseDirectory, hasConsumerAddress };
