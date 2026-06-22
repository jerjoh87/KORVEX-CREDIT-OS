import { supabaseAdmin } from './server-state.js';

const ACTIVE_CASE_STATUSES = new Set(['open', 'mailed', 'investigating', 'waiting_response', 'escalated']);
const CLOSED_CASE_STATUSES = new Set(['resolved', 'closed']);
const CASE_OUTCOMES = new Set(['deleted', 'corrected', 'verified', 'no_response', 'escalated', 'unknown']);

function toJsonObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function normalizeCaseStatus(status) {
  const value = String(status || 'open').trim().toLowerCase();
  if (['open', 'mailed', 'investigating', 'waiting_response', 'escalated', 'resolved', 'closed'].includes(value)) return value;
  return 'open';
}

function normalizeOutcome(outcome) {
  const value = String(outcome || 'unknown').trim().toLowerCase();
  return CASE_OUTCOMES.has(value) ? value : 'unknown';
}

function mapDisputeToCase(dispute = {}) {
  const disputeStatus = String(dispute.status || 'draft').trim().toLowerCase();
  const statusMap = {
    draft: 'open',
    mailed: 'mailed',
    investigating: 'investigating',
    verified: 'closed',
    escalated: 'escalated',
    resolved: 'resolved',
    deleted: 'resolved'
  };
  const outcomeMap = {
    deleted: 'deleted',
    resolved: 'corrected',
    verified: 'verified'
  };
  const mailedAt = dispute.mailed_at || null;
  const responseDueAt = mailedAt ? new Date(new Date(mailedAt).getTime() + 30 * 86400000).toISOString() : null;
  const deliveredAt = dispute.delivered_at || null;
  return {
    user_id: dispute.user_id,
    dispute_id: dispute.id,
    client_name: String(dispute.client_name || dispute.consumer_name || '').trim() || null,
    creditor: String(dispute.creditor || '').trim() || null,
    bureau: String(dispute.bureau || '').trim() || null,
    category: String(dispute.item_type || dispute.category || '').trim() || null,
    strategy: String(dispute.strategy || '').trim() || null,
    status: statusMap[disputeStatus] || 'open',
    outcome: outcomeMap[disputeStatus] || null,
    outcome_at: ['resolved', 'deleted', 'verified'].includes(disputeStatus) ? (dispute.resolved_at || dispute.updated_at || dispute.created_at || new Date().toISOString()) : null,
    opened_at: dispute.created_at || new Date().toISOString(),
    mailed_at: mailedAt,
    delivered_at: deliveredAt,
    response_due_at: responseDueAt,
    closed_at: ['resolved', 'deleted', 'verified'].includes(disputeStatus) ? (dispute.resolved_at || dispute.updated_at || dispute.created_at || new Date().toISOString()) : null,
    metadata: toJsonObject(dispute.metadata, {
      item_type: dispute.item_type || null,
      round: dispute.round || 1
    }),
    created_at: dispute.created_at || new Date().toISOString(),
    updated_at: dispute.updated_at || dispute.created_at || new Date().toISOString()
  };
}

function summarizeCases(cases = []) {
  const rows = Array.isArray(cases) ? cases : [];
  const activeCases = rows.filter(row => ACTIVE_CASE_STATUSES.has(normalizeCaseStatus(row.status))).length;
  const closedCases = rows.filter(row => CLOSED_CASE_STATUSES.has(normalizeCaseStatus(row.status))).length;
  const successfulCases = rows.filter(row => ['deleted', 'corrected'].includes(normalizeOutcome(row.outcome))).length;
  const noResponseCases = rows.filter(row => normalizeOutcome(row.outcome) === 'no_response').length;
  const successRate = closedCases ? Math.round((successfulCases / closedCases) * 100) : 0;
  const overdueCases = rows.filter(row => row.response_due_at && new Date(row.response_due_at).getTime() < Date.now() && !CLOSED_CASE_STATUSES.has(normalizeCaseStatus(row.status))).length;
  return {
    active_cases: activeCases,
    closed_cases: closedCases,
    successful_cases: successfulCases,
    no_response_cases: noResponseCases,
    overdue_cases: overdueCases,
    success_rate: successRate
  };
}

