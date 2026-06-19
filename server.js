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
import { createClient } from '@supabase/supabase-js';

import aiRoutes from './routes/ai.js';
import creditsRoutes from './routes/credits.js';
import creditApiRoutes from './routes/creditApi.js';

const app  = express();
const PORT = process.env.PORT || 3001;
const isVercel = !!process.env.VERCEL;
const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

// Railway and other production hosts terminate TLS at a trusted reverse proxy.
// This keeps rate-limit keys and req.ip tied to the real client address.
app.set('trust proxy', 1);

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Supabase (OPTIONAL — will not crash if missing) ───────────────────────────
let supabaseAdmin = null;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (supabaseUrl && supabaseKey) {
  supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
} else {
  console.log("⚠️ Supabase not configured; using SQLite/local routes.");
}

export { supabaseAdmin };

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:3002'
    ];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
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

// ── Auth middleware (SAFE if Supabase missing) ───────────────────────────────
export async function requireAuth(req, res, next) {
  if (!supabaseAdmin) {
    return res.status(503).json({
      error: 'Auth service unavailable (Supabase not configured).'
    });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header.' });
  }

  const token = authHeader.split(' ')[1];

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }

  req.user = user;
  next();
}

// ── Health check (must be before catch-all /api route) ───────────────────────
app.get('/api/health', (req, res) => {
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
    services: {
      supabase: !!supabaseAdmin,
      stripe: !!process.env.STRIPE_SECRET_KEY,
      gemini: !!process.env.GEMINI_API_KEY,
      ocr: 'browser',
      pdf: 'browser'
    }
  });
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/ai',      aiRoutes);
app.use('/api/credits', creditsRoutes);
app.use('/api',         creditApiRoutes);

// ── Static frontend (IMPORTANT FOR RENDER) ───────────────────────────────────
app.use(express.static(__dirname));

// Home route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ── Sentry error handler (must be before any other error handler) ────────────
if (process.env.SENTRY_DSN) {
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

if (isDirectRun && !isVercel) {
  startServer(PORT);
}

export default app;
