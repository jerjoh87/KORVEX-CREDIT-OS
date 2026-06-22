import { Router } from 'express';
import { requireAuth, supabaseAdmin } from '../lib/server-state.js';
import { isAdminUser } from '../lib/admin.js';
import {
  loadCaseDashboard,
  syncCasesFromDisputes,
  recordCaseEvent,
  listTemplatesForAdmin,
  listFollowupRulesForAdmin,
  summarizeCases
} from '../lib/cases.js';

const router = Router();

async function requireCaseAdmin(req, res) {
  const admin = await isAdminUser(req.user?.id, req.user?.email || null);
  if (!admin) {
    res.status(403).json({ error: 'Admin access required.' });
    return false;
  }
  return true;
}

function cleanText(value, maxLen = 500) {
  return String(value || '').trim().slice(0, maxLen);
}

function cleanJson(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

router.get('/dashboard', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Case management is unavailable.' });
  try {
    const dashboard = await loadCaseDashboard(req.user.id);
    const summary = summarizeCases(dashboard?.cases || []);
    res.json({ success: true, ...dashboard, summary });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load the case dashboard.' });
  }
});

router.post('/sync', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Case management is unavailable.' });
  try {
    const result = await syncCasesFromDisputes(req.user.id);
    res.json({ success: true, synced: result.synced, cases: result.cases.length });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not sync dispute cases.' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Case management is unavailable.' });
  const body = req.body || {};
  const payload = {
    user_id: req.user.id,
    dispute_id: body.dispute_id || null,
    client_name: cleanText(body.client_name, 150) || null,
    creditor: cleanText(body.creditor, 150) || null,
    bureau: cleanText(body.bureau, 50) || null,
    category: cleanText(body.category, 100) || null,
    strategy: cleanText(body.strategy, 150) || null,
    status: cleanText(body.status, 40) || 'open',
    outcome: body.outcome ? cleanText(body.outcome, 40) : null,
    outcome_at: body.outcome_at || null,
    opened_at: body.opened_at || new Date().toISOString(),
    mailed_at: body.mailed_at || null,
    delivered_at: body.delivered_at || null,
    response_due_at: body.response_due_at || null,
    closed_at: body.closed_at || null,
    metadata: cleanJson(body.metadata)
  };
  try {
    const { data, error } = await supabaseAdmin
      .from('dispute_cases')
      .upsert(payload, { onConflict: 'user_id,dispute_id' })
      .select('*')
      .single();
    if (error) throw error;
    await recordCaseEvent({
      caseId: data.id,
      userId: req.user.id,
      eventType: 'case_created',
      caseStatus: data.status,
      note: 'Case created from the intake workflow.',
      metadata: { source: 'api' }
    }).catch(() => {});
    res.json({ success: true, case: data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not create the case.' });
  }
});

router.patch('/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Case management is unavailable.' });
  const body = req.body || {};
  const updates = {
    status: body.status ? cleanText(body.status, 40) : undefined,
    outcome: body.outcome ? cleanText(body.outcome, 40) : undefined,
    outcome_at: body.outcome_at || undefined,
    mailed_at: body.mailed_at || undefined,
    delivered_at: body.delivered_at || undefined,
    response_due_at: body.response_due_at || undefined,
    closed_at: body.closed_at || undefined,
    metadata: body.metadata ? cleanJson(body.metadata) : undefined,
    updated_at: new Date().toISOString()
  };
  Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);
  try {
    const { data, error } = await supabaseAdmin
      .from('dispute_cases')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select('*')
      .single();
    if (error) throw error;
    await recordCaseEvent({
      caseId: data.id,
      userId: req.user.id,
      eventType: 'case_updated',
      caseStatus: data.status,
      note: body.note ? cleanText(body.note, 280) : 'Case updated.',
      metadata: { source: 'api', changes: Object.keys(updates) }
    }).catch(() => {});
    res.json({ success: true, case: data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not update the case.' });
  }
});

router.post('/:id/events', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Case management is unavailable.' });
  const body = req.body || {};
  try {
    const { data: existing, error: caseError } = await supabaseAdmin
      .from('dispute_cases')
      .select('id,status')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (caseError) throw caseError;
    if (!existing) return res.status(404).json({ error: 'Case not found.' });
    const event = await recordCaseEvent({
      caseId: existing.id,
      userId: req.user.id,
      eventType: cleanText(body.event_type, 80) || 'case_event',
      caseStatus: body.case_status || existing.status,
      note: cleanText(body.note, 280) || null,
      metadata: cleanJson(body.metadata)
    });
    res.json({ success: true, event });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not record the event.' });
  }
});

router.get('/templates', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Case templates are unavailable.' });
  try {
    const [templates, rules] = await Promise.all([
      listTemplatesForAdmin({ includeInactive: false }),
      listFollowupRulesForAdmin({ includeDisabled: false })
    ]);
    res.json({ success: true, templates, followupRules: rules });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load templates.' });
  }
});

router.get('/admin/templates', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Case templates are unavailable.' });
  if (!(await requireCaseAdmin(req, res))) return;
  try {
    const templates = await listTemplatesForAdmin({ includeInactive: true });
    res.json({ success: true, templates });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load admin templates.' });
  }
});

