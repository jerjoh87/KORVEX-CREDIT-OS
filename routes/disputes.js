// ─────────────────────────────────────────────
//  CREDITOS — Dispute Management API
//  routes/disputes.js
//
//  GET  /api/disputes/library    — categorized dispute-letter library
//  POST /api/disputes/recommend  — questionnaire → strategy recommendation
//  POST /api/disputes/generate   — template id + data → ready-to-send letter
//  POST /api/disputes/cfpb       — structured input → CFPB complaint narrative
//
//  All endpoints are deterministic and stateless (no AI, no DB, no credits).
//  They transform the inputs the caller provides and expose no user data, so
//  they sit behind the global /api rate limiter but do not require auth.
// ─────────────────────────────────────────────
import { Router } from 'express';
import {
  CATEGORIES, RECIPIENTS, BUREAU_ADDRESSES, TEMPLATE_COUNT,
  listTemplates, templatesByCategory, getTemplate, renderLetter,
} from '../lib/disputeLibrary.js';
import { recommendStrategy, buildCfpbComplaint, STRATEGIES } from '../lib/disputeStrategy.js';

const router = Router();

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

// POST /api/disputes/recommend — smart questionnaire → recommended strategy
router.post('/recommend', (req, res) => {
  const b = req.body || {};
  if (!b.disputeType && !b.problem) {
    return res.status(400).json({ success: false, error: 'Provide at least disputeType or problem.' });
  }
  res.json({ success: true, recommendation: recommendStrategy(b) });
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
  res.json({ success: true, complaint: buildCfpbComplaint(b) });
});

export default router;
