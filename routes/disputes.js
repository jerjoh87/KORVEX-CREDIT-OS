// ─────────────────────────────────────────────
//  CREDITOS — Dispute Management API
//  routes/disputes.js
//
//  GET  /api/disputes/library    — categorized dispute-letter library
//  POST /api/disputes/recommend  — questionnaire → strategy recommendation (+score/plan)
//  POST /api/disputes/playbook   — structured tradeline → full AI Playbook analysis
//  POST /api/disputes/generate   — template id + data → ready-to-send letter
//  POST /api/disputes/cfpb       — structured input → CFPB complaint narrative
//
//  Endpoints are deterministic, stateless, and unauthenticated — they transform
//  caller-provided inputs and expose no stored user data, sitting behind the
//  global /api rate limiter. The one exception is /playbook with `ai:true`,
//  which makes a single live-model call to write the Case Analyst narrative and
//  falls back to the deterministic analyst on any error.
// ─────────────────────────────────────────────
import { Router } from 'express';
import {
  CATEGORIES, RECIPIENTS, BUREAU_ADDRESSES, TEMPLATE_COUNT,
  listTemplates, templatesByCategory, getTemplate, renderLetter,
} from '../lib/disputeLibrary.js';
import { recommendStrategy, buildCfpbComplaint, STRATEGIES } from '../lib/disputeStrategy.js';
import { buildPlaybook, enrichRecommendation, caseAnalystPrompt } from '../lib/disputePlaybook.js';
import { aiConfigured, callAi, toAiText } from '../lib/ai.js';

const router = Router();

// Compose the optional live-LLM Case Analyst narrative. Races a hard timeout so
// a slow AI call can never hang the request; any failure → deterministic.
async function aiCaseAnalyst(playbook, timeoutMs = 30000) {
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs));
  const resp = await Promise.race([
    // Some models use thinking tokens that count against the output
    // budget, so give it enough room to both reason and emit the JSON.
    callAi({ max_tokens: 2048, temperature: 0.3, responseMimeType: 'application/json', prompt: caseAnalystPrompt(playbook) }),
    timeout,
  ]);
  if (!resp.ok) throw new Error(`AI ${resp.status}`);
  const data = await resp.json();
  const parsed = JSON.parse(toAiText(data).replace(/```json|```/g, '').trim());
  // Merge AI prose over the deterministic skeleton so required fields always exist.
  return {
    ...playbook.caseAnalyst,
    summary: parsed.summary || playbook.caseAnalyst.summary,
    whyStrategy: parsed.whyStrategy || playbook.caseAnalyst.whyStrategy,
    risks: Array.isArray(parsed.risks) && parsed.risks.length ? parsed.risks : playbook.caseAnalyst.risks,
    evidenceNeeded: Array.isArray(parsed.evidenceNeeded) && parsed.evidenceNeeded.length ? parsed.evidenceNeeded : playbook.caseAnalyst.evidenceNeeded,
    suggestedNextAction: parsed.suggestedNextAction || playbook.caseAnalyst.suggestedNextAction,
    source: 'ai',
  };
}

// GET /api/disputes/library — full library (or one category via ?category=)
router.get('/library', (req, res) => {
  const category = req.query.category ? String(req.query.category) : null;
  const templates = category ? templatesByCategory(category) : listTemplates();
  res.json({
    success: true,
    counts: { categories: CATEGORIES.length, templates: TEMPLATE_COUNT },
    recipients: RECIPIENTS,
    bureaus: Object.keys(BUREAU_ADDRESSES),
    strategies: Object.values(STRATEGIES),
    categories: CATEGORIES,
    templates,
  });
});

// POST /api/disputes/recommend — smart questionnaire → recommended strategy,
// enriched with the playbook strength score, action plan, and document checklist.
router.post('/recommend', (req, res) => {
  const b = req.body || {};
  if (!b.disputeType && !b.problem) {
    return res.status(400).json({ success: false, error: 'Provide at least disputeType or problem.' });
  }
  res.json({ success: true, recommendation: enrichRecommendation(recommendStrategy(b), b) });
});

// POST /api/disputes/playbook — structured tradeline → full per-account analysis:
// detected reporting issues, recommended strategy, strength score + factor
// breakdown, the 6-step action plan, a document checklist, and a Case Analyst
// summary. Pass { ai: true } to have the live model write the analyst narrative.
router.post('/playbook', async (req, res) => {
  const body = req.body || {};
  const account = body.account && typeof body.account === 'object' ? body.account : body;
  if (!account || typeof account !== 'object' || !Object.keys(account).length) {
    return res.status(400).json({ success: false, error: 'Provide tradeline/account details to analyze.' });
  }

  const playbook = buildPlaybook(account);
  playbook.caseAnalyst.source = 'deterministic';

  if (body.ai === true && aiConfigured()) {
    try {
      playbook.caseAnalyst = await aiCaseAnalyst(playbook);
    } catch (e) {
      console.error('[disputes/playbook] AI analyst fell back:', e.message);
      playbook.caseAnalyst.source = 'fallback';
      playbook.caseAnalyst.fallbackReason = e.message;
    }
  }

  res.json({ success: true, playbook });
});

// POST /api/disputes/generate — fill a template into a ready-to-send letter
router.post('/generate', (req, res) => {
  const { templateId, data } = req.body || {};
  if (!templateId) {
    return res.status(400).json({ success: false, error: 'templateId is required.' });
  }
  const template = getTemplate(templateId);
  if (!template) {
    return res.status(404).json({ success: false, error: `Unknown templateId "${templateId}".` });
  }
  let letter;
  try {
    letter = renderLetter(template, data && typeof data === 'object' ? data : {});
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Could not generate the letter.' });
  }
  res.json({
    success: true,
    letter,
    template: {
      id: template.id,
      label: template.label,
      category: template.category,
      recipient: template.recipient,
      strategy: template.strategy,
      legalBasis: template.legalBasis,
    },
    checklist: template.suggestedDocuments || [],
  });
});

// POST /api/disputes/cfpb — generate a professional CFPB complaint narrative
router.post('/cfpb', (req, res) => {
  const b = req.body || {};
  if (!b.company && !(b.consumer && b.consumer.name)) {
    return res.status(400).json({ success: false, error: 'Provide at least a company name or consumer name.' });
  }
  const complaint = buildCfpbComplaint(b);
  const packageText = [
    '# CREDITOS CFPB Complaint Package',
    '',
    '## Complaint narrative',
    complaint.narrative,
    '',
    '## Evidence checklist',
    ...(complaint.fields.evidence || []).map(item => `- ${item}`),
    '',
    '## Timeline',
    ...(Array.isArray(b.timeline)
      ? b.timeline.map(item => `- ${[item?.date, item?.event].filter(Boolean).join(' — ')}`)
      : [String(b.timeline || '').trim()].filter(Boolean)),
    '',
    '## Desired resolution',
    complaint.fields.requestedResolution,
    '',
    '## Filing link',
    complaint.filingUrl
  ].join('\n').trim();

  res.json({
    success: true,
    complaint,
    package: {
      filename: `creditos-cfpb-package-${String(complaint.fields.company || 'complaint').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'complaint'}.md`,
      mimeType: 'text/markdown',
      content: packageText
    }
  });
});

export default router;
