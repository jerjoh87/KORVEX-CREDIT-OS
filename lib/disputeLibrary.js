// ─────────────────────────────────────────────
//  CREDITOS — Dispute Letter Library
//  lib/disputeLibrary.js
//
//  Pure data + helpers. No I/O, no AI. Every template is consumer
//  self-help (first person, factual) with the controlling statute cited.
//  Letters are assembled from a shared header/footer + template-specific
//  body so the library stays DRY and consistent.
// ─────────────────────────────────────────────

// Standard credit-bureau dispute addresses.
export const BUREAU_ADDRESSES = {
  Experian:    'Experian\nP.O. Box 4500\nAllen, TX 75013',
  Equifax:     'Equifax Information Services LLC\nP.O. Box 740256\nAtlanta, GA 30374',
  TransUnion:  'TransUnion Consumer Solutions\nP.O. Box 2000\nChester, PA 19016',
};

// recipient kinds → who the letter is addressed to.
export const RECIPIENTS = {
  bureau:    'Credit bureau',
  furnisher: 'Original creditor / furnisher',
  collector: 'Debt collector',
  cfpb:      'Consumer Financial Protection Bureau',
};

export const CATEGORIES = [
  { id: 'inaccurate',     label: 'Inaccurate Information', icon: 'fact_check',      blurb: 'Errors in how an account is reported.' },
  { id: 'identity-theft', label: 'Identity Theft',         icon: 'gpp_bad',         blurb: 'Fraudulent accounts, inquiries, and FCRA §605B blocks.' },
  { id: 'collections',    label: 'Collection Accounts',    icon: 'call',            blurb: 'Validation, verification, and medical/paid collections.' },
  { id: 'charge-offs',    label: 'Charge-Offs',            icon: 'money_off',       blurb: 'Balance, payment history, and ownership of charge-offs.' },
  { id: 'public-records', label: 'Public Records',         icon: 'gavel',           blurb: 'Bankruptcies, judgments, and tax liens.' },
  { id: 'inquiries',      label: 'Inquiries',              icon: 'search',          blurb: 'Unauthorized and impermissible hard inquiries.' },
  { id: 'personal-info',  label: 'Personal Information',   icon: 'badge',           blurb: 'Addresses, employers, names, and SSN corrections.' },
  { id: 'goodwill',       label: 'Goodwill Letters',       icon: 'volunteer_activism', blurb: 'Polite requests to remove accurate late marks.' },
  { id: 'creditor-direct',label: 'Creditor Direct Disputes', icon: 'business',      blurb: 'Disputes sent straight to the furnisher.' },
];

