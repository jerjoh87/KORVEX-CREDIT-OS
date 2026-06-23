// ─────────────────────────────────────────────
//  CREDITOS — Credit API Routes
//  routes/creditApi.js
//
//  POST /api/analyze-credit       — AI scan (1 credit)
//  POST /api/upload-credit-report — PDF/TXT text extraction
//  GET  /api/funding-offers       — curated lender list
//  POST /api/leads                — landing-page lead capture (public)
// ─────────────────────────────────────────────
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { requireAuth, supabaseAdmin } from '../lib/server-state.js';
import { isAdminUser } from '../lib/admin.js';
import { isUnlimitedPlan } from '../lib/billing.js';
import { callGemini, geminiConfigured, toGeminiText } from '../lib/gemini.js';
import { buildCreditIntelligenceAnalysis, enhanceCreditAnalysis } from '../lib/credit-intelligence.js';
import { isMissingSchemaError, withTimeout } from '../lib/supabase-errors.js';
import { testAdminModeEnabled, testAdminUser } from '../lib/test-admin.js';
import {
  extractWithGoogleDocumentAi,
  extractWithGoogleVisionOcr,
  googleDocumentAiConfigured,
  googleVisionConfigured
} from '../lib/google-ocr.js';

const router = Router();
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_REPORT_TEXT_CHARS = 100000;
const MAX_AI_REPORT_TEXT_CHARS = Math.min(
  MAX_REPORT_TEXT_CHARS,
  Number(process.env.MAX_AI_REPORT_TEXT_CHARS || 30000)
);
const AI_SCAN_TIMEOUT_MS = Number(process.env.AI_SCAN_TIMEOUT_MS || 25000);
const CREDIT_REPORT_BUCKET = String(process.env.CREDIT_REPORT_BUCKET || 'credit-report-uploads').trim();
const CREDIT_REPORT_STATUSES = new Set(['new', 'reviewing', 'disputed', 'waiting_response', 'resolved', 'escalated']);

// ── Helpers ───────────────────────────────────────────────────────────────────
function getReportText(req) {
  return String(req.body?.report_text || req.body?.reportText || req.body?.text || '').trim();
}

function getUploadMetadata(req) {
  return {
    filename: String(req.body?.filename || req.body?.file_name || '').trim(),
    fileType: String(req.body?.fileType  || req.body?.file_type  || '').trim(),
    fileData: String(req.body?.fileData  || req.body?.file_data  || '').trim()
  };
}

function decodeBase64File(fileData) {
  const base64 = fileData.includes(',') ? fileData.split(',').pop() : fileData;
  return Buffer.from(base64, 'base64');
}

function safeReportStatus(status) {
  const value = String(status || 'new').trim().toLowerCase();
  return CREDIT_REPORT_STATUSES.has(value) ? value : 'new';
}

async function resolveAuthedUser(req) {
  if (!supabaseAdmin) return null;
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    const error = new Error('Missing authorization header.');
    error.status = 401;
    throw error;
  }
  const token = authHeader.split(' ')[1];
  const host = String(req.hostname || req.headers.host || '').toLowerCase();
  const isLocalHost = host.includes('localhost') || host.includes('127.0.0.1') || host.includes('::1');
  if (token.startsWith('temp-admin:') && (isLocalHost || testAdminModeEnabled())) {
    const user = testAdminUser(token);
    if (user) return user;
  }
  const { data: { user } = {}, error } = await withTimeout(
    supabaseAdmin.auth.getUser(token),
    10000,
    'Auth service took too long to respond.'
  );
  if (error || !user) {
    const authError = new Error('Invalid or expired session.');
    authError.status = 401;
    throw authError;
  }
  return user;
}

async function ensureCreditReportBucket() {
  if (!supabaseAdmin) return false;
  const { data } = await supabaseAdmin.storage.listBuckets();
  if (data?.some(bucket => bucket.name === CREDIT_REPORT_BUCKET)) return true;
  const { error } = await supabaseAdmin.storage.createBucket(CREDIT_REPORT_BUCKET, { public: false });
  if (error && !String(error.message || '').toLowerCase().includes('already exists')) throw error;
  return true;
}