router.post('/admin/templates', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Case templates are unavailable.' });
  if (!(await requireCaseAdmin(req, res))) return;
  const body = req.body || {};
  const payload = {
    template_key: cleanText(body.template_key, 80),
    label: cleanText(body.label, 150),
    category: cleanText(body.category, 80) || 'general',
    recipient: cleanText(body.recipient, 80) || 'bureau',
    strategy: cleanText(body.strategy, 150) || 'FCRA Validation',
    legal_basis: Array.isArray(body.legal_basis) ? body.legal_basis.map(v => cleanText(v, 60)).filter(Boolean) : [],
    body_template: cleanText(body.body_template, 8000),
    suggested_documents: Array.isArray(body.suggested_documents) ? body.suggested_documents.map(v => cleanText(v, 80)).filter(Boolean) : [],
    is_system: !!body.is_system,
    is_active: body.is_active !== false,
    created_by: req.user.id,
    metadata: cleanJson(body.metadata)
  };
  try {
    const { data, error } = await supabaseAdmin.from('dispute_templates').upsert(payload, { onConflict: 'template_key' }).select('*').single();
    if (error) throw error;
    res.json({ success: true, template: data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not save the template.' });
  }
});

router.patch('/admin/templates/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Case templates are unavailable.' });
  if (!(await requireCaseAdmin(req, res))) return;
  const body = req.body || {};
  const payload = {
    label: body.label !== undefined ? cleanText(body.label, 150) : undefined,
    category: body.category !== undefined ? cleanText(body.category, 80) : undefined,
    recipient: body.recipient !== undefined ? cleanText(body.recipient, 80) : undefined,
    strategy: body.strategy !== undefined ? cleanText(body.strategy, 150) : undefined,
    legal_basis: body.legal_basis !== undefined ? (Array.isArray(body.legal_basis) ? body.legal_basis.map(v => cleanText(v, 60)).filter(Boolean) : []) : undefined,
    body_template: body.body_template !== undefined ? cleanText(body.body_template, 8000) : undefined,
    suggested_documents: body.suggested_documents !== undefined ? (Array.isArray(body.suggested_documents) ? body.suggested_documents.map(v => cleanText(v, 80)).filter(Boolean) : []) : undefined,
    is_system: body.is_system !== undefined ? !!body.is_system : undefined,
    is_active: body.is_active !== undefined ? !!body.is_active : undefined,
    metadata: body.metadata !== undefined ? cleanJson(body.metadata) : undefined,
    updated_at: new Date().toISOString()
  };
  Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);
  try {
    const { data, error } = await supabaseAdmin.from('dispute_templates').update(payload).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    res.json({ success: true, template: data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not update the template.' });
  }
});

router.delete('/admin/templates/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Case templates are unavailable.' });
  if (!(await requireCaseAdmin(req, res))) return;
  try {
    const { error } = await supabaseAdmin.from('dispute_templates').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not delete the template.' });
  }
});

router.get('/admin/followup-rules', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Case automation is unavailable.' });
  if (!(await requireCaseAdmin(req, res))) return;
  try {
    const rules = await listFollowupRulesForAdmin({ includeDisabled: true });
    res.json({ success: true, rules });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load automation rules.' });
  }
});

router.post('/admin/followup-rules', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Case automation is unavailable.' });
  if (!(await requireCaseAdmin(req, res))) return;
  const body = req.body || {};
  const payload = {
    name: cleanText(body.name, 150),
    trigger_stage: cleanText(body.trigger_stage, 80) || 'mailed',
    delay_days: Number(body.delay_days) || 7,
    template_key: cleanText(body.template_key, 80) || 'mov',
    is_enabled: body.is_enabled !== false,
    scope: cleanText(body.scope, 20) || 'global',
    created_by: req.user.id,
    metadata: cleanJson(body.metadata)
  };
  try {
    const { data, error } = await supabaseAdmin.from('dispute_followup_rules').insert(payload).select('*').single();
    if (error) throw error;
    res.json({ success: true, rule: data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not save the follow-up rule.' });
  }
});

router.patch('/admin/followup-rules/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Case automation is unavailable.' });
  if (!(await requireCaseAdmin(req, res))) return;
  const body = req.body || {};
  const payload = {
    name: body.name !== undefined ? cleanText(body.name, 150) : undefined,
    trigger_stage: body.trigger_stage !== undefined ? cleanText(body.trigger_stage, 80) : undefined,
    delay_days: body.delay_days !== undefined ? Number(body.delay_days) || 7 : undefined,
    template_key: body.template_key !== undefined ? cleanText(body.template_key, 80) : undefined,
    is_enabled: body.is_enabled !== undefined ? !!body.is_enabled : undefined,
    scope: body.scope !== undefined ? cleanText(body.scope, 20) : undefined,
    metadata: body.metadata !== undefined ? cleanJson(body.metadata) : undefined,
    updated_at: new Date().toISOString()
  };
  Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);
  try {
    const { data, error } = await supabaseAdmin.from('dispute_followup_rules').update(payload).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    res.json({ success: true, rule: data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not update the follow-up rule.' });
  }
});

router.delete('/admin/followup-rules/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Case automation is unavailable.' });
  if (!(await requireCaseAdmin(req, res))) return;
  try {
    const { error } = await supabaseAdmin.from('dispute_followup_rules').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not delete the follow-up rule.' });
  }
});

export default router;
