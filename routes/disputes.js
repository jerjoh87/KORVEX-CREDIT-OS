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
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CATEGORIES, RECIPIENTS, BUREAU_ADDRESSES, TEMPLATE_COUNT,
  listTemplates, templatesByCategory, getTemplate, renderLetter,
} from '../lib/disputeLibrary.js';
import { recommendStrategy, buildCfpbComplaint, STRATEGIES } from '../lib/disputeStrategy.js';
import { buildPlaybook, enrichRecommendation, caseAnalystPrompt } from '../lib/disputePlaybook.js';
import { aiConfigured, callAi, toAiText } from '../lib/ai.js';
import {
  buildLetterPacket,
  buildRound1Workflow,
  caseDirectory,
  saveRound1Artifacts
} from '../lib/round1-dispute-workflow.js';

const router = Router();
const MAX_ROUND1_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_ROUND1_TEXT_CHARS = 100000;

function decodeBase64File(fileData = '') {
  const raw = String(fileData || '');
  const encoded = raw.includes(',') ? raw.split(',').pop() : raw;
  return encoded ? Buffer.from(encoded, 'base64') : null;
}

async function extractPdfTextFromBuffer(buffer) {
  let parser;
  try {
    const { PDFParse } = await import('pdf-parse');
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return String(result?.text || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  } catch (error) {
    console.warn('[round-1/pdf-text]', error.message);
    return '';
  } finally {
    await parser?.destroy?.().catch(() => {});
  }
}

async function resolveRound1Input(body = {}) {
  let reportText = String(body.reportText || body.report_text || body.text || '').trim();
  const fileData = String(body.fileData || body.file_data || '').trim();
  const filename = String(body.filename || body.fileName || 'credit-report.pdf').trim();
  const fileType = String(body.fileType || body.mimeType || '').trim();
  const buffer = fileData ? decodeBase64File(fileData) : null;
  if (buffer?.length > MAX_ROUND1_UPLOAD_BYTES) {
    const error = new Error('Choose a report smaller than 10 MB.');
    error.status = 413;
    throw error;
  }
  const isPdf = buffer && (fileType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf'));
  if (!reportText && isPdf) reportText = await extractPdfTextFromBuffer(buffer);
  if (!reportText && buffer && !isPdf) reportText = buffer.toString('utf8').trim();
  if (reportText.length > MAX_ROUND1_TEXT_CHARS) {
    const error = new Error('Credit report text must be under 100,000 characters.');
    error.status = 413;
    throw error;
  }
  if (reportText.length < 20) {
    const error = new Error('No readable credit report text was found. Use a searchable PDF, OCR the report, or paste report text.');
    error.status = 422;
    throw error;
  }
  return { reportText, buffer: isPdf ? buffer : null, filename, fileType };
}

function downloadUrl(req, caseId, filename) {
  return `${req.protocol}://${req.get('host')}/api/disputes/round-1/${encodeURIComponent(caseId)}/download/${encodeURIComponent(filename)}`;
}

function artifactLinks(req, caseId, files = {}) {
  const links = {
    extractedText: downloadUrl(req, caseId, 'extracted-report.txt'),
    audit: downloadUrl(req, caseId, 'master-credit-audit.md'),
    packet: downloadUrl(req, caseId, 'round-1-letter-packet.json'),
    flags: downloadUrl(req, caseId, 'human-review-flags.md'),
    pdfs: []
  };
  if (files.originalReport) links.originalReport = downloadUrl(req, caseId, 'original-report.pdf');
  links.pdfs = (files.pdfs || []).map(file => ({
    filename: file.filename,
    url: downloadUrl(req, caseId, file.filename)
  }));
  return links;
}

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

// POST /api/disputes/round-1/intake — report parser + audit + candidate engine.
router.post('/round-1/intake', async (req, res) => {
  try {
    const { reportText, buffer } = await resolveRound1Input(req.body || {});
    const consumer = req.body?.consumer && typeof req.body.consumer === 'object' ? req.body.consumer : {};
    const caseId = req.body?.caseId || null;
    const workflow = buildRound1Workflow({
      reportText,
      consumer,
      caseId,
      currentDate: req.body?.currentDate || new Date(),
      supportingDocuments: Array.isArray(req.body?.supportingDocuments) ? req.body.supportingDocuments : [],
      caseLaw: req.body?.caseLaw && typeof req.body.caseLaw === 'object' ? req.body.caseLaw : {}
    });
    const saved = await saveRound1Artifacts({
      caseId: workflow.caseId,
      originalBuffer: buffer,
      reportText,
      auditMarkdown: workflow.auditMarkdown,
      letterPacket: workflow.letterPacket,
      humanReviewFlags: workflow.humanReviewFlags,
      generatePdfs: false
    });
    res.json({
      success: true,
      caseId: workflow.caseId,
      analysis: workflow.analysis,
      auditMarkdown: workflow.auditMarkdown,
      candidates: workflow.candidates,
      letterPacket: workflow.letterPacket,
      humanReviewFlags: workflow.humanReviewFlags,
      canGeneratePdfs: workflow.canGeneratePdfs,
      hardStops: workflow.hardStops,
      links: artifactLinks(req, workflow.caseId, saved.files)
    });
  } catch (error) {
    console.error('[round-1/intake]', error.message);
    res.status(error.status || 500).json({ success: false, error: error.message || 'Round 1 intake failed.' });
  }
});

// POST /api/disputes/round-1/:caseId/generate-pdfs — packet JSON + PDF engine.
router.post('/round-1/:caseId/generate-pdfs', async (req, res) => {
  try {
    const caseId = String(req.params.caseId || '').trim();
    const body = req.body || {};
    const reportText = String(body.reportText || body.report_text || '').trim();
    const consumer = body.consumer && typeof body.consumer === 'object' ? body.consumer : {};
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    if (reportText.length < 20) {
      return res.status(400).json({ success: false, error: 'Report text is required to regenerate the final packet.' });
    }
    const workflow = buildRound1Workflow({
      reportText,
      consumer,
      caseId,
      currentDate: body.currentDate || new Date(),
      supportingDocuments: Array.isArray(body.supportingDocuments) ? body.supportingDocuments : [],
      caseLaw: body.caseLaw && typeof body.caseLaw === 'object' ? body.caseLaw : {}
    });
    const candidateOverrides = new Map(candidates.map(item => [String(item.id), item]));
    const approvedCandidates = workflow.candidates
      .map(item => ({ ...item, ...(candidateOverrides.get(String(item.id)) || {}) }))
      .filter(item => item.approved !== false && item.status !== 'Do Not Dispute');
    const finalWorkflow = buildRound1Workflow({
      reportText,
      consumer,
      caseId,
      currentDate: body.currentDate || new Date(),
      supportingDocuments: Array.isArray(body.supportingDocuments) ? body.supportingDocuments : [],
      caseLaw: body.caseLaw && typeof body.caseLaw === 'object' ? body.caseLaw : {}
    });
    finalWorkflow.letterPacket = buildLetterPacket({
      caseId,
      consumer,
      candidates: approvedCandidates,
      currentDate: body.currentDate || new Date(),
      supportingDocuments: Array.isArray(body.supportingDocuments) ? body.supportingDocuments : [],
      caseLaw: body.caseLaw && typeof body.caseLaw === 'object' ? body.caseLaw : {}
    });
    finalWorkflow.humanReviewFlags = {
      ...finalWorkflow.humanReviewFlags,
      flags: [
        ...(finalWorkflow.humanReviewFlags.flags || []),
        'Final PDFs were generated only after candidate review input. Review again before mailing.'
      ]
    };
    const hasAddress = finalWorkflow.letterPacket.consumer.name && finalWorkflow.letterPacket.consumer.address_lines?.length >= 2;
    if (!hasAddress) {
      const saved = await saveRound1Artifacts({
        caseId,
        reportText,
        auditMarkdown: finalWorkflow.auditMarkdown,
        letterPacket: finalWorkflow.letterPacket,
        humanReviewFlags: finalWorkflow.humanReviewFlags,
        generatePdfs: false
      });
      return res.status(409).json({
        success: false,
        error: 'Consumer full name and mailing address are required before final PDFs can be generated.',
        hardStops: ['Consumer full name and mailing address are required before final PDFs can be generated.'],
        links: artifactLinks(req, caseId, saved.files)
      });
    }
    const blockedDoc = approvedCandidates.find(item => /identity theft|fraud|unauthorized/i.test(`${item.issue} ${item.audit_error_found}`) && !(item.documentationProvided || item.hasDocumentation));
    if (blockedDoc) {
      return res.status(409).json({
        success: false,
        error: 'Documentation is required before using identity theft, fraud, or unauthorized activity language.',
        hardStops: [`Documentation is required for ${blockedDoc.name}.`]
      });
    }
    const saved = await saveRound1Artifacts({
      caseId,
      reportText,
      auditMarkdown: finalWorkflow.auditMarkdown,
      letterPacket: finalWorkflow.letterPacket,
      humanReviewFlags: finalWorkflow.humanReviewFlags,
      generatePdfs: true
    });
    res.json({
      success: true,
      caseId,
      letterPacket: finalWorkflow.letterPacket,
      humanReviewFlags: finalWorkflow.humanReviewFlags,
      links: artifactLinks(req, caseId, saved.files)
    });
  } catch (error) {
    console.error('[round-1/generate-pdfs]', error.message);
    res.status(error.status || 500).json({ success: false, error: error.message || 'Round 1 PDF generation failed.' });
  }
});

router.get('/round-1/:caseId/download/:filename', async (req, res) => {
  try {
    const caseId = String(req.params.caseId || '').replace(/[^a-zA-Z0-9._-]+/g, '-');
    const filename = path.basename(String(req.params.filename || ''));
    const filePath = path.join(caseDirectory(caseId), filename);
    const relative = path.relative(caseDirectory(caseId), filePath);
    if (!filename || relative.startsWith('..') || path.isAbsolute(relative)) return res.status(400).json({ error: 'Invalid file path.' });
    await fs.access(filePath);
    res.download(filePath, filename);
  } catch (error) {
    res.status(404).json({ error: 'Round 1 artifact not found.' });
  }
});

export default router;