async function maybeSignReportPath(path) {
  if (!supabaseAdmin || !path) return null;
  const { data, error } = await supabaseAdmin.storage.from(CREDIT_REPORT_BUCKET).createSignedUrl(path, 60 * 10);
  if (error) {
    console.warn('[credit-reports] sign url failed:', error.message);
    return null;
  }
  return data?.signedUrl || null;
}

function extractExplicitBureauScores(reportText) {
  const text = String(reportText || '').replace(/\s+/g, ' ');
  const scores = { Equifax: null, Experian: null, TransUnion: null };
  for (const bureau of Object.keys(scores)) {
    const after = new RegExp(`${bureau}.{0,90}?(?:credit\\s*score|fico|vantage(?:score)?|score)\\D{0,18}(3\\d{2}|[4-7]\\d{2}|8[0-4]\\d|850)`, 'i');
    const before = new RegExp(`(?:credit\\s*score|fico|vantage(?:score)?|score)\\D{0,18}(3\\d{2}|[4-7]\\d{2}|8[0-4]\\d|850).{0,90}?${bureau}`, 'i');
    const match = text.match(after) || text.match(before);
    const value = Number(match?.[1]);
    if (value >= 300 && value <= 850) scores[bureau] = value;
  }
  return scores;
}

function maskAccountNumber(value = '') {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 4) return `****${digits.slice(-4)}`;
  if (/[*xX]{2,}\s*\d{2,4}/.test(raw)) return raw.replace(/[xX]/g, '*');
  return 'Review report';
}

function detectBureau(reportText) {
  const text = String(reportText || '');
  const bureaus = ['Equifax', 'Experian', 'TransUnion'].filter(bureau => new RegExp(`\\b${bureau}\\b`, 'i').test(text));
  return bureaus.length === 1 ? bureaus[0] : (bureaus.length > 1 ? 'All' : null);
}

