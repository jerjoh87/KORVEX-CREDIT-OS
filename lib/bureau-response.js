export const RESPONSE_CATEGORIES = [
  'deleted',
  'updated',
  'verified',
  'unchanged',
  'frivolous_or_irrelevant',
  'needs_more_information',
  'no_investigation',
  'mixed_result',
  'unclear'
];

export const RESPONSE_ACTIONS = {
  deleted: {
    action: 'Mark the item successful, archive the result, and verify the change on a fresh report.',
    letterType: null
  },
  updated: {
    action: 'Compare the update with the source records. If it is still inaccurate, prepare a corrected-information reinvestigation request.',
    letterType: 'corrected_info_reinvestigation'
  },
  verified: {
    action: 'Review the investigation details and prepare a method-of-verification or reinvestigation request if the reporting remains inaccurate.',
    letterType: 'method_of_verification'
  },
  unchanged: {
    action: 'Review the evidence from Round 1 and prepare a focused reinvestigation request that identifies the remaining inaccuracy.',
    letterType: 'reinvestigation'
  },
  frivolous_or_irrelevant: {
    action: 'Address the bureau’s stated reason and prepare a documented resubmission with specific evidence.',
    letterType: 'evidence_resubmission'
  },
  needs_more_information: {
    action: 'Gather the requested records and prepare an evidence attachment letter.',
    letterType: 'evidence_attachment'
  },
  no_investigation: {
    action: 'Prepare a failure-to-investigate or no-response follow-up with the delivery timeline and supporting documents.',
    letterType: 'no_response_follow_up'
  },
  mixed_result: {
    action: 'Archive resolved items and prepare a targeted follow-up only for items that remain inaccurate or unclear.',
    letterType: 'mixed_result_follow_up'
  },
  unclear: {
    action: 'Review the original response and add clearer source material before choosing the next letter.',
    letterType: 'manual_review'
  }
};

export function normalizeBureau(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw.includes('experian')) return 'Experian';
  if (raw.includes('equifax')) return 'Equifax';
  if (raw.includes('transunion') || raw.includes('trans union')) return 'TransUnion';
  return 'Unknown';
}

export function normalizeResponseCategory(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s/-]+/g, '_');
  const aliases = {
    verified_as_accurate: 'verified',
    remains_unchanged: 'unchanged',
    frivolous: 'frivolous_or_irrelevant',
    frivolous_irrelevant: 'frivolous_or_irrelevant',
    irrelevant: 'frivolous_or_irrelevant',
    need_more_documentation: 'needs_more_information',
    not_investigated: 'no_investigation',
    no_clear_result_detected: 'unclear'
  };
  const normalized = aliases[raw] || raw;
  return RESPONSE_CATEGORIES.includes(normalized) ? normalized : 'unclear';
}

export function addUtcDays(value, days) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString();
}

export function calculateDisputeDeadlines({ deliveredAt = null, sentAt = null } = {}) {
  const anchor = deliveredAt || sentAt || null;
  return {
    anchorAt: anchor,
    standardDueAt: addUtcDays(anchor, 30),
    maxDueAt: addUtcDays(anchor, 45)
  };
}

export function buildDeadlineAlerts(roundId, { deliveredAt = null, sentAt = null } = {}) {
  const anchor = deliveredAt || sentAt || null;
  if (!anchor) return [];
  return [
    { type: 'day_21_check', day: 21, title: 'Check for bureau response' },
    { type: 'day_30_standard', day: 30, title: 'Standard investigation window reached' },
    { type: 'day_38_prepare', day: 38, title: 'Prepare the next round if no response arrived' },
    { type: 'day_45_maximum', day: 45, title: 'Maximum response window reached — review follow-up options' }
  ].map(item => ({
    dispute_round_id: roundId,
    alert_type: item.type,
    alert_date: addUtcDays(anchor, item.day),
    status: 'pending',
    metadata: { title: item.title, day: item.day },
    dedupe_key: `round:${roundId}:${item.type}`
  }));
}

export function inferResponseCategory(text) {
  const raw = String(text || '').toLowerCase();
  if (/frivolous|irrelevant/.test(raw)) return 'frivolous_or_irrelevant';
  if (/not investigated|unable to investigate|did not investigate/.test(raw)) return 'no_investigation';
  if (/additional (?:information|documentation)|more (?:information|documentation)/.test(raw)) return 'needs_more_information';
  if (/deleted|removed/.test(raw) && /verified|updated|remains/.test(raw)) return 'mixed_result';
  if (/deleted|removed/.test(raw)) return 'deleted';
  if (/updated|modified|corrected/.test(raw)) return 'updated';
  if (/verified|accurate/.test(raw)) return 'verified';
  if (/unchanged|remains/.test(raw)) return 'unchanged';
  return 'unclear';
}

export function normalizeResponseAnalysis(input = {}, fallbackText = '') {
  const accounts = Array.isArray(input.accounts) ? input.accounts : [];
  const normalizedAccounts = accounts.slice(0, 50).map(account => {
    const category = normalizeResponseCategory(account.category || account.result);
    return {
      account_name: String(account.account_name || account.creditor || 'Account not identified').slice(0, 180),
      account_last4: String(account.account_last4 || account.last4 || '').replace(/\D/g, '').slice(-4),
      category,
      bureau_explanation: String(account.bureau_explanation || account.reason || '').slice(0, 1200),
      ...RESPONSE_ACTIONS[category]
    };
  });
  const category = normalizeResponseCategory(
    input.overall_category || input.category || (normalizedAccounts.length === 1 ? normalizedAccounts[0].category : inferResponseCategory(fallbackText))
  );
  const confidence = Math.max(0, Math.min(100, Math.round(Number(input.confidence_score ?? input.confidence ?? 45) || 45)));
  return {
    bureau: normalizeBureau(input.bureau),
    response_date: input.response_date || null,
    client_name: String(input.client_name || '').slice(0, 180),
    overall_category: category,
    summary: String(input.summary || 'Review the account-level results and compare them with the original dispute.').slice(0, 3000),
    confidence_score: confidence,
    accounts: normalizedAccounts,
    recommended_next_action: String(input.recommended_next_action || RESPONSE_ACTIONS[category].action).slice(0, 2000),
    recommended_letter_type: input.recommended_letter_type === null
      ? null
      : String(input.recommended_letter_type || RESPONSE_ACTIONS[category].letterType || '').slice(0, 100) || null,
    missing_documents: (Array.isArray(input.missing_documents) ? input.missing_documents : [])
      .map(value => String(value).slice(0, 180)).slice(0, 20)
  };
}
