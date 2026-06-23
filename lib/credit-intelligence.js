const SUPPORTED_SOURCES = [
  'Experian',
  'Equifax',
  'TransUnion',
  'SmartCredit',
  'IdentityIQ',
  'PrivacyGuard',
  'AnnualCreditReport',
  'MyScoreIQ',
  'CreditCheckTotal'
];

const BUREAUS = ['Experian', 'Equifax', 'TransUnion'];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function cleanText(value, max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseMoney(value) {
  const match = String(value || '').match(/-?\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d{2})?|[0-9]+(?:\.\d{2})?)/);
  if (!match) return null;
  const number = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function parseDate(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i);
  if (!match) return null;
  const date = new Date(match[1]);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function yearsSince(dateValue) {
  const date = dateValue ? new Date(dateValue) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return (Date.now() - date.getTime()) / (365.25 * MS_PER_DAY);
}

export function maskAccountNumber(value = '') {
  const raw = cleanText(value, 80);
  if (!raw) return '';
  if (/[*xX]{2,}\s*\d{2,6}/.test(raw)) return raw.replace(/[xX]/g, '*').slice(0, 40);
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 4) return `****${digits.slice(-4)}`;
  return raw.replace(/\b\d{4,}\b/g, match => `****${match.slice(-4)}`).slice(0, 40);
}

function detectReportSource(text) {
  const compact = cleanText(text, 50000).toLowerCase();
  const source = SUPPORTED_SOURCES.find(name => compact.includes(name.toLowerCase()));
  const bureaus = BUREAUS.filter(name => new RegExp(`\\b${name.replace('TransUnion', 'Trans\\s*Union')}\\b`, 'i').test(text));
  return {
    source: source || (bureaus.length === 1 ? bureaus[0] : 'Scanned PDF / Unknown'),
    bureau: bureaus.length === 1 ? bureaus[0] : (bureaus.length > 1 ? 'Merged / tri-bureau' : 'Unknown'),
    bureaus
  };
}

function extractScores(text) {
  const scores = { Equifax: null, Experian: null, TransUnion: null };
  for (const bureau of BUREAUS) {
    const label = bureau === 'TransUnion' ? 'Trans\\s*Union|TransUnion' : bureau;
    const after = new RegExp(`(?:${label}).{0,90}?(?:credit\\s*score|fico|vantage(?:score)?|score)\\D{0,18}(3\\d{2}|[4-7]\\d{2}|8[0-4]\\d|850)`, 'i');
    const before = new RegExp(`(?:credit\\s*score|fico|vantage(?:score)?|score)\\D{0,18}(3\\d{2}|[4-7]\\d{2}|8[0-4]\\d|850).{0,90}?(?:${label})`, 'i');
    const labelThenBureau = new RegExp(`(?:credit\\s*score|fico|vantage(?:score)?|score).{0,40}?(?:${label})\\D{0,18}(3\\d{2}|[4-7]\\d{2}|8[0-4]\\d|850)`, 'i');
    const match = text.match(after) || text.match(before) || text.match(labelThenBureau);
    const value = Number(match?.[1]);
    if (value >= 300 && value <= 850) scores[bureau] = value;
  }
  const generic = text.match(/(?:credit\s*score|fico|vantage(?:score)?|score)\D{0,18}(3\d{2}|[4-7]\d{2}|8[0-4]\d|850)/i);
  return { scores, generic_score: generic ? Number(generic[1]) : null };
}