function detectConsumerName(reportText) {
  const text = String(reportText || '').replace(/\s+/g, ' ');
  const patterns = [
    /(?:consumer|prepared for|report for|name)\s*:?\s+([A-Z][A-Za-z' -]{1,32}\s+[A-Z][A-Za-z' -]{1,32})/i,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b(?=.{0,80}(?:credit report|consumer report))/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function detectCreditor(reportText) {
  const text = String(reportText || '').replace(/\s+/g, ' ');
  const patterns = [
    /(?:creditor|furnisher|collector|collection agency|account name|company)\s*:?\s*([A-Z0-9][A-Z0-9 &.'/-]{2,44})/i,
    /(?:capital one|discover|synchrony|portfolio recovery|midland credit|lvnv funding|navient|nelnet|transworld|verizon|comenity|bank of america|chase|citibank|wells fargo|american express)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim().replace(/\s{2,}/g, ' ');
    if (match?.[0]) return match[0].trim().replace(/\s{2,}/g, ' ');
  }
  return 'Review report item';
}

function detectAccountNumber(reportText) {
  const text = String(reportText || '').replace(/\s+/g, ' ');
  const match = text.match(/(?:account|acct|account number)\D{0,20}([*xX -]*\d[\d* xX-]{2,24})/i);
  return maskAccountNumber(match?.[1] || '');
}

function buildDeterministicCreditScan(reportText, reason = 'AI service did not complete in time') {
  const text = String(reportText || '');
  const compact = text.replace(/\s+/g, ' ');
  const lower = compact.toLowerCase();
  const bureauScores = extractExplicitBureauScores(text);
  const bureau = detectBureau(text) || 'All';
  const creditor = detectCreditor(text);
  const account = detectAccountNumber(text);
  const matches = [
    {
      test: /collection|collections|collection agency|placed for collection/i,
      priority: 'high',
      type: 'collection',
      account_type: 'Collection',
      payment_status: 'Collection',
      law: 'FCRA §611 / FDCPA',
      strategy: 'Request validation of ownership, balance, dates, and reporting authority before approving any dispute or mailing.'
    },
    {
      test: /charge[- ]?off|charged off/i,
      priority: 'high',
      type: 'charge_off',
      account_type: 'Charge-off',
      payment_status: 'Charged off',
      law: 'FCRA §611',
      strategy: 'Review the charge-off balance, payment history, first delinquency date, and last reported date for inconsistencies.'
    },
    {
      test: /\b(?:30|60|90|120)\s*(?:days?)?\s*late|late payment|past due|delinquen/i,
      priority: 'medium',
      type: 'late_payment',
      account_type: 'Late Payment',
      payment_status: 'Late',
      law: 'FCRA §611',
      strategy: 'Compare the reported late-payment months against statements and request correction of any unverifiable late marks.'
    },
    {
      test: /hard inquiry|inquiry|permissible purpose/i,
      priority: 'low',
      type: 'inquiry',
      account_type: 'Inquiry',
      payment_status: 'Unknown',
      law: 'FCRA §604',
      strategy: 'Confirm permissible purpose and dispute inquiries that were not authorized or cannot be verified.'
    },
    {
      test: /utilization|over limit|credit limit|high balance|balance/i,
      priority: 'medium',
      type: 'balance_error',
      account_type: 'Balance Error',
      payment_status: 'Unknown',
      law: 'FCRA §611',
      strategy: 'Review balance, credit limit, and last reported date; dispute outdated or inaccurate utilization reporting.'
    }
  ];

  const disputes = [];
  for (const item of matches) {
    if (!item.test.test(lower)) continue;
    disputes.push({
      id: String(disputes.length + 1),
      priority: item.priority,
      type: item.type,
      creditor,
      account,
      account_number: account,
      account_type: item.account_type,
      balance: null,
      credit_limit: null,
      payment_status: item.payment_status,
      late_payments: item.type === 'late_payment' ? 'Late payment language detected — verify exact months manually' : null,
      charge_off: item.type === 'charge_off',
      collection: item.type === 'collection',
      inquiry_date: null,
      opened_date: null,
      reported_date: null,
      first_delinquency_date: null,
      months_late: item.type === 'late_payment' ? 'Review report' : null,
      delinquency_age: null,
      bureau_response_text: null,
      bureau,
      violation: 'Potential inaccurate, incomplete, outdated, or unverifiable reporting. Manual review required.',
      law: item.law,
      strategy: item.strategy,
      estimated_impact: 'Not estimated — review required'
    });
  }

  if (!disputes.length) {
    disputes.push({
      id: '1',
      priority: 'low',
      type: 'other',
      creditor,
      account,
      account_number: account,
      account_type: 'Review Needed',
      balance: null,
      credit_limit: null,
      payment_status: 'Unknown',
      late_payments: null,
      charge_off: false,
      collection: false,
      inquiry_date: null,
      opened_date: null,
      reported_date: null,
      first_delinquency_date: null,
      months_late: null,
      delinquency_age: null,
      bureau_response_text: null,
      bureau,
      violation: 'The report text was extracted, but no clear negative-item pattern was found automatically.',
      law: 'FCRA §611',
      strategy: 'Review the extracted report and select any account that appears inaccurate, incomplete, outdated, duplicated, or unverifiable.',
      estimated_impact: 'Not estimated — review required'
    });
  }

  const high = disputes.filter(item => item.priority === 'high').length;
  const medium = disputes.filter(item => item.priority === 'medium').length;
  const low = disputes.filter(item => item.priority === 'low').length;
  const scoreValues = Object.values(bureauScores).filter(Number.isFinite);

  return {
    summary: {
      total_items: disputes.length,
      high_priority: high,
      medium_priority: medium,
      low_priority: low,
      consumer_name: detectConsumerName(text),
      bureau_name: bureau === 'All' ? null : bureau,
      bureau_scores: bureauScores,
      estimated_score_impact: 'Not estimated — review required',
      report_summary: `${reason}. CREDITOS returned a fast preliminary scan from extracted report text so the upload would not fail. Review before sending anything.`
    },
    disputes,
    positive_items: scoreValues.length ? ['One or more explicit bureau scores were detected in the uploaded report.'] : [],
    action_plan: [
      'Review each detected item before generating letters.',
      'Confirm creditor names, dates, balances, and account numbers against the original report.',
      'Generate draft disputes only for items you approve.'
    ]
  };
}

async function extractPdfText(fileData) {
  if (!fileData) return '';
  let parser = null;
  try {
    // Imported lazily, not at module top level: pdf-parse pulls in pdfjs-dist,
    // which references the browser-only DOMMatrix global at load time. Eagerly
    // importing it crashes the serverless cold start (FUNCTION_INVOCATION_FAILED)
    // whenever its optional @napi-rs/canvas polyfill isn't bundled. Loading it
    // here keeps it off the cold-start path, and any load failure is caught
    // below so a PDF upload degrades to a 422 instead of taking down the function.
    const { PDFParse } = await import('pdf-parse');
    const buffer = decodeBase64File(fileData);
    if (buffer.length > MAX_UPLOAD_BYTES) throw new Error('PDF exceeds the 10 MB upload limit.');
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return String(result?.text || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  } catch (err) {
    console.error('[extractPdfText]', err.message);
    return '';
  } finally {
    await parser?.destroy?.().catch(() => {});
  }
}

// Atomic credit deduction via Supabase RPC.
// Requires the deduct_credits function from supabase/deduct_credits.sql to be installed.
async function deductCredits(userId, amount) {
  if (!supabaseAdmin) throw new Error('Auth service unavailable (Supabase not configured).');
  const { data, error } = await withTimeout(
    supabaseAdmin.rpc('deduct_credits', {
      p_user_id: userId,
      p_amount: amount
    }),
    10000,
    'Credit service took too long to respond.'
  );
  if (error) throw new Error('Credit deduction failed: ' + error.message);
  return data === true;
}

// Call Gemini and run a full credit report scan.
async function runAiScan(reportText) {
  const prompt = `You are an expert credit analyst and FCRA compliance specialist. Analyze this credit report and identify every potential dispute item.

CREDIT REPORT:
<report_text>
${reportText.slice(0, MAX_AI_REPORT_TEXT_CHARS)}
</report_text>

Extract personal information, tradelines, collections, charge-offs, late payments, student loans, public records, hard inquiries, soft inquiries, utilization, payment history, balances, credit limits, account status, payment status, remarks, Metro 2 codes, date opened, date reported, date updated, DOFD, high balance, monthly payment, and creditor information wherever those fields are clearly present.

Run validation checks for duplicate accounts, mixed-file signals, missing dates, wrong balance/status, obsolete accounts, re-aged accounts, payment-history inconsistencies, collection-validation issues, and FCRA/FDCPA/FACTA/Metro 2 concerns. Explain WHY each item matters. Do not invent missing facts.

Return ONLY valid JSON (no markdown, no commentary) in this exact format:
{
  "summary": {
    "total_items": 0,
    "high_priority": 0,
    "medium_priority": 0,
    "low_priority": 0,
    "consumer_name": null,
    "bureau_name": null,
    "bureau_scores": {"Equifax": null, "Experian": null, "TransUnion": null},
    "estimated_score_impact": "+XX to +XX points",
    "report_summary": "Short factual summary of report findings"
  },
  "disputes": [
    {
      "id": "1",
      "priority": "high|medium|low",
      "type": "late_payment|collection|charge_off|inquiry|identity|duplicate|outdated|balance_error|other",
      "creditor": "Creditor Name",
      "account": "Masked account number or description",
      "account_number": "Masked account number only, never full account number",
      "account_type": "Collection|Late Payment|Charge-off|Inquiry|Identity|Duplicate|Outdated|Balance Error|Other",
      "balance": "$0",
      "credit_limit": "$0",
      "payment_status": "Current|Late|Charged off|Collection|Unknown",
      "late_payments": "1-2 late payments",
      "charge_off": false,
      "collection": false,
      "inquiry_date": "YYYY-MM-DD|null",
      "opened_date": "YYYY-MM-DD|null",
      "reported_date": "YYYY-MM-DD|null",
      "first_delinquency_date": "YYYY-MM-DD|null",
      "months_late": "1-2 late payments",
      "delinquency_age": "30|60|90|120+ days|null",
      "bureau_response_text": null,
      "bureau": "Equifax|Experian|TransUnion|All",
      "violation": "Specific FCRA violation or inaccuracy",
      "law": "FCRA §611|FCRA §604|FCRA §605|FDCPA",
      "metro2_rule": "Specific Metro 2 concern or null",
      "reason": "Why this item was flagged using report evidence",
      "supporting_evidence": ["source fact 1", "source fact 2"],
      "strategy": "Recommended dispute strategy",
      "priority_score": 0,
      "dispute_confidence": 0,
      "difficulty_rating": "Easy|Medium|Hard|Review required",
      "time_estimate": "30-45 days",
      "round_number": 1,
      "expected_bureau_response": "Likely response types",
      "alternative_strategy": "Backup strategy if verified",
      "estimated_impact": "+XX points"
    }
  ],
  "positive_items": ["item1", "item2"],
  "action_plan": ["Step 1", "Step 2", "Step 3"]
}

Only populate bureau_scores when the corresponding score is explicitly present in the report. Never infer or manufacture a bureau score. Priority reflects review urgency, not a probability that an item will be removed. Estimated score impacts are non-guaranteed model estimates.`;

  if (!geminiConfigured()) {
    const error = new Error('AI service unavailable (Gemini not configured).');
    error.status = 503;
    throw error;
  }

  const resp = await callGemini({
    max_tokens: 2500,
    prompt,
    responseMimeType: 'application/json',
    timeoutMs: AI_SCAN_TIMEOUT_MS
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini API error (${resp.status})`);
  }

  const data = await resp.json();
  const text = toGeminiText(data);

  try {
    const clean = text.replace(/```json|```/g, '').trim();
    const analysis = JSON.parse(clean);
    analysis.summary = analysis.summary && typeof analysis.summary === 'object' ? analysis.summary : {};
    // Never trust a model-inferred bureau score. Only values explicitly matched
    // beside that bureau and a score label in the source report are returned.
    analysis.summary.bureau_scores = extractExplicitBureauScores(reportText);
    return enhanceCreditAnalysis(analysis, reportText);
  } catch {
    // If Gemini didn't return clean JSON, surface a helpful error
    throw new Error('AI returned an unexpected response format. Please try again.');
  }
}

// ── POST /api/analyze-credit ──────────────────────────────────────────────────
//  Runs a real AI scan on provided report text. Costs 1 credit.
//  Returns credits_remaining so the frontend can update its badge immediately.
//  Falls back to uncredited scan when Supabase is not configured (local dev).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/analyze-credit', requireAuth, async (req, res) => {
  const reportText = getReportText(req);
  const reportId = String(req.body?.reportId || '').trim();

  if (reportText.length < 20) {
    return res.status(400).json({
      error: 'Credit report text is required and must be at least 20 characters.'
    });
  }
  if (reportText.length > MAX_REPORT_TEXT_CHARS) {
    return res.status(413).json({ error: 'Credit report text must be under 100,000 characters.' });
  }

  // ── Credit check (skipped when Supabase is not configured) ────────────────
  let creditsRemaining = null;
  const testAdmin = !!req.testAdmin || await isAdminUser(req.user?.id, req.user?.email || null);

  if (supabaseAdmin && !testAdmin) {
    // Deduct 1 credit atomically before hitting Gemini
    let ok;
    try {
      ok = await deductCredits(req.user.id, 1);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }

    if (!ok) {
      return res.status(402).json({
        error: 'You are out of credits. Please upgrade or buy more credits.',
        credits_needed: 1
      });
    }

    // Fetch remaining balance to return to the client
    try {
      const { data: profile } = await withTimeout(supabaseAdmin
        .from('profiles')
        .select('credits, plan')
        .eq('id', req.user.id)
        .single(), 8000, 'Credit balance lookup timed out.');

      const unlimited = isUnlimitedPlan(profile?.plan);
      creditsRemaining = unlimited || testAdmin ? null : (profile?.credits ?? 0);
    } catch {
      // Non-fatal — client will refetch balance on next load
    }
  }

  // ── Run AI scan ────────────────────────────────────────────────────────────
  try {
    let analysis;
    let source = testAdmin ? 'ai-admin' : (supabaseAdmin ? 'ai' : 'ai-local');
    let warning = null;

    try {
      analysis = await runAiScan(reportText);
    } catch (aiError) {
      const fallbackReason = aiError?.status === 504
        ? 'AI analysis timed out before completion'
        : (aiError?.message || 'AI analysis could not be completed');
      console.warn('[/analyze-credit:fallback]', fallbackReason);
      analysis = buildCreditIntelligenceAnalysis(reportText, { reason: fallbackReason });
      source = testAdmin ? 'fallback-admin' : (supabaseAdmin ? 'fallback' : 'fallback-local');
      warning = 'AI analysis returned a preliminary scan because the live AI service did not complete fast enough. Review all draft results before sending.';
    }

    if (supabaseAdmin && reportId) {
      const analysisSummary = {
        total_items: Number(analysis?.summary?.total_items ?? analysis?.disputes?.length ?? 0),
        high_priority: Number(analysis?.summary?.high_priority ?? 0),
        medium_priority: Number(analysis?.summary?.medium_priority ?? 0),
        low_priority: Number(analysis?.summary?.low_priority ?? 0),
        bureau_scores: analysis?.summary?.bureau_scores || {},
        estimated_score_impact: analysis?.summary?.estimated_score_impact || null
      };
      const reportStatus = (analysis?.disputes || []).length ? 'reviewing' : 'new';
      const { error: updateError } = await withTimeout(supabaseAdmin
        .from('credit_report_uploads')
        .update({
          status: reportStatus,
          analysis_json: analysis,
          analysis_summary: analysisSummary,
          bureau_scores_json: analysisSummary.bureau_scores,
          updated_at: new Date().toISOString()
        })
        .eq('id', reportId)
        .eq('user_id', req.user.id), 8000, 'Credit report analysis save timed out.');
      if (updateError && !isMissingSchemaError(updateError)) console.warn('[credit-report-upload:update]', updateError.message);
    }

    res.json({
      success: true,
      source,
      analysis,
      credits_remaining: creditsRemaining,
      warning
    });
  } catch (e) {
    console.error('[/analyze-credit]', e.message);
    res.status(500).json({ error: e.message || 'Credit analysis failed.' });
  }
});

// ── POST /api/upload-credit-report ───────────────────────────────────────────
//  Accepts a TXT or PDF file. Extracts text and returns it for the frontend
//  to pass to /api/analyze-credit. Does NOT run AI or charge credits itself —
//  all analysis and billing goes through /api/analyze-credit.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/upload-credit-report', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    let reportText = getReportText({ body });
    const { filename, fileType, fileData } = getUploadMetadata({ body });
    const currentUser = supabaseAdmin ? await resolveAuthedUser(req) : null;
    const isPdf = filename && (fileType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf'));
    const isImage = fileType.startsWith('image/') || /\.(png|jpe?g|webp|tiff?)$/i.test(filename || '');
    let extractionMethod = String(body?.extractionMethod || (isPdf ? 'pdf-text' : isImage ? 'google-ocr' : 'text')).trim();
    const reportScope = String(body?.reportScope || body?.scope || body?.metadata?.reportScope || 'credit').trim().toLowerCase() || 'credit';
    const encoded = fileData.includes(',') ? fileData.split(',').pop() : fileData;
    const approximateBytes = Math.floor((encoded?.length || 0) * 3 / 4);
    const buffer = fileData ? Buffer.from(encoded || '', 'base64') : null;
    let ocrProvider = null;
    let ocrMetadata = {};

    if (approximateBytes > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ success: false, error: 'Choose a PDF smaller than 10 MB.' });
    }

    if (!reportText && !isPdf && !isImage) {
      return res.status(400).json({
        success: false,
        error: 'Provide credit report text or a PDF file.'
      });
    }

    // Extract text from PDF if needed
    if (isPdf && fileData) {
      reportText = await extractPdfText(fileData);
      if (!reportText && buffer && googleDocumentAiConfigured()) {
        try {
          const googleResult = await extractWithGoogleDocumentAi({ buffer, mimeType: fileType || 'application/pdf' });
          reportText = googleResult.text;
          extractionMethod = googleResult.provider;
          ocrProvider = googleResult.provider;
          ocrMetadata = googleResult.metadata || {};
        } catch (googleError) {
          console.warn('[google-document-ai]', googleError.message);
        }
      }
      if (!reportText) {
        return res.status(422).json({
          success: false,
          error: googleDocumentAiConfigured()
            ? 'No readable text could be extracted from this PDF.'
            : 'No readable text could be extracted. This may be an image-only PDF; Google Document AI is not configured yet, so use a searchable PDF or paste the report text.'
        });
      }
    }

    if (!reportText && isImage && buffer) {
      if (googleVisionConfigured()) {
        try {
          const googleResult = await extractWithGoogleVisionOcr({ buffer });
          reportText = googleResult.text;
          extractionMethod = googleResult.provider;
          ocrProvider = googleResult.provider;
          ocrMetadata = googleResult.metadata || {};
        } catch (googleError) {
          console.warn('[google-vision-ocr]', googleError.message);
        }
      } else if (googleDocumentAiConfigured()) {
        try {
          const googleResult = await extractWithGoogleDocumentAi({ buffer, mimeType: fileType || 'image/jpeg' });
          reportText = googleResult.text;
          extractionMethod = googleResult.provider;
          ocrProvider = googleResult.provider;
          ocrMetadata = googleResult.metadata || {};
        } catch (googleError) {
          console.warn('[google-document-ai]', googleError.message);
        }
      }
    }

    if (reportText && reportText.length < 20) {
      return res.status(400).json({
        success: false,
        error: 'Credit report text must be at least 20 characters.'
      });
    }
    if (!reportText) {
      return res.status(422).json({
        success: false,
        error: isImage
          ? 'No readable text could be extracted from this image. Google Vision OCR is not configured yet or could not read it.'
          : 'No readable text could be extracted.'
      });
    }
    if (reportText && reportText.length > MAX_REPORT_TEXT_CHARS) {
      return res.status(413).json({ success: false, error: 'Credit report text must be under 100,000 characters.' });
    }

    let uploaded = {
      id: `report-${Date.now()}`,
      filename: filename || null,
      fileType: fileType || null,
      charactersReceived: reportText.length,
      receivedAt: new Date().toISOString(),
      status: 'new'
    };

    if (supabaseAdmin && currentUser) {
      uploaded = { ...uploaded, id: randomUUID(), persistenceStatus: 'pending' };
      let storagePath = null;
      if (buffer && buffer.length) {
        try {
          await ensureCreditReportBucket();
          storagePath = `${currentUser.id}/${uploaded.id}/${filename || 'credit-report.pdf'}`;
          const { error: uploadError } = await supabaseAdmin.storage.from(CREDIT_REPORT_BUCKET).upload(storagePath, buffer, {
            contentType: fileType || 'application/octet-stream',
            upsert: false
          });
          if (uploadError) throw uploadError;
          uploaded = { ...uploaded, storagePath };
        } catch (storageError) {
          console.warn('[credit-report-upload:storage]', storageError.message);
          storagePath = null;
          uploaded = { ...uploaded, persistenceStatus: 'storage-skipped' };
        }
      }

      const { error: insertError } = await withTimeout(supabaseAdmin.from('credit_report_uploads').insert({
        id: uploaded.id,
        user_id: currentUser.id,
        original_filename: filename || null,
        file_type: fileType || null,
        storage_path: uploaded.storagePath || null,
        extraction_method: extractionMethod || 'text',
        characters_received: reportText.length,
        extracted_text: reportText,
        status: 'new',
        metadata: {
          source: 'upload-credit-report',
          has_file: !!fileData,
          created_from: isPdf ? 'pdf' : 'text',
          reportScope,
          report_scope: reportScope,
          ocr_provider: ocrProvider,
          ocr_metadata: ocrMetadata
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }), 8000, 'Credit report history save timed out.');
      if (insertError) {
        if (!isMissingSchemaError(insertError)) console.warn('[credit-report-upload:insert]', insertError.message);
        uploaded = { ...uploaded, persistenceStatus: 'history-skipped' };
      } else {
        uploaded = { ...uploaded, persistenceStatus: uploaded.persistenceStatus === 'storage-skipped' ? 'storage-skipped' : 'saved' };
      }
    }

    // Return the extracted text — frontend will pass it to /api/analyze-credit
    res.json({
      success: true,
      extractedText: reportText,
      uploaded: {
        ...uploaded,
        metadata: {
          extractionMethod,
          reportScope,
          report_scope: reportScope,
          ocr_provider: ocrProvider,
          ocr_metadata: ocrMetadata
        }
      }
      // No `analysis` field here — all AI work goes through /api/analyze-credit
    });
  } catch (error) {
    console.error('[upload-credit-report]', error);
    res.status(error.status || 500).json({
      success: false,
      error: error.status ? (error.message || 'Credit report upload failed.') : 'Credit report upload failed.'
    });
  }
});

router.get('/credit-reports', requireAuth, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Credit report history is unavailable.' });
    }

    const { data, error } = await withTimeout(supabaseAdmin
      .from('credit_report_uploads')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50), 8000, 'Credit report history lookup timed out.');

    if (error) {
      if (isMissingSchemaError(error)) return res.json({ success: true, reports: [], blocked: 'Credit report history table is not installed yet.' });
      throw error;
    }

    const reports = await Promise.all((data || []).map(async row => ({
      ...row,
      signedUrl: row.storage_path ? await maybeSignReportPath(row.storage_path) : null
    })));

    res.json({ success: true, reports });
  } catch (error) {
    console.error('[credit-reports]', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Could not load credit report history.' });
  }
});

router.patch('/credit-reports/:id/status', requireAuth, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Credit report status updates are unavailable.' });
    }

    const status = safeReportStatus(req.body?.status);
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
    const { data, error } = await withTimeout(supabaseAdmin
      .from('credit_report_uploads')
      .update({
        status,
        metadata,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select('*')
      .maybeSingle(), 8000, 'Credit report status update timed out.');

    if (error) {
      if (isMissingSchemaError(error)) return res.status(503).json({ error: 'Credit report history table is not installed yet.' });
      throw error;
    }
    if (!data) return res.status(404).json({ error: 'Credit report not found.' });

    res.json({ success: true, report: data });
  } catch (error) {
    console.error('[credit-reports/status]', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Could not update credit report status.' });
  }
});

// ── GET /api/funding-offers ───────────────────────────────────────────────────
//  Returns static lender recommendations shown alongside scan results.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/funding-offers', requireAuth, (req, res) => {
  res.json({
    success: true,
    offers: [
      {
        lender: 'FundBox',
        product: 'Working Capital Line',
        amount: '$10K - $35K',
        estimatedFit: 'Strong',
        why: 'The profile may fit the listed revenue and utilization baseline.',
        nextStep: 'Review official requirements after utilization drops below 20%.',
        applicationsConnected: false
      },
      {
        lender: 'Bluevine',
        product: 'Business Line of Credit',
        amount: '$15K - $50K',
        estimatedFit: 'Possible',
        why: 'Some baseline requirements may fit, but business credit depth is still limited.',
        nextStep: 'Build two reporting vendor accounts before reviewing official terms.',
        applicationsConnected: false
      },
      {
        lender: 'OnDeck',
        product: 'Term Loan',
        amount: '$25K - $75K',
        estimatedFit: 'Possible',
        why: 'This path generally depends on time in business and consistent revenue.',
        nextStep: 'Prepare revenue records and confirm at least one year in business.',
        applicationsConnected: false
      }
    ]
  });
});

// ── POST /api/leads ───────────────────────────────────────────────────────────
//  Public lead capture from the landing-page quiz. Stores name, email, and quiz
//  answers in the `leads` table when Supabase is configured; always returns 200
//  so the landing page never blocks the user on lead capture.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/leads', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 200);
  const name  = String(req.body?.name  || '').trim().slice(0, 100);
  const answers = req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {};

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!validEmail) {
    return res.status(400).json({ success: false, error: 'A valid email is required.' });
  }

  if (supabaseAdmin) {
    try {
      const { error } = await supabaseAdmin.from('leads').upsert(
        { email, name, answers, source: 'landing-quiz', created_at: new Date().toISOString() },
        { onConflict: 'email' }
      );
      if (error) console.warn('[leads]', error.message);
    } catch (e) {
      console.warn('[leads]', e.message);
    }
  } else {
    console.log(`[leads] (no db) ${email} ${name} ${JSON.stringify(answers)}`);
  }

  res.json({ success: true });
});

export default router;