async function getDisputes(userId) {
  const { data, error } = await supabaseAdmin
    .from('disputes')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getCases(userId) {
  const { data, error } = await supabaseAdmin
    .from('dispute_cases')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function syncCasesFromDisputes(userId) {
  if (!supabaseAdmin || !userId) return { synced: 0, cases: [] };
  try {
    const disputes = await getDisputes(userId);
    const rows = disputes.map(mapDisputeToCase);
    if (rows.length) {
      const { error } = await supabaseAdmin
        .from('dispute_cases')
        .upsert(rows, { onConflict: 'user_id,dispute_id' });
      if (error) throw error;
    }
    const cases = await getCases(userId);
    return { synced: rows.length, cases };
  } catch (error) {
    if (String(error?.code || '') === '42P01' || /does not exist/i.test(error?.message || '')) {
      return { synced: 0, cases: [] };
    }
    throw error;
  }
}

async function getCaseByDisputeId(userId, disputeId) {
  if (!supabaseAdmin || !userId || !disputeId) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from('dispute_cases')
      .select('*')
      .eq('user_id', userId)
      .eq('dispute_id', disputeId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch (error) {
    if (String(error?.code || '') === '42P01' || /does not exist/i.test(error?.message || '')) return null;
    throw error;
  }
}

async function ensureCaseForDispute(dispute = {}) {
  if (!supabaseAdmin || !dispute?.user_id || !dispute?.id) return null;
  try {
    const row = mapDisputeToCase(dispute);
    const { data, error } = await supabaseAdmin
      .from('dispute_cases')
      .upsert(row, { onConflict: 'user_id,dispute_id' })
      .select('*')
      .single();
    if (error) throw error;
    return data || null;
  } catch (error) {
    if (String(error?.code || '') === '42P01' || /does not exist/i.test(error?.message || '')) return null;
    throw error;
  }
}

async function recordCaseEvent({
  caseId,
  userId,
  eventType,
  caseStatus = null,
  note = null,
  metadata = {}
} = {}) {
  if (!supabaseAdmin || !caseId || !userId || !eventType) return null;
  const row = {
    case_id: caseId,
    user_id: userId,
    event_type: String(eventType).trim(),
    case_status: caseStatus ? normalizeCaseStatus(caseStatus) : null,
    note: note ? String(note).trim() : null,
    metadata: toJsonObject(metadata),
    created_at: new Date().toISOString()
  };
  const { error } = await supabaseAdmin.from('dispute_case_events').insert(row);
  if (error) throw error;
  return row;
}

async function loadCaseDashboard(userId) {
  if (!supabaseAdmin || !userId) return null;
  const { synced, cases } = await syncCasesFromDisputes(userId);
  const metrics = summarizeCases(cases);
  const safeSelect = async (query, fallback = []) => {
    try {
      const { data, error } = await query;
      if (error) throw error;
      return data || fallback;
    } catch (error) {
      if (String(error?.code || '') === '42P01' || /does not exist/i.test(error?.message || '')) return fallback;
      throw error;
    }
  };
  const [events, alerts, templates, rules] = await Promise.all([
    safeSelect(
      supabaseAdmin.from('dispute_case_events').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100)
    ),
    safeSelect(
      supabaseAdmin.from('deadline_alerts').select('*').eq('user_id', userId).order('alert_date', { ascending: true }).limit(50)
    ),
    safeSelect(
      supabaseAdmin.from('dispute_templates').select('*').eq('is_active', true).order('category', { ascending: true }).order('label', { ascending: true })
    ),
    safeSelect(
      supabaseAdmin.from('dispute_followup_rules').select('*').eq('is_enabled', true).order('delay_days', { ascending: true })
    )
  ]);
  return {
    synced,
    metrics,
    cases,
    events: events || [],
    deadlines: alerts || [],
    templates: templates || [],
    followupRules: rules || []
  };
}

async function listTemplatesForAdmin({ includeInactive = false } = {}) {
  if (!supabaseAdmin) return [];
  let query = supabaseAdmin.from('dispute_templates').select('*').order('updated_at', { ascending: false });
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function listFollowupRulesForAdmin({ includeDisabled = false } = {}) {
  if (!supabaseAdmin) return [];
  let query = supabaseAdmin.from('dispute_followup_rules').select('*').order('delay_days', { ascending: true });
  if (!includeDisabled) query = query.eq('is_enabled', true);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export {
  mapDisputeToCase,
  normalizeCaseStatus,
  normalizeOutcome,
  recordCaseEvent,
  loadCaseDashboard,
  syncCasesFromDisputes,
  getCaseByDisputeId,
  ensureCaseForDispute,
  summarizeCases,
  listTemplatesForAdmin,
  listFollowupRulesForAdmin
};