// ── Template definitions ──────────────────────────────────────────────────────
// Each: { id, category, label, recipient, strategy, legalBasis[], summary,
//         suggestedDocuments[], reLine, paragraphs[], demand }
const TEMPLATES = [
  // ════════ INACCURATE INFORMATION ════════
  {
    id: 'incorrect-late-payment', category: 'inaccurate', label: 'Incorrect Late Payment',
    recipient: 'bureau', strategy: 'Factual Accuracy Dispute', legalBasis: ['FCRA §611', 'FCRA §623'],
    summary: 'A late payment is reporting that was actually paid on time.',
    suggestedDocuments: ['Bank/payment confirmations', 'Cancelled checks', 'Statements showing on-time payment'],
    reLine: 'Dispute of inaccurate late-payment notation — {{creditor}}, account {{accountNumber}}',
    paragraphs: [
      'I am disputing a late-payment notation reported on my file for the account referenced above. This payment was made on time, and the late mark is inaccurate.',
      'Under FCRA §611, you are required to conduct a reasonable reinvestigation of this disputed item. The furnisher is separately obligated under FCRA §623 to report only accurate, verifiable information.',
    ],
    demand: 'Please investigate this item, correct the payment history to reflect on-time status, and send me an updated copy of my report.',
  },
  {
    id: 'incorrect-balance', category: 'inaccurate', label: 'Incorrect Balance',
    recipient: 'bureau', strategy: 'Metro 2 Compliance Dispute', legalBasis: ['FCRA §611', 'CDIA Metro 2 Format'],
    summary: 'The balance reported does not match the true account balance.',
    suggestedDocuments: ['Most recent account statement', 'Payoff letter', 'Payment receipts'],
    reLine: 'Dispute of inaccurate balance — {{creditor}}, account {{accountNumber}}',
    paragraphs: [
      'The balance reported for the account above is inaccurate and does not match my records. Reporting an incorrect Current Balance is inconsistent with the CDIA Metro 2 reporting standard furnishers are expected to follow.',
      'I dispute this balance and request a reasonable reinvestigation under FCRA §611.',
    ],
    demand: 'Please verify the exact balance with the furnisher and correct it, or delete the item if it cannot be verified.',
  },
  {
    id: 'incorrect-credit-limit', category: 'inaccurate', label: 'Incorrect Credit Limit',
    recipient: 'bureau', strategy: 'Metro 2 Compliance Dispute', legalBasis: ['FCRA §611', 'CDIA Metro 2 Format'],
    summary: 'A missing or wrong credit limit is distorting utilization.',
    suggestedDocuments: ['Card statement showing the credit limit', 'Credit limit increase letter'],
    reLine: 'Dispute of inaccurate credit limit — {{creditor}}, account {{accountNumber}}',
    paragraphs: [
      'The credit limit reported for the account above is incorrect or missing. An inaccurate High Credit / Credit Limit field misstates my utilization and is inconsistent with the Metro 2 reporting standard.',
      'I dispute this field under FCRA §611 and request that the correct credit limit be reported.',
    ],
    demand: 'Please correct the reported credit limit to match the furnisher’s records.',
  },
  {
    id: 'incorrect-account-status', category: 'inaccurate', label: 'Incorrect Account Status',
    recipient: 'bureau', strategy: 'Factual Accuracy Dispute', legalBasis: ['FCRA §611', 'FCRA §623'],
    summary: 'Status (e.g., open/closed/charge-off) is reporting incorrectly.',
    suggestedDocuments: ['Closing confirmation', 'Settlement/payoff letter', 'Account statements'],
    reLine: 'Dispute of inaccurate account status — {{creditor}}, account {{accountNumber}}',
    paragraphs: [
      'The account status reported for the account above is inaccurate. The current status does not reflect the true condition of the account.',
      'I request a reasonable reinvestigation under FCRA §611 and correction of the reported status.',
    ],
    demand: 'Please correct the account status, or delete the tradeline if the status cannot be verified.',
  },
  {
    id: 'incorrect-payment-history', category: 'inaccurate', label: 'Incorrect Payment History',
    recipient: 'bureau', strategy: 'Metro 2 Compliance Dispute', legalBasis: ['FCRA §611', 'CDIA Metro 2 Format'],
    summary: 'The month-by-month payment grid contains errors or inconsistencies.',
    suggestedDocuments: ['12–24 months of statements', 'Payment confirmations'],
    reLine: 'Dispute of inaccurate payment history — {{creditor}}, account {{accountNumber}}',
    paragraphs: [
      'The payment history grid for the account above contains inaccuracies and internal inconsistencies. Payment History Profile errors of this kind are inconsistent with Metro 2 reporting requirements.',
      'I dispute the payment history under FCRA §611 and request that it be reinvestigated and corrected.',
    ],
    demand: 'Please correct each inaccurate month, or delete the tradeline if the history cannot be verified.',
  },
  {
    id: 'incorrect-account-dates', category: 'inaccurate', label: 'Incorrect Account Dates',
    recipient: 'bureau', strategy: 'Metro 2 Compliance Dispute', legalBasis: ['FCRA §611', 'FCRA §605'],
    summary: 'Date opened, date of last activity, or DOFD is wrong.',
    suggestedDocuments: ['Original account opening documents', 'Statements showing last activity'],
    reLine: 'Dispute of inaccurate account dates — {{creditor}}, account {{accountNumber}}',
    paragraphs: [
      'One or more dates reported for the account above are inaccurate. An incorrect Date of First Delinquency can also unlawfully extend the FCRA §605 reporting period.',
      'I dispute these dates under FCRA §611 and request that they be corrected to match the original records.',
    ],
    demand: 'Please correct the reported dates, including the Date of First Delinquency, or delete the item if they cannot be verified.',
  },
  {
    id: 'method-of-verification', category: 'inaccurate', label: 'Method of Verification Request',
    recipient: 'bureau', strategy: 'Method of Verification Request', legalBasis: ['FCRA §611(a)(6)', 'FCRA §611(a)(7)'],
    summary: 'Ask how a bureau verified an item after a prior dispute.',
    suggestedDocuments: ['Prior dispute letter', 'Bureau investigation result', 'Certified mail receipt', 'Supporting evidence already submitted'],
    reLine: 'Method of verification request — {{creditor}}, account {{accountNumber}}',
    paragraphs: [
      'I previously disputed the account referenced above and received a response stating that the information was verified. The response did not explain the method used to verify the disputed information.',
      'Under FCRA §611(a)(6) and §611(a)(7), I request a description of the procedure used to determine the accuracy and completeness of this information, including the name, address, and telephone number of each furnisher contacted.',
    ],
    demand: 'Please provide the method of verification and the investigation details, or delete/correct the account if the information cannot be fully verified.',
  },
  {
    id: 'incorrect-personal-information', category: 'inaccurate', label: 'Incorrect Personal Information',
    recipient: 'bureau', strategy: 'Factual Accuracy Dispute', legalBasis: ['FCRA §611'],
    summary: 'Name, address, or other identifying data is wrong.',
    suggestedDocuments: ['Government ID', 'Utility bill / proof of address'],
    reLine: 'Correction of inaccurate personal information on my credit file',
    paragraphs: [
      'My credit file contains inaccurate personal information. Incorrect identifiers can cause my file to be merged with another consumer’s and produce inaccurate reporting.',
      'I request that the inaccurate personal information be corrected or removed under FCRA §611.',
    ],
    demand: 'Please update my file to reflect only my correct, current personal information.',
  },
  {
    id: 'mixed-credit-file', category: 'inaccurate', label: 'Mixed Credit File',
    recipient: 'bureau', strategy: 'FCRA Investigation Request', legalBasis: ['FCRA §611', 'FCRA §607(b)'],
    summary: 'Accounts belonging to another person appear on my report.',
    suggestedDocuments: ['Government ID', 'Proof of SSN', 'Proof of address history'],
    reLine: 'Mixed credit file — accounts that do not belong to me',
    paragraphs: [
      'My credit file appears to be mixed with another consumer’s. One or more accounts, addresses, or identifiers on my report do not belong to me.',
      'Under FCRA §607(b) you must maintain reasonable procedures to assure maximum possible accuracy. I request a reinvestigation under FCRA §611 to identify and remove all information that is not mine.',
    ],
    demand: 'Please separate my file from any other consumer’s data and remove every account and identifier that is not mine.',
  },
  {
    id: 'identity-confusion', category: 'inaccurate', label: 'Identity Confusion',
    recipient: 'bureau', strategy: 'FCRA Investigation Request', legalBasis: ['FCRA §611', 'FCRA §607(b)'],
    summary: 'Similar name/SSN is causing another person’s data to appear.',
    suggestedDocuments: ['Government ID', 'SSN card', 'Proof of address'],
    reLine: 'Identity confusion on my credit file',
    paragraphs: [
      'Information belonging to another individual with a similar name or Social Security number is appearing on my credit file. This identity confusion is producing inaccurate reporting.',
      'I request a reasonable reinvestigation under FCRA §611 and removal of all data that does not belong to me.',
    ],
    demand: 'Please verify my identifiers and remove any information associated with a different consumer.',
  },

  // ════════ IDENTITY THEFT ════════
  {
    id: 'fraudulent-account', category: 'identity-theft', label: 'Fraudulent Account',
    recipient: 'bureau', strategy: 'Identity Theft Dispute', legalBasis: ['FCRA §605B', 'FCRA §611'],
    summary: 'An account opened by an identity thief is on my report.',
    suggestedDocuments: ['FTC Identity Theft Report (IdentityTheft.gov)', 'Government ID', 'Police report (if filed)'],
    reLine: 'Block and removal of fraudulent account — {{creditor}}, account {{accountNumber}}',
    paragraphs: [
      'The account referenced above was opened fraudulently as a result of identity theft. It is not mine and I never authorized it.',
      'Under FCRA §605B, you are required to block information resulting from identity theft within four business days of receiving my identity theft report and proof of identity. I have enclosed the required documentation.',
    ],
    demand: 'Please block and remove this fraudulent account from my credit file and notify the furnisher.',
  },
  {
    id: 'unauthorized-inquiry-idtheft', category: 'identity-theft', label: 'Fraudulent Inquiry',
    recipient: 'bureau', strategy: 'Identity Theft Dispute', legalBasis: ['FCRA §605B', 'FCRA §611'],
    summary: 'A hard inquiry resulted from identity theft.',
    suggestedDocuments: ['FTC Identity Theft Report', 'Government ID'],
    reLine: 'Removal of fraudulent inquiry — {{creditor}}',
    paragraphs: [
      'A hard inquiry from the company above appears on my credit file as a result of identity theft. I did not apply for credit with this company and did not authorize this inquiry.',
      'Under FCRA §605B, please block and remove information resulting from identity theft based on the enclosed identity theft report.',
    ],
    demand: 'Please remove this fraudulent inquiry from my credit file.',
  },
  {
    id: 'identity-theft-affidavit', category: 'identity-theft', label: 'Identity Theft Affidavit Dispute',
    recipient: 'bureau', strategy: 'Identity Theft Dispute', legalBasis: ['FCRA §605B', 'FCRA §611'],
    summary: 'Submitting an identity theft affidavit to support a block.',
    suggestedDocuments: ['Completed FTC Identity Theft Affidavit', 'Government ID', 'Proof of address'],
    reLine: 'Identity theft affidavit — block of fraudulent information',
    paragraphs: [
      'I am a victim of identity theft. Enclosed is my completed identity theft affidavit and proof of identity in support of this dispute.',
      'Pursuant to FCRA §605B, please block all information identified in my affidavit as resulting from identity theft.',
    ],
    demand: 'Please block the fraudulent items listed in my affidavit and confirm in writing.',
  },
  {
    id: 'ftc-identity-theft', category: 'identity-theft', label: 'FTC Identity Theft Report Dispute',
    recipient: 'bureau', strategy: 'Identity Theft Dispute', legalBasis: ['FCRA §605B'],
    summary: 'Using an IdentityTheft.gov report to demand a §605B block.',
    suggestedDocuments: ['FTC Identity Theft Report from IdentityTheft.gov', 'Government ID'],
    reLine: 'FCRA §605B block request supported by FTC Identity Theft Report',
    paragraphs: [
      'Enclosed is my FTC Identity Theft Report obtained from IdentityTheft.gov, together with proof of my identity.',
      'FCRA §605B requires you to block information that I identify as resulting from identity theft within four business days of receiving this report. The fraudulent items are listed below.',
    ],
    demand: 'Please block and delete every item identified in my FTC report and notify each furnisher.',
  },
  {
    id: 'police-report-dispute', category: 'identity-theft', label: 'Police Report Supported Dispute',
    recipient: 'bureau', strategy: 'Identity Theft Dispute', legalBasis: ['FCRA §605B', 'FCRA §611'],
    summary: 'A filed police report supports an identity theft block.',
    suggestedDocuments: ['Filed police report', 'Government ID', 'FTC Identity Theft Report'],
    reLine: 'Identity theft dispute supported by police report',
    paragraphs: [
      'I have filed a police report regarding identity theft. A copy is enclosed along with proof of my identity.',
      'Under FCRA §605B, please block the fraudulent items identified below that resulted from this identity theft.',
    ],
    demand: 'Please block and remove the listed fraudulent items based on the enclosed police report.',
  },

  // ════════ COLLECTION ACCOUNTS ════════
  {
    id: 'debt-validation', category: 'collections', label: 'Debt Validation Request',
    recipient: 'collector', strategy: 'Debt Validation Dispute', legalBasis: ['FDCPA §809(b)'],
    summary: 'Require a collector to validate the debt before paying.',
    suggestedDocuments: ['None required — keep your copy and proof of mailing'],
    reLine: 'Debt validation request — account {{accountNumber}}',
    paragraphs: [
      'I am responding to your contact about the debt referenced above. I dispute this debt and request validation, not verification.',
      'Under FDCPA §809(b), please provide: (1) the amount of the debt; (2) the name of the original creditor; (3) proof that you own or are authorized to collect this debt; and (4) a copy of the original signed agreement. Until validation is provided, please cease collection activity and do not report this account.',
    ],
    demand: 'Please mail complete validation of this debt or cease collection and delete any related reporting.',
  },
  {
    id: 'collection-verification', category: 'collections', label: 'Collection Account Verification',
    recipient: 'bureau', strategy: 'FCRA Investigation Request', legalBasis: ['FCRA §611'],
    summary: 'Ask the bureau to verify a collection that may be inaccurate.',
    suggestedDocuments: ['Any payment records', 'Prior correspondence'],
    reLine: 'Dispute of collection account — {{creditor}}, account {{accountNumber}}',
    paragraphs: [
      'I dispute the collection account referenced above as inaccurate and/or unverifiable.',
      'Under FCRA §611, please conduct a reasonable reinvestigation and require the furnisher to produce documentation verifying the debt, the balance, and the dates.',
    ],
    demand: 'Please verify the account in full or delete it from my credit file.',
  },
  {
    id: 'medical-collection', category: 'collections', label: 'Medical Collection Dispute',
    recipient: 'bureau', strategy: 'Factual Accuracy Dispute', legalBasis: ['FCRA §611', 'HIPAA'],
    summary: 'Dispute a medical collection (incl. paid/<$500 reporting rules).',
    suggestedDocuments: ['Explanation of Benefits (EOB)', 'Proof of payment', 'Insurance correspondence'],
    reLine: 'Dispute of medical collection — account {{accountNumber}}',
    paragraphs: [
      'I dispute the medical collection referenced above. Paid medical collections, and unpaid medical collections under the nationwide credit bureaus’ current reporting thresholds, should not appear on my report.',
      'I also have not authorized the disclosure of protected health information beyond what is permitted. Please reinvestigate under FCRA §611.',
    ],
    demand: 'Please verify this medical collection complies with current reporting rules or delete it.',
  },
  {
    id: 'paid-collection-removal', category: 'collections', label: 'Paid Collection Removal Request',
    recipient: 'collector', strategy: 'Goodwill Strategy', legalBasis: ['FCRA §623'],
    summary: 'Request deletion of a collection you have already paid.',
    suggestedDocuments: ['Proof of payment / paid-in-full letter'],
    reLine: 'Request to delete paid collection — account {{accountNumber}}',
    paragraphs: [
      'The collection account referenced above has been paid in full, as shown by the enclosed documentation.',
      'As a gesture of goodwill, I respectfully request that you delete this paid collection from all credit bureaus rather than reporting it as “paid.” A paid collection still harms my standing despite the zero balance.',
    ],
    demand: 'Please request deletion of this paid collection with all three bureaus and confirm in writing.',
  },
  {
    id: 'duplicate-collection', category: 'collections', label: 'Duplicate Collection Dispute',
    recipient: 'bureau', strategy: 'Factual Accuracy Dispute', legalBasis: ['FCRA §611'],
    summary: 'The same debt is reported by more than one collector.',
    suggestedDocuments: ['Both tradeline screenshots showing the duplication'],
    reLine: 'Duplicate reporting of the same debt — account {{accountNumber}}',
    paragraphs: [
      'The same underlying debt is being reported more than once on my credit file, which overstates my obligations and is inaccurate.',
      'I dispute the duplicate reporting under FCRA §611 and request that no more than one accurate tradeline for this debt remain.',
    ],
    demand: 'Please remove the duplicate collection so the debt is not reported twice.',
  },
  {
    id: 'out-of-statute-debt', category: 'collections', label: 'Out-of-Statute / Obsolete Debt',
    recipient: 'bureau', strategy: 'Factual Accuracy Dispute', legalBasis: ['FCRA §605(a)', 'FCRA §611'],
    summary: 'A debt older than the 7-year reporting window is still reporting.',
    suggestedDocuments: ['Records showing the original delinquency date'],
    reLine: 'Obsolete debt past the FCRA §605 reporting period — account {{accountNumber}}',
    paragraphs: [
      'The account referenced above is past the seven-year reporting period measured from the original Date of First Delinquency and must no longer appear under FCRA §605(a).',
      'I dispute its continued reporting and request deletion under FCRA §611.',
    ],
    demand: 'Please delete this obsolete account, which exceeds the FCRA §605 reporting period.',
  },

  // ════════ CHARGE-OFFS ════════
  {
    id: 'chargeoff-verification', category: 'charge-offs', label: 'Charge-Off Verification',
    recipient: 'bureau', strategy: 'FCRA Investigation Request', legalBasis: ['FCRA §611', 'FCRA §623'],
    summary: 'Require verification of a charge-off’s accuracy.',
    suggestedDocuments: ['Account statements', 'Any settlement correspondence'],
    reLine: 'Dispute of charge-off — {{creditor}}, account {{accountNumber}}',
    paragraphs: [
      'I dispute the charge-off referenced above as inaccurate and/or unverifiable in its current form.',
      'Under FCRA §611, please conduct a reasonable reinvestigation and require the furnisher to verify the balance, dates, and payment history with documentation.',
    ],
    demand: 'Please verify every field of this charge-off or delete it.',
  },
  {
    id: 'chargeoff-balance-accuracy', category: 'charge-offs', label: 'Charge-Off Balance Accuracy',
    recipient: 'bureau', strategy: 'Metro 2 Compliance Dispute', legalBasis: ['FCRA §611', 'CDIA Metro 2 Format'],
    summary: 'A charged-off account still reports a growing or wrong balance.',
    suggestedDocuments: ['Final statement before charge-off', 'Charge-off notice (1099-C if issued)'],
    reLine: 'Inaccurate charge-off balance — {{creditor}}, account {{accountNumber}}',
    paragraphs: [
      'The balance reported on the charged-off account above is inaccurate. A charge-off balance that increases over time or conflicts with the amount charged off is inconsistent with the Metro 2 standard.',
      'I dispute the reported balance under FCRA §611.',
    ],
    demand: 'Please correct the charge-off balance or delete the tradeline if it cannot be verified.',
  },
  {
    id: 'chargeoff-payment-history', category: 'charge-offs', label: 'Charge-Off Payment History',
    recipient: 'bureau', strategy: 'Metro 2 Compliance Dispute', legalBasis: ['FCRA §611', 'CDIA Metro 2 Format'],
    summary: 'Post-charge-off payment grid is inconsistent.',
    suggestedDocuments: ['Statements covering the disputed months'],
    reLine: 'Inaccurate charge-off payment history — {{creditor}}, account {{accountNumber}}',
    paragraphs: [
      'The payment history reported on the charged-off account above is internally inconsistent — for example, continued “late” increments after the date of charge-off — which conflicts with Metro 2 reporting requirements.',
      'I dispute the payment history under FCRA §611.',
    ],
    demand: 'Please correct the inconsistent payment history or delete the tradeline.',
  },
  {
    id: 'chargeoff-ownership-validation', category: 'charge-offs', label: 'Charge-Off Ownership Validation',
    recipient: 'furnisher', strategy: 'Direct Furnisher Dispute', legalBasis: ['FCRA §623(b)', 'FDCPA §809(b)'],
    summary: 'A sold/charged-off debt requires proof of ownership.',
    suggestedDocuments: ['Keep proof of mailing'],
    reLine: 'Request for proof of ownership — charged-off account {{accountNumber}}',
    paragraphs: [
      'You are reporting a charged-off account in my name. I dispute this account directly with you and request proof that you own, or are authorized to report, this debt.',
      'Under FCRA §623(b), you must investigate this direct dispute and report only accurate, verifiable information.',
    ],
    demand: 'Please provide documentation of ownership and accuracy, or cease reporting this account.',
  },

  // ════════ PUBLIC RECORDS ════════
  {
    id: 'bankruptcy-inaccuracy', category: 'public-records', label: 'Bankruptcy Inaccuracy',
    recipient: 'bureau', strategy: 'FCRA Investigation Request', legalBasis: ['FCRA §611', 'FCRA §605'],
    summary: 'A bankruptcy is reporting with wrong details or past the window.',
    suggestedDocuments: ['Court discharge / filing documents'],
    reLine: 'Dispute of inaccurate bankruptcy reporting',
    paragraphs: [
      'The bankruptcy referenced on my credit file is reporting inaccurately — for example, incorrect filing/discharge dates, chapter, or status, or it exceeds the FCRA §605 reporting period.',
      'Bureaus do not obtain bankruptcy data directly from the courts; please conduct a reasonable reinvestigation under FCRA §611 and verify each field or delete it.',
    ],
    demand: 'Please verify the bankruptcy details with a proper source or delete the inaccurate entry.',
  },
  {
    id: 'judgment-dispute', category: 'public-records', label: 'Judgment Dispute',
    recipient: 'bureau', strategy: 'FCRA Investigation Request', legalBasis: ['FCRA §611'],
    summary: 'A civil judgment is inaccurate, satisfied, or not mine.',
    suggestedDocuments: ['Satisfaction of judgment', 'Court records'],
    reLine: 'Dispute of inaccurate judgment',
    paragraphs: [
      'The judgment reported on my file is inaccurate, satisfied, or does not belong to me. Modern public-record standards require strict identifying data that this entry may not meet.',
      'I dispute this judgment under FCRA §611 and request verification or deletion.',
    ],
    demand: 'Please verify the judgment against court records or delete it.',
  },
  {
    id: 'tax-lien-dispute', category: 'public-records', label: 'Tax Lien Dispute',
    recipient: 'bureau', strategy: 'FCRA Investigation Request', legalBasis: ['FCRA §611'],
    summary: 'A tax lien is inaccurate, released, or unverifiable.',
    suggestedDocuments: ['Lien release / Certificate of Release', 'Payment records'],
    reLine: 'Dispute of inaccurate tax lien',
    paragraphs: [
      'The tax lien reported on my file is inaccurate, has been released, or cannot be verified with the required identifying information.',
      'I dispute this tax lien under FCRA §611 and request verification or deletion.',
    ],
    demand: 'Please verify the tax lien with the taxing authority or delete it.',
  },

  // ════════ INQUIRIES ════════
  {
    id: 'unauthorized-hard-inquiry', category: 'inquiries', label: 'Unauthorized Hard Inquiry',
    recipient: 'bureau', strategy: 'Permissible Purpose Dispute', legalBasis: ['FCRA §604', 'FCRA §611'],
    summary: 'A hard inquiry was made without my authorization.',
    suggestedDocuments: ['List of inquiries you do not recognize'],
    reLine: 'Dispute of unauthorized hard inquiry — {{creditor}}',
    paragraphs: [
      'The hard inquiry from the company above appears on my credit file without my authorization. I did not apply for credit and did not give permissible purpose under FCRA §604.',
      'I dispute this inquiry under FCRA §611 and request its removal.',
    ],
    demand: 'Please remove this unauthorized inquiry, or provide proof of my authorization.',
  },
  {
    id: 'permissible-purpose-inquiry', category: 'inquiries', label: 'Permissible Purpose Demand',
    recipient: 'furnisher', strategy: 'Procedural Request', legalBasis: ['FCRA §604', 'FCRA §616'],
    summary: 'Ask the company directly to prove permissible purpose.',
    suggestedDocuments: ['Keep proof of mailing'],
    reLine: 'Demand for proof of permissible purpose — inquiry on {{date}}',
    paragraphs: [
      'Your company accessed my credit report. I did not apply for credit or otherwise initiate a transaction with you, and I am requesting proof of your permissible purpose under FCRA §604.',
      'If you cannot establish a permissible purpose, accessing my report may violate the FCRA and expose your company to liability under §616.',
    ],
    demand: 'Please provide proof of permissible purpose or request removal of this inquiry from the bureaus.',
  },
  {
    id: 'identity-theft-inquiry', category: 'inquiries', label: 'Identity Theft Inquiry',
    recipient: 'bureau', strategy: 'Identity Theft Dispute', legalBasis: ['FCRA §605B', 'FCRA §611'],
    summary: 'An inquiry resulted from identity theft.',
    suggestedDocuments: ['FTC Identity Theft Report', 'Government ID'],
    reLine: 'Removal of identity-theft inquiry — {{creditor}}',
    paragraphs: [
      'The inquiry from the company above resulted from identity theft. I did not apply for credit with this company.',
      'Under FCRA §605B, please block and remove this inquiry based on the enclosed identity theft report.',
    ],
    demand: 'Please remove this identity-theft inquiry from my file.',
  },

  // ════════ PERSONAL INFORMATION ════════
  {
    id: 'address-removal', category: 'personal-info', label: 'Address Removal',
    recipient: 'bureau', strategy: 'Factual Accuracy Dispute', legalBasis: ['FCRA §611'],
    summary: 'Remove an old or incorrect address from the file.',
    suggestedDocuments: ['Proof of current address (utility bill, lease)'],
    reLine: 'Removal of inaccurate address from my credit file',
    paragraphs: [
      'My credit file lists one or more addresses that are inaccurate or are not associated with me. Outdated or incorrect addresses can contribute to mixed files and fraud.',
      'I request removal of the inaccurate address(es) under FCRA §611, leaving only my correct current address.',
    ],
    demand: 'Please remove the inaccurate address(es) and retain only my correct current address.',
  },
  {
    id: 'employment-removal', category: 'personal-info', label: 'Employment Information Removal',
    recipient: 'bureau', strategy: 'Factual Accuracy Dispute', legalBasis: ['FCRA §611'],
    summary: 'Remove outdated/incorrect employer data.',
    suggestedDocuments: ['None required'],
    reLine: 'Removal of inaccurate employment information',
    paragraphs: [
      'My credit file lists employment information that is inaccurate or outdated and was never verified with me.',
      'I request that the inaccurate employment information be removed under FCRA §611.',
    ],
    demand: 'Please remove the inaccurate employment entries from my file.',
  },
  {
    id: 'name-correction', category: 'personal-info', label: 'Name Correction',
    recipient: 'bureau', strategy: 'Factual Accuracy Dispute', legalBasis: ['FCRA §611'],
    summary: 'Correct a misspelled or wrong name / alias.',
    suggestedDocuments: ['Government ID', 'Social Security card'],
    reLine: 'Correction of name on my credit file',
    paragraphs: [
      'My credit file lists a misspelled name or an alias that is not mine. Incorrect names can cause data to be attributed to me in error.',
      'I request correction of my name and removal of any incorrect aliases under FCRA §611.',
    ],
    demand: 'Please correct my name to match my enclosed identification and remove incorrect variations.',
  },
  {
    id: 'ssn-correction', category: 'personal-info', label: 'SSN Correction',
    recipient: 'bureau', strategy: 'Factual Accuracy Dispute', legalBasis: ['FCRA §611', 'FCRA §607(b)'],
    summary: 'Correct a wrong Social Security number on the file.',
    suggestedDocuments: ['Social Security card', 'Government ID'],
    reLine: 'Correction of Social Security number on my credit file',
    paragraphs: [
      'My credit file reflects an incorrect Social Security number. An incorrect SSN is a frequent cause of mixed files and inaccurate reporting under FCRA §607(b).',
      'I request correction of my SSN under FCRA §611 using the enclosed proof.',
    ],
    demand: 'Please correct my Social Security number and re-screen my file for any data attached to the wrong SSN.',
  },

  // ════════ GOODWILL LETTERS ════════
  {
    id: 'goodwill-late-payment', category: 'goodwill', label: 'Late Payment Goodwill',
    recipient: 'furnisher', strategy: 'Goodwill Strategy', legalBasis: [],
    summary: 'Politely ask a creditor to remove an accurate late mark.',
    suggestedDocuments: ['Optional: record of otherwise on-time history'],
    reLine: 'Goodwill request — {{creditor}}, account {{accountNumber}}',
    paragraphs: [
      'I have been a customer and value our relationship. I am writing to request a goodwill adjustment to remove a late-payment notation reported on my account.',
      'I take full responsibility for the missed payment. Aside from this isolated lapse, I have worked to keep my account in good standing, and I would be grateful for your consideration.',
    ],
    demand: 'As a goodwill gesture, please remove the late-payment notation from my credit reports.',
  },
  {
    id: 'goodwill-hardship', category: 'goodwill', label: 'Hardship Goodwill',
    recipient: 'furnisher', strategy: 'Goodwill Strategy', legalBasis: [],
    summary: 'Goodwill request explaining a temporary hardship.',
    suggestedDocuments: ['Optional: brief proof of hardship'],
    reLine: 'Goodwill request following a hardship — {{creditor}}, account {{accountNumber}}',
    paragraphs: [
      'During the period in question I experienced a genuine, temporary hardship that affected my ability to pay on time. That situation has since been resolved.',
      'I take responsibility for the late payment and respectfully ask for a goodwill adjustment in light of the circumstances and my efforts to stay current since.',
    ],
    demand: 'Please consider removing the late-payment notation as a one-time goodwill adjustment.',
  },
  {
    id: 'goodwill-loyal-customer', category: 'goodwill', label: 'Long-Term Customer Goodwill',
    recipient: 'furnisher', strategy: 'Goodwill Strategy', legalBasis: [],
    summary: 'Leverage a long, positive history for a goodwill removal.',
    suggestedDocuments: ['Optional: account history summary'],
    reLine: 'Goodwill request from a long-term customer — {{creditor}}, account {{accountNumber}}',
    paragraphs: [
      'I have been a loyal customer for a considerable time and have valued our relationship. I am requesting a goodwill adjustment for an isolated late payment that is not representative of my overall history.',
      'I would deeply appreciate your willingness to remove this notation in recognition of my long and otherwise positive standing.',
    ],
    demand: 'In light of my long-term relationship, please remove the late-payment notation as a goodwill gesture.',
  },

  // ════════ CREDITOR DIRECT DISPUTES ════════
  {
    id: 'furnisher-direct-dispute', category: 'creditor-direct', label: 'Direct Furnisher Dispute',
    recipient: 'furnisher', strategy: 'Direct Furnisher Dispute', legalBasis: ['FCRA §623(b)'],
    summary: 'Dispute inaccurate reporting straight with the furnisher.',
    suggestedDocuments: ['Supporting records for the inaccuracy'],
    reLine: 'Direct dispute of inaccurate reporting — account {{accountNumber}}',
    paragraphs: [
      'I am disputing information you are furnishing to the credit bureaus about the account above because it is inaccurate.',
      'Under FCRA §623(b), once you receive a dispute you must conduct a reasonable investigation and correct or delete inaccurate information you report.',
    ],
    demand: 'Please investigate, correct the inaccuracy with all bureaus, and confirm the correction to me.',
  },
  {
    id: 'billing-error', category: 'creditor-direct', label: 'Billing Error Dispute',
    recipient: 'furnisher', strategy: 'Procedural Request', legalBasis: ['FCBA / TILA §161 (15 U.S.C. §1666)'],
    summary: 'Dispute a billing error on an open-end (credit card) account.',
    suggestedDocuments: ['The statement showing the error', 'Receipts'],
    reLine: 'Billing error notice — account {{accountNumber}}',
    paragraphs: [
      'I am writing to dispute a billing error on the account above under the Fair Credit Billing Act. The amount or charge in question is incorrect, unauthorized, or unrecognized.',
      'Please treat this as timely written notice of a billing error. You may not report the disputed amount as delinquent while the investigation is pending.',
    ],
    demand: 'Please correct the billing error and send me written confirmation of the correction.',
  },
  {
    id: 'account-ownership-dispute', category: 'creditor-direct', label: 'Account Ownership Dispute',
    recipient: 'furnisher', strategy: 'Direct Furnisher Dispute', legalBasis: ['FCRA §623(b)'],
    summary: 'Tell a furnisher an account they report is not yours.',
    suggestedDocuments: ['Government ID', 'Any proof the account is not yours'],
    reLine: 'Account ownership dispute — account {{accountNumber}}',
    paragraphs: [
      'You are reporting an account in my name that does not belong to me. I have no record of opening or authorizing this account.',
      'Under FCRA §623(b), please investigate this direct dispute and provide documentation bearing my signature, or cease reporting the account.',
    ],
    demand: 'Please provide proof this account is mine, or delete it from all credit bureaus.',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

export function listTemplates() {
  return TEMPLATES.map(({ paragraphs, demand, ...meta }) => meta);
}

export function getTemplate(id) {
  return TEMPLATES.find(t => t.id === id) || null;
}

export function templatesByCategory(categoryId) {
  return TEMPLATES.filter(t => t.category === categoryId).map(({ paragraphs, demand, ...meta }) => meta);
}

function applyTokens(text, data) {
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = data[key];
    return (v == null || v === '') ? `[${key.replace(/([A-Z])/g, ' $1').toUpperCase().trim()}]` : String(v);
  });
}