function extractPersonalInfo(text) {
  const compact = text.replace(/\s+/g, ' ');
  const nameMatches = [
    ...compact.matchAll(/(?:consumer|prepared for|report for|name)\s*:?\s+([A-Z][A-Za-z' -]{1,32}\s+[A-Z][A-Za-z' -]{1,32})/gi)
  ].map(match => cleanText(match[1], 120));
  const addresses = [
    ...compact.matchAll(/\b(\d{2,6}\s+[A-Za-z0-9 .'-]{3,60}\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Way|Ct|Court)\b[^|]{0,80})/gi)
  ].map(match => cleanText(match[1], 180));
  const ssn = compact.match(/(?:ssn|social security).{0,20}(?:\*{3,}|x{3,}|ending in|last four)\D{0,8}(\d{4})/i);
  return {
    names: [...new Set(nameMatches)].slice(0, 8),
    addresses: [...new Set(addresses)].slice(0, 8),
    ssn_last4: ssn?.[1] || null
  };
}

function extractSections(text) {
  const compact = text.replace(/\s+/g, ' ');
  const sectionDefs = [
    ['personal_information', /personal information|consumer information|identifying information/i],
    ['tradelines', /tradelines|accounts|account history|credit accounts/i],
    ['collections', /collections?|collection accounts?/i],
    ['charge_offs', /charge[- ]?offs?|charged off/i],
    ['late_payments', /late payments?|payment history|delinquen/i],
    ['student_loans', /student loans?|education loan|nelnet|navient|aidvantage|mohela/i],
    ['public_records', /public records?|bankruptcy|judgment|lien/i],
    ['hard_inquiries', /hard inquiries|regular inquiries|inquiries shared/i],
    ['soft_inquiries', /soft inquiries|promotional inquiries|account review inquiries/i],
    ['utilization', /utilization|credit limit|available credit/i],
    ['remarks', /remarks|comments|consumer statement/i]
  ];
  return sectionDefs.reduce((acc, [key, pattern]) => {
    acc[key] = {
      detected: pattern.test(compact),
      evidence_count: (compact.match(new RegExp(pattern.source, 'gi')) || []).length
    };
    return acc;
  }, {});
}

function valueAfter(block, labels, max = 120) {
  const label = labels.map(item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`(?:${label})\\s*[:#-]?\\s*([^\\n|]{1,${max}})`, 'i');
  const match = block.match(pattern);
  return cleanText(match?.[1] || '', max);
}

function findCreditor(block) {
  const explicit = valueAfter(block, ['creditor', 'furnisher', 'account name', 'company', 'collection agency', 'subscriber name'], 80);
  if (explicit) return explicit;
  const known = block.match(/\b(Capital One|Discover|Synchrony|Portfolio Recovery|Midland Credit|LVNV Funding|Navient|Nelnet|Mohela|Aidvantage|Transworld|Verizon|Comenity|Bank of America|Chase|Citibank|Wells Fargo|American Express|Amex|Toyota Financial|Ford Credit|Santander|Credit One)\b/i);
  if (known) return cleanText(known[1], 80);
  const firstCaps = block.match(/\b([A-Z][A-Z0-9 &.'/-]{3,44})(?=\s+(?:Account|Balance|Status|Date|Creditor|Furnisher)\b)/);
  return cleanText(firstCaps?.[1] || 'Review report item', 80);
}

function splitAccountBlocks(text) {
  const raw = normalizeText(text);
  const marker = /(?:^|\n)(?=(?:account name|creditor|furnisher|subscriber|collection agency|tradeline|account number|acct)\b)/gi;
  const pieces = raw.split(marker).map(item => item.trim()).filter(item => item.length > 80);
  if (pieces.length >= 2) return pieces.slice(0, 60);

  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean);
  const blocks = [];
  let current = [];
  for (const line of lines) {
    const startsAccount = /(?:account name|creditor|furnisher|collection agency|account number|acct)\b/i.test(line);
    if (startsAccount && current.join(' ').length > 80) {
      blocks.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.join(' ').length > 80) blocks.push(current.join('\n'));
  return blocks.slice(0, 60);
}

function normalizeAccount(block, index, defaultBureau) {
  const lower = block.toLowerCase();
  const accountNumber = valueAfter(block, ['account number', 'account #', 'acct #', 'acct', 'account'], 80);
  const accountType = valueAfter(block, ['account type', 'type'], 80);
  const balanceText = valueAfter(block, ['balance', 'current balance', 'amount owed'], 80);
  const limitText = valueAfter(block, ['credit limit', 'limit'], 80);
  const highBalanceText = valueAfter(block, ['high balance', 'highest balance', 'high credit'], 80);
  const monthlyPaymentText = valueAfter(block, ['monthly payment', 'scheduled payment', 'payment amount'], 80);
  const status = valueAfter(block, ['account status', 'status'], 100);
  const paymentStatus = valueAfter(block, ['payment status', 'pay status', 'payment rating'], 100);
  const remarks = valueAfter(block, ['remarks', 'comment', 'comments'], 180);
  const metro2 = valueAfter(block, ['metro 2', 'portfolio type', 'account condition', 'payment rating'], 80);
  const bureau = BUREAUS.find(name => new RegExp(`\\b${name === 'TransUnion' ? 'Trans\\s*Union|TransUnion' : name}\\b`, 'i').test(block)) || defaultBureau || 'All';
  const lateMatches = [...block.matchAll(/\b(30|60|90|120|150|180)\s*(?:days?)?\s*late\b/gi)].map(match => `${match[1]} days late`);
  const history = valueAfter(block, ['payment history', 'payment pattern', 'status history'], 220);
  const dofd = valueAfter(block, ['date of first delinquency', 'first delinquency', 'dofd'], 80);
  const opened = valueAfter(block, ['date opened', 'opened'], 80);
  const reported = valueAfter(block, ['date reported', 'reported', 'last reported'], 80);
  const updated = valueAfter(block, ['date updated', 'updated', 'last updated'], 80);

  return {
    id: `acct-${index + 1}`,
    bureau,
    creditor_name: findCreditor(block),
    account_number_masked: maskAccountNumber(accountNumber),
    account_type: accountType || (/collection/.test(lower) ? 'Collection' : /charge[- ]?off/.test(lower) ? 'Charge-off' : /student/.test(lower) ? 'Student Loan' : /inquiry/.test(lower) ? 'Inquiry' : 'Tradeline'),
    balance: parseMoney(balanceText),
    credit_limit: parseMoney(limitText),
    high_balance: parseMoney(highBalanceText),
    monthly_payment: parseMoney(monthlyPaymentText),
    account_status: status || (/closed/.test(lower) ? 'Closed' : /open|current/.test(lower) ? 'Open' : ''),
    payment_status: paymentStatus || (/charge[- ]?off/.test(lower) ? 'Charged off' : /collection/.test(lower) ? 'Collection' : /late|delinquen|past due/.test(lower) ? 'Late' : ''),
    remarks,
    metro2_codes: metro2 ? [metro2] : [],
    date_opened: parseDate(opened),
    date_reported: parseDate(reported),
    date_updated: parseDate(updated),
    date_of_first_delinquency: parseDate(dofd),
    payment_history: history,
    late_payments: lateMatches.slice(0, 12),
    is_collection: /collection|collection agency|placed for collection/.test(lower),
    is_charge_off: /charge[- ]?off|charged off/.test(lower),
    is_student_loan: /student loan|education loan|nelnet|navient|mohela|aidvantage/.test(lower),
    source_excerpt: cleanText(block, 900)
  };
}

function extractInquiries(text) {
  const compact = text.replace(/\s+/g, ' ');
  const matches = [...compact.matchAll(/([A-Z][A-Z0-9 &.'/-]{2,50})\s+(?:hard inquiry|inquiry|permissible purpose).{0,70}?(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})?/gi)];
  return matches.slice(0, 30).map((match, index) => ({
    id: `inq-${index + 1}`,
    creditor_name: cleanText(match[1], 80),
    inquiry_date: parseDate(match[2]),
    type: 'hard_inquiry'
  }));
}

function issue(id, account, type, severity, title, evidence, rule, strategy, extras = {}) {
  const severityScore = severity === 'high' ? 90 : severity === 'medium' ? 65 : 38;
  return {
    id,
    account_id: account?.id || null,
    creditor: account?.creditor_name || 'Review report item',
    bureau: account?.bureau || 'All',
    type,
    severity,
    title,
    evidence,
    applicable_law: rule,
    metro2_rule: extras.metro2_rule || null,
    recommended_strategy: strategy,
    dispute_confidence: clamp(severityScore + (extras.confidenceBoost || 0), 1, 99),
    priority_score: clamp(severityScore + (account?.is_collection ? 5 : 0) + (account?.is_charge_off ? 6 : 0), 1, 99),
    difficulty_rating: extras.difficulty || (severity === 'high' ? 'Medium' : severity === 'medium' ? 'Medium' : 'Hard'),
    estimated_score_impact: extras.impact || 'Not estimated — depends on verified report facts',
    time_estimate: extras.time || '30–45 days after delivery',
    round_number: extras.round || 1,
    expected_bureau_response: extras.expected || 'Verified, updated, deleted, or request for more information',
    alternative_strategy: extras.alternative || 'Direct furnisher dispute or CFPB complaint if the bureau response is incomplete',
    supporting_evidence: extras.supporting_evidence || []
  };
}

function validateAccount(account, allAccounts, index) {
  const issues = [];
  const lowerStatus = `${account.account_status} ${account.payment_status} ${account.remarks}`.toLowerCase();
  const dofdYears = yearsSince(account.date_of_first_delinquency);
  const duplicate = allAccounts.find((other, otherIndex) => (
    otherIndex !== index &&
    other.creditor_name === account.creditor_name &&
    account.account_number_masked &&
    other.account_number_masked === account.account_number_masked
  ));

  if (duplicate) {
    issues.push(issue(`dup-${index}`, account, 'duplicate_account', 'medium', 'Possible duplicate account', 'Same creditor and masked account number appears more than once.', 'FCRA §611', 'Request bureau verification and deletion/correction of duplicate reporting.', {
      metro2_rule: 'Only one accurate tradeline should report for the same account obligation.',
      impact: 'Potential duplicate debt/utilization impact'
    }));
  }
  if ((account.is_collection || account.is_charge_off) && !account.date_of_first_delinquency) {
    issues.push(issue(`missing-dofd-${index}`, account, 'missing_dofd', 'medium', 'Missing Date of First Delinquency', 'Collection/charge-off item does not clearly expose DOFD in extracted text.', 'FCRA §605 / §611', 'Request verification of DOFD and reporting period.', {
      metro2_rule: 'DOFD controls obsolescence reporting.',
      supporting_evidence: ['Original creditor records', 'Statements around first missed payment']
    }));
  }
  if (dofdYears != null && dofdYears >= 7) {
    issues.push(issue(`obsolete-${index}`, account, 'obsolete_account', 'high', 'Potential obsolete reporting', `DOFD appears about ${dofdYears.toFixed(1)} years old.`, 'FCRA §605(a)', 'Dispute as obsolete/outside reporting period.', {
      confidenceBoost: 5,
      impact: 'Potentially meaningful if obsolete reporting is removed',
      expected: 'Deleted, corrected date, or verified with documented DOFD'
    }));
  }
  if (account.balance != null && account.credit_limit != null && account.credit_limit > 0 && account.balance > account.credit_limit) {
    issues.push(issue(`balance-limit-${index}`, account, 'balance_error', 'high', 'Balance exceeds credit limit', `Balance ${account.balance} is higher than limit ${account.credit_limit}.`, 'FCRA §611', 'Dispute balance/limit accuracy as a Metro 2 inconsistency.', {
      metro2_rule: 'Current balance and credit limit fields should not create impossible utilization.',
      impact: 'May improve utilization if corrected'
    }));
  }
  if (/closed/.test(lowerStatus) && /open/.test(lowerStatus)) {
    issues.push(issue(`closed-open-${index}`, account, 'wrong_status', 'medium', 'Closed/open status conflict', 'Extracted status contains both closed and open/current language.', 'FCRA §611 / §623', 'Request status correction or complete verification.', {
      metro2_rule: 'Account status and payment rating should be internally consistent.'
    }));
  }
  if (account.is_charge_off && /current|pays as agreed/.test(lowerStatus)) {
    issues.push(issue(`chargeoff-status-${index}`, account, 'wrong_status', 'medium', 'Charge-off status inconsistency', 'Charge-off language conflicts with current/pays-as-agreed language.', 'FCRA §611 / Metro 2', 'Dispute internally inconsistent payment/account status.', {
      metro2_rule: 'Charge-off reporting should align with payment rating and account status.'
    }));
  }
  if (account.late_payments.length >= 2) {
    issues.push(issue(`late-sequence-${index}`, account, 'late_payment_sequence', 'medium', 'Late-payment sequence needs review', `Detected ${account.late_payments.join(', ')}.`, 'FCRA §611', 'Compare payment history grid against statements and dispute unverifiable late marks.', {
      supporting_evidence: ['Bank statements', 'Payment confirmations', 'Creditor statements'],
      difficulty: 'Hard'
    }));
  }
  if (!account.date_reported && !account.date_updated) {
    issues.push(issue(`missing-reported-${index}`, account, 'missing_dates', 'low', 'Missing reported/updated date', 'Date reported or updated was not clearly detected.', 'FCRA §607(b) / §611', 'Manual review before dispute; request complete verification if missing in bureau file.', {
      difficulty: 'Hard'
    }));
  }
  return issues;
}

function validatePersonalInfo(personal) {
  const issues = [];
  if ((personal.names || []).length > 1) {
    issues.push(issue('mixed-name', null, 'mixed_file', 'medium', 'Name variations detected', `${personal.names.length} name variations were detected.`, 'FCRA §607(b) / §611', 'Review whether variations belong to the consumer; dispute inaccurate identity data.', {
      supporting_evidence: ['Driver license', 'Social Security card', 'Proof of legal name']
    }));
  }
  if ((personal.addresses || []).length > 4) {
    issues.push(issue('address-mismatch', null, 'address_mismatch', 'low', 'Multiple address variations detected', `${personal.addresses.length} addresses were detected.`, 'FCRA §611', 'Dispute obsolete or incorrect addresses if they do not belong to the consumer.', {
      difficulty: 'Hard',
      supporting_evidence: ['Utility bill', 'Bank statement', 'Lease/mortgage statement']
    }));
  }
  return issues;
}

export function normalizeCreditReport(reportText = '') {
  const text = normalizeText(reportText);
  const source = detectReportSource(text);
  const sections = extractSections(text);
  const personal_information = extractPersonalInfo(text);
  const scoreData = extractScores(text);
  const accountBlocks = splitAccountBlocks(text);
  const accounts = accountBlocks
    .map((block, index) => normalizeAccount(block, index, source.bureau === 'Unknown' ? 'All' : source.bureau))
    .filter(account => account.creditor_name !== 'Review report item' || /collection|charge|late|balance|account|inquiry/i.test(account.source_excerpt))
    .slice(0, 50);
  const inquiries = extractInquiries(text);
  const totalLimit = accounts.reduce((sum, account) => sum + (account.credit_limit || 0), 0);
  const totalBalance = accounts.reduce((sum, account) => sum + (account.balance || 0), 0);
  const utilization = totalLimit > 0 ? Math.round((totalBalance / totalLimit) * 100) : null;

  return {
    source: source.source,
    bureau: source.bureau,
    bureaus_detected: source.bureaus,
    personal_information,
    scores: scoreData.scores,
    generic_score: scoreData.generic_score,
    sections,
    accounts,
    collections: accounts.filter(account => account.is_collection),
    charge_offs: accounts.filter(account => account.is_charge_off),
    student_loans: accounts.filter(account => account.is_student_loan),
    hard_inquiries: inquiries,
    utilization: {
      total_balance: totalBalance || null,
      total_credit_limit: totalLimit || null,
      utilization_percent: utilization
    },
    parser_confidence: clamp(
      35 +
      Math.min(accounts.length, 10) * 4 +
      Object.values(sections).filter(section => section.detected).length * 3 +
      (text.length > 3000 ? 12 : text.length > 800 ? 6 : 0),
      1,
      96
    )
  };
}

export function runCreditValidationChecks(normalizedReport = {}) {
  const accounts = Array.isArray(normalizedReport.accounts) ? normalizedReport.accounts : [];
  const accountIssues = accounts.flatMap((account, index) => validateAccount(account, accounts, index));
  const personalIssues = validatePersonalInfo(normalizedReport.personal_information || {});
  const utilization = normalizedReport.utilization?.utilization_percent;
  const utilizationIssues = utilization > 49
    ? [issue('high-utilization', null, 'utilization', 'high', 'High utilization detected', `Aggregate utilization appears near ${utilization}%.`, 'Funding underwriting / credit scoring factor', 'Prioritize utilization reduction before new funding applications.', {
        impact: 'May materially affect funding readiness',
        time: 'As soon as balances update',
        alternative: 'Ask creditors for limit updates only after balances are optimized'
      })]
    : utilization > 29
      ? [issue('medium-utilization', null, 'utilization', 'medium', 'Utilization above common funding target', `Aggregate utilization appears near ${utilization}%.`, 'Funding underwriting / credit scoring factor', 'Target under 30%, then under 10% for stronger readiness.', {
          impact: 'May improve readiness when balances report lower',
          time: 'One reporting cycle'
        })]
      : [];
  return [...personalIssues, ...accountIssues, ...utilizationIssues]
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 100);
}

function issueToDispute(issueItem, normalizedReport, index) {
  const account = (normalizedReport.accounts || []).find(item => item.id === issueItem.account_id) || {};
  const typeMap = {
    duplicate_account: 'duplicate',
    duplicate_collection: 'duplicate',
    missing_dofd: 'outdated',
    obsolete_account: 'outdated',
    balance_error: 'balance_error',
    wrong_status: 'other',
    late_payment_sequence: 'late_payment',
    mixed_file: 'identity',
    address_mismatch: 'identity',
    utilization: 'other'
  };
  return {
    id: String(index + 1),
    priority: issueItem.priority_score >= 80 ? 'high' : issueItem.priority_score >= 55 ? 'medium' : 'low',
    type: typeMap[issueItem.type] || 'other',
    creditor: issueItem.creditor || account.creditor_name || 'Review report item',
    account: account.account_number_masked || 'Review report',
    account_number: account.account_number_masked || '',
    account_type: account.account_type || issueItem.type,
    balance: account.balance != null ? `$${account.balance}` : null,
    credit_limit: account.credit_limit != null ? `$${account.credit_limit}` : null,
    payment_status: account.payment_status || account.account_status || 'Unknown',
    late_payments: account.late_payments?.join(', ') || null,
    charge_off: !!account.is_charge_off,
    collection: !!account.is_collection,
    inquiry_date: null,
    opened_date: account.date_opened || null,
    reported_date: account.date_reported || null,
    first_delinquency_date: account.date_of_first_delinquency || null,
    months_late: account.late_payments?.join(', ') || null,
    delinquency_age: null,
    bureau_response_text: null,
    bureau: issueItem.bureau || account.bureau || normalizedReport.bureau || 'All',
    violation: issueItem.title,
    law: issueItem.applicable_law,
    metro2_rule: issueItem.metro2_rule,
    strategy: issueItem.recommended_strategy,
    reason: issueItem.evidence,
    supporting_evidence: issueItem.supporting_evidence,
    likelihood_of_success: `${issueItem.dispute_confidence}/100 confidence — review required`,
    priority_score: issueItem.priority_score,
    dispute_confidence: issueItem.dispute_confidence,
    difficulty_rating: issueItem.difficulty_rating,
    time_estimate: issueItem.time_estimate,
    round_number: issueItem.round_number,
    expected_bureau_response: issueItem.expected_bureau_response,
    alternative_strategy: issueItem.alternative_strategy,
    estimated_impact: issueItem.estimated_score_impact
  };
}

export function calculateFundingReadiness(normalizedReport = {}, issues = []) {
  const utilization = normalizedReport.utilization?.utilization_percent;
  const high = issues.filter(item => item.severity === 'high').length;
  const medium = issues.filter(item => item.severity === 'medium').length;
  const inquiries = (normalizedReport.hard_inquiries || []).length;
  const derogatory = (normalizedReport.collections || []).length + (normalizedReport.charge_offs || []).length;
  const utilizationPenalty = utilization == null ? 8 : utilization > 79 ? 28 : utilization > 49 ? 20 : utilization > 29 ? 12 : utilization > 9 ? 5 : 0;
  const score = clamp(78 - high * 8 - medium * 4 - derogatory * 5 - inquiries * 2 - utilizationPenalty, 1, 100);
  const recommendations = [];
  if (utilization == null) recommendations.push('Add balances and limits or upload a clearer report so utilization can be calculated.');
  else if (utilization > 29) recommendations.push('Prioritize balance paydown below 30%, then below 10%, before funding applications.');
  if (derogatory) recommendations.push('Resolve or dispute inaccurate collections/charge-offs before seeking larger funding.');
  if (inquiries > 3) recommendations.push('Pause unnecessary hard inquiries while the profile stabilizes.');
  if (!recommendations.length) recommendations.push('Maintain low utilization and avoid new derogatory reporting.');
  return {
    score,
    personal_funding_readiness: score,
    business_funding_readiness: null,
    utilization_percent: utilization,
    derogatory_count: derogatory,
    hard_inquiry_count: inquiries,
    next_score_target: score < 70 ? 'Strengthen profile toward 700+ before aggressive funding moves.' : 'Maintain 720+ readiness behaviors where possible.',
    approval_odds_note: 'CREDITOS does not fabricate approvals. Funding guidance is directional and depends on lender underwriting.',
    recommendations
  };
}

export function buildCreditIntelligenceAnalysis(reportText = {}, options = {}) {
  const text = String(reportText || '');
  const normalized_report = normalizeCreditReport(text);
  const validation_checks = runCreditValidationChecks(normalized_report);
  const disputes = validation_checks
    .filter(item => !['utilization'].includes(item.type))
    .map((item, index) => issueToDispute(item, normalized_report, index));
  const funding_intelligence = calculateFundingReadiness(normalized_report, validation_checks);
  const high = disputes.filter(item => item.priority === 'high').length;
  const medium = disputes.filter(item => item.priority === 'medium').length;
  const low = disputes.filter(item => item.priority === 'low').length;
  const reason = options.reason ? `${options.reason}. ` : '';

  return {
    summary: {
      total_items: disputes.length,
      high_priority: high,
      medium_priority: medium,
      low_priority: low,
      consumer_name: normalized_report.personal_information.names?.[0] || null,
      bureau_name: normalized_report.bureau === 'Merged / tri-bureau' ? null : normalized_report.bureau,
      bureau_scores: normalized_report.scores,
      estimated_score_impact: 'Not guaranteed — depends on verified corrections and scoring model',
      report_summary: `${reason}Normalized ${normalized_report.accounts.length} account block(s), ${normalized_report.collections.length} collection(s), ${normalized_report.charge_offs.length} charge-off(s), and ${normalized_report.hard_inquiries.length} hard inquiry candidate(s).`
    },
    normalized_report,
    validation_checks,
    funding_intelligence,
    disputes,
    positive_items: normalized_report.parser_confidence >= 70 ? ['Report structure was readable enough for normalized analysis.'] : [],
    action_plan: [
      'Review high-priority Metro 2/FCRA issues first.',
      'Confirm account names, dates, balances, and DOFD against the original report.',
      'Generate draft disputes only for items you approve.',
      'Track certified-mail dates and bureau responses for 30/45-day follow-up.',
      'Use CFPB escalation only when a verified/no-response pattern justifies it.'
    ],
    intelligence_version: 'credit-intelligence-v1'
  };
}

export function enhanceCreditAnalysis(aiAnalysis = {}, reportText = '') {
  const intelligence = buildCreditIntelligenceAnalysis(reportText);
  const aiDisputes = Array.isArray(aiAnalysis?.disputes) ? aiAnalysis.disputes : [];
  const disputes = aiDisputes.length
    ? aiDisputes.map((item, index) => {
        const matching = intelligence.disputes.find(candidate =>
          cleanText(candidate.creditor).toLowerCase() === cleanText(item.creditor).toLowerCase()
          || (candidate.account_number && item.account_number && candidate.account_number === maskAccountNumber(item.account_number))
        );
        return {
          ...item,
          account_number: maskAccountNumber(item.account_number || item.account || matching?.account_number || ''),
          priority_score: item.priority_score ?? matching?.priority_score ?? (item.priority === 'high' ? 85 : item.priority === 'medium' ? 62 : 38),
          dispute_confidence: item.dispute_confidence ?? matching?.dispute_confidence ?? null,
          difficulty_rating: item.difficulty_rating || matching?.difficulty_rating || 'Review required',
          time_estimate: item.time_estimate || matching?.time_estimate || '30–45 days after delivery',
          reason: item.reason || matching?.reason || item.violation || '',
          supporting_evidence: item.supporting_evidence || matching?.supporting_evidence || [],
          metro2_rule: item.metro2_rule || matching?.metro2_rule || null,
          expected_bureau_response: item.expected_bureau_response || matching?.expected_bureau_response || 'Verified, updated, deleted, or request for more information',
          alternative_strategy: item.alternative_strategy || matching?.alternative_strategy || 'Method of verification or direct furnisher dispute if verified'
        };
      })
    : intelligence.disputes;

  return {
    ...intelligence,
    ...aiAnalysis,
    summary: {
      ...intelligence.summary,
      ...(aiAnalysis.summary && typeof aiAnalysis.summary === 'object' ? aiAnalysis.summary : {}),
      bureau_scores: intelligence.normalized_report.scores
    },
    normalized_report: intelligence.normalized_report,
    validation_checks: intelligence.validation_checks,
    funding_intelligence: intelligence.funding_intelligence,
    disputes,
    action_plan: Array.isArray(aiAnalysis.action_plan) && aiAnalysis.action_plan.length ? aiAnalysis.action_plan : intelligence.action_plan,
    intelligence_version: intelligence.intelligence_version
  };
}
