// ─────────────────────────────────────────────
//  CREDITOS — Credit API Routes
//  routes/creditApi.js
//
//  POST /api/analyze-credit       — AI scan (1 credit)
//  POST /api/upload-credit-report — PDF/TXT text extraction
//  GET  /api/funding-offers       — curated lender list
//  POST /api/leads                — landing-page lead capture (public)
// ─────────────────────────────────────────────
import { Router } from 'express';
import { requireAuth, supabaseAdmin } from '../lib/server-state.js';
import { isUnlimitedPlan } from '../lib/billing.js';
import { callGemini, geminiConfigured, toGeminiText } from '../lib/gemini.js';

const router = Router();
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_REPORT_TEXT_CHARS = 100000;

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
  const { data, error } = await supabaseAdmin.rpc('deduct_credits', {
    p_user_id: userId,
    p_amount: amount
  });
  if (error) throw new Error('Credit deduction failed: ' + error.message);
  return data === true;
}

// Call Gemini and run a full credit report scan.
async function runAiScan(reportText) {
  const prompt = `You are an expert credit analyst and FCRA compliance specialist. Analyze this credit report and identify every potential dispute item.

CREDIT REPORT:
<report_text>
${reportText.slice(0, MAX_REPORT_TEXT_CHARS)}
</report_text>

Return ONLY valid JSON (no markdown, no commentary) in this exact format:
{
  "summary": {
    "total_items": 0,
    "high_priority": 0,
    "medium_priority": 0,
    "low_priority": 0,
    "bureau_scores": {"Equifax": null, "Experian": null, "TransUnion": null},
    "estimated_score_impact": "+XX to +XX points"
  },
  "disputes": [
    {
      "id": "1",
      "priority": "high|medium|low",
      "type": "late_payment|collection|charge_off|inquiry|identity|duplicate|outdated|balance_error|other",
      "creditor": "Creditor Name",
      "account": "Account number or description",
      "bureau": "Equifax|Experian|TransUnion|All",
      "violation": "Specific FCRA violation or inaccuracy",
      "law": "FCRA §611|FCRA §604|FCRA §605|FDCPA",
      "strategy": "Recommended dispute strategy",
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
    max_tokens: 4000,
    prompt,
    responseMimeType: 'application/json'
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
    return analysis;
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

  if (supabaseAdmin) {
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
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('credits, plan')
        .eq('id', req.user.id)
        .single();

      const unlimited = isUnlimitedPlan(profile?.plan);
      creditsRemaining = unlimited ? null : (profile?.credits ?? 0);
    } catch {
      // Non-fatal — client will refetch balance on next load
    }
  }

  // ── Run AI scan ────────────────────────────────────────────────────────────
  try {
    const analysis = await runAiScan(reportText);
    res.json({
      success: true,
      source: supabaseAdmin ? 'ai' : 'ai-local',
      analysis,
      credits_remaining: creditsRemaining
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
router.post('/upload-credit-report', requireAuth, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    let reportText = getReportText({ body });
    const { filename, fileType, fileData } = getUploadMetadata({ body });
    const isPdf = filename && (fileType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf'));
    const encoded = fileData.includes(',') ? fileData.split(',').pop() : fileData;
    const approximateBytes = Math.floor((encoded?.length || 0) * 3 / 4);

    if (approximateBytes > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ success: false, error: 'Choose a PDF smaller than 10 MB.' });
    }

    if (!reportText && !isPdf) {
      return res.status(400).json({
        success: false,
        error: 'Provide credit report text or a PDF file.'
      });
    }

    // Extract text from PDF if needed
    if (isPdf && fileData) {
      reportText = await extractPdfText(fileData);
      if (!reportText) {
        return res.status(422).json({
          success: false,
          error: 'No readable text could be extracted. This may be an image-only PDF; export a searchable PDF or paste the report text.'
        });
      }
    }

    if (reportText && reportText.length < 20 && !isPdf) {
      return res.status(400).json({
        success: false,
        error: 'Credit report text must be at least 20 characters.'
      });
    }
    if (reportText && reportText.length > MAX_REPORT_TEXT_CHARS) {
      return res.status(413).json({ success: false, error: 'Credit report text must be under 100,000 characters.' });
    }

    // Return the extracted text — frontend will pass it to /api/analyze-credit
    res.json({
      success: true,
      extractedText: reportText,
      uploaded: {
        id: `report-${Date.now()}`,
        filename: filename || null,
        fileType: fileType || null,
        charactersReceived: reportText.length,
        receivedAt: new Date().toISOString()
      }
      // No `analysis` field here — all AI work goes through /api/analyze-credit
    });
  } catch (error) {
    console.error('[upload-credit-report]', error);
    res.status(500).json({
      success: false,
      error: 'Credit report upload failed.'
    });
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