function templateTitle(template) {
  const label = String(template?.label || 'Credit Report').trim();
  if (/letter$/i.test(label)) return label;
  if (/goodwill/i.test(label) || template?.category === 'goodwill') return `${label} Letter`;
  return `${label} Dispute Letter`;
}

function requestBullets(template) {
  const text = JSON.stringify(template || {}).toLowerCase();
  if (/personal information|address|employment|name|ssn/.test(text)) {
    return ['Investigation', 'Removal or correction of inaccurate personal information', 'Written confirmation of the update'];
  }
  if (/duplicate/.test(text)) {
    return ['Investigation', 'Removal of duplicate tradelines', 'Updated credit report after correction'];
  }
  if (/late|payment history/.test(text)) {
    return ['Full investigation', 'Verification of late payments', 'Method of verification', 'Correction or deletion if unverifiable'];
  }
  if (/identity|fraud|theft/.test(text)) {
    return ['Full investigation', 'Block or removal of fraudulent information', 'Furnisher notification', 'Written confirmation of the results'];
  }
  if (/inquiry|permissible/.test(text)) {
    return ['Investigation', 'Proof of permissible purpose', 'Removal if authorization cannot be verified'];
  }
  return ['Full investigation', 'Verification of the disputed information', 'Method of verification', 'Correction or deletion if inaccurate or unverifiable'];
}

// Assemble a complete, ready-to-send letter from a template + the user's data.
export function renderLetter(template, data = {}) {
  if (!template) throw new Error('Unknown template.');
  const d = { ...data };
  const today = d.date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const body = (template.paragraphs || []).map(p => applyTokens(p, d)).join('\n\n');
  const subject = applyTokens(template.reLine || template.label, { ...d, date: today });
  const bullets = requestBullets(template).map(item => `- ${item}`);
  const basis = (template.legalBasis || []).filter(Boolean).join(' and ');
  const lawLine = basis
    ? `Under ${basis}, you are required to ensure accuracy and conduct a reasonable investigation.`
    : '';

  return [
    templateTitle(template),
    '',
    `Subject: ${subject}`,
    '',
    body || `I am disputing inaccurate information on my credit report regarding ${d.creditor || '[CREDITOR]'}${d.accountNumber ? `, account ${d.accountNumber}` : ''}.`,
    '',
    'I request:',
    bullets.join('\n'),
    lawLine,
    '',
    'Sincerely,',
    '',
    d.fullName || '[YOUR FULL NAME]',
  ].filter(line => line !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export const TEMPLATE_COUNT = TEMPLATES.length;
