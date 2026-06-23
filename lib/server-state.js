import { createClient } from '@supabase/supabase-js';
import { withTimeout } from './supabase-errors.js';
import { testAdminModeEnabled, testAdminUser } from './test-admin.js';

let supabaseAdmin = null;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (supabaseUrl && supabaseKey) {
  supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

export function hasSupabaseAdmin() {
  return !!supabaseAdmin;
}

export async function requireAuth(req, res, next) {
  const host = String(req.hostname || req.headers.host || '').toLowerCase();
  const isLocalHost = host.includes('localhost') || host.includes('127.0.0.1') || host.includes('::1');
  const authHeader = req.headers.authorization;
  const tempToken = authHeader?.startsWith('Bearer temp-admin:') ? authHeader.split(' ')[1] : '';

  if (tempToken && (isLocalHost || testAdminModeEnabled())) {
    const user = testAdminUser(tempToken);
    if (!user) return res.status(401).json({ error: 'Invalid or expired temporary admin session.' });
    req.user = user;
    req.testAdmin = true;
    return next();
  }

  if (!supabaseAdmin) {
    return res.status(503).json({
      error: 'Auth service unavailable (Supabase not configured).'
    });
  }

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header.' });
  }

  const token = authHeader.split(' ')[1];

  let authResult;
  try {
    authResult = await withTimeout(
      supabaseAdmin.auth.getUser(token),
      10000,
      'Auth service took too long to respond.'
    );
  } catch (error) {
    console.error('[auth]', error.message);
    return res.status(error.status || 503).json({ error: 'Auth service temporarily unavailable.' });
  }

  const { data: { user } = {}, error } = authResult || {};

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }

  req.user = user;
  next();
}

export { supabaseAdmin };
