// ─────────────────────────────────────────────
//  CREDITOS — Express Backend
//  server.js
// ─────────────────────────────────────────────

// instrument.js must be the very first import — Sentry needs to load before
// anything else so it can patch modules for automatic error capture.
import './instrument.js';

import 'dotenv/config';
import Sentry from './instrument.js';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { requireAuth, supabaseAdmin, hasSupabaseAdmin } from './lib/server-state.js';

import aiRoutes from './routes/ai.js';
import creditsRoutes from './routes/credits.js';
import creditApiRoutes from './routes/creditApi.js';
import launchRoutes from './routes/launch.js';
import caseRoutes from './routes/cases.js';
import mailingRoutes from './routes/mailing.js';
import disputeRoutes from './routes/disputes.js';
import responseRoutes from './routes/responses.js';

const app  = express();
const PORT = process.env.PORT || 3001;
const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

// Railway and other production hosts terminate TLS at a trusted reverse proxy.
// This keeps rate-limit keys and req.ip tied to the real client address.
app.set('trust proxy', 1);

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

app.use((req, res, next) => {
  console.error(`[request] ${req.method} ${req.url}`);
  next();
});

function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function normalizeHost(value) {
  try {
    return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return String(value || '').trim().toLowerCase().replace(/^www\./, '');
  }
}

function resolveAllowedOrigins() {
  const origins = new Set([
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3002'
  ]);

  const configured = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : [];
  configured.forEach(origin => {
    const normalized = normalizeOrigin(origin);
    if (normalized) origins.add(normalized);
  });

  const appOrigin = normalizeOrigin(process.env.APP_BASE_URL || process.env.APP_URL);
  if (appOrigin) origins.add(appOrigin);

  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
  const vercelOrigin = normalizeOrigin(vercelUrl);
  if (vercelOrigin) origins.add(vercelOrigin);

  return [...origins];
}

// ── Supabase (OPTIONAL — will not crash if missing) ───────────────────────────
if (!hasSupabaseAdmin()) {
  console.log("⚠️ Supabase not configured; using SQLite/local routes.");
}

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = resolveAllowedOrigins();

// Same-origin requests (the app fetching its own /api) still send an Origin
// header on POST, so they must be allowed even when their domain isn't in the
// allow-list — otherwise every POST 500s with "Request origin is not allowed".
// A request is same-origin when the Origin's host matches the Host it arrived
// on; this is robust across Vercel preview/prod aliases and custom domains with
// no extra env config. Genuine cross-origin callers that aren't allow-listed are
// simply denied CORS headers (the browser blocks them) — we never throw a 500.
function isAllowedOrigin(origin, req) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  const host = req.headers.host;
  if (host) {
    try {
      const originHost = normalizeHost(origin);
      const requestHost = normalizeHost(host);
      if (originHost === requestHost) return true;
      if (originHost.replace(/^www\./, '') === requestHost.replace(/^www\./, '')) return true;
      if (originHost.endsWith('.vercel.app') && requestHost.endsWith('.vercel.app')) {
        const originApp = originHost.split('.')[0];
        const requestApp = requestHost.split('.')[0];
        if (originApp === requestApp || originApp.startsWith(requestApp) || requestApp.startsWith(originApp)) return true;
      }
    } catch { /* malformed Origin */ }
  }
  return false;
}

app.use(cors((req, cb) => {
  cb(null, {
    origin: isAllowedOrigin(req.headers.origin, req),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  });
}));

// ── Body parsing ─────────────────────────────────────────────────────────────
// Stripe webhook needs the raw body for signature verification — must come BEFORE express.json()
app.use('/api/credits/stripe', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '15mb' }));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON body.'
    });
  }

  next(err);
});

// ── Rate limit (API only — static pages must never burn the quota) ───────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes.' }
});
app.use('/api', globalLimiter);


// ── Health check (must be before catch-all /api route) ───────────────────────
app.get('/api/health', (req, res) => {
  console.error('[route] /api/health');
  res.json({
    ok: true,
    service: 'CREDITOS',
    timestamp: new Date().toISOString(),
    database: supabaseAdmin ? 'connected' : 'not configured'
  });
});

app.get('/api/runtime-status', (req, res) => {
  res.json({
    ok: true,
    appUrl: process.env.APP_BASE_URL || process.env.APP_URL || null,
    testAdminMode: String(process.env.TEST_ADMIN_MODE || '').toLowerCase() === 'true',
    services: {
      supabase: !!supabaseAdmin,
      stripe: !!process.env.STRIPE_SECRET_KEY,
      click2mail: !!(process.env.CLICK2MAIL_USERNAME && process.env.CLICK2MAIL_PASSWORD),
      gemini: !!process.env.GEMINI_API_KEY,
      ocr: 'browser',
      pdf: 'browser'
    }
  });
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/ai',       aiRoutes);
app.use('/api/credits',  creditsRoutes);
app.use('/api/cases',    caseRoutes);
app.use('/api/launch',   launchRoutes);
app.use('/api/mailing',  mailingRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/responses', responseRoutes);
app.use('/api',          creditApiRoutes);

// ── Static frontend ──────────────────────────────────────────────────────────
// Frontend lives in /public. On Vercel this is served by the CDN directly
// (see vercel.json); this middleware is what serves it under `node server.js`.
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Home route
app.get('/', (req, res) => {
  console.error('[route] /');
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ── Sentry error handler (must be before any other error handler) ────────────
if (process.env.SENTRY_DSN && Sentry?.setupExpressErrorHandler) {
  Sentry.setupExpressErrorHandler(app);
}

// ── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[server error]', err.message);
  res.status(500).json({
    success: false,
    error: err.message?.startsWith('CORS blocked')
      ? 'Request origin is not allowed.'
      : 'Internal server error.'
  });
});

// ── Start ────────────────────────────────────────────────────────────────────
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`🚀 CREDITOS running on port ${port}`);
    console.log(`   Supabase: ${supabaseAdmin ? '✓ connected' : '✗ not configured'}`);
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE' && !process.env.PORT) {
      const nextPort = Number(port) + 1;
      console.warn(`⚠️ Port ${port} is busy; trying ${nextPort}.`);
      startServer(nextPort);
      return;
    }

    throw err;
  });
}

if (isDirectRun) {
  startServer(PORT);
}

export default function handler(req, res) {
  return app(req, res);
}
