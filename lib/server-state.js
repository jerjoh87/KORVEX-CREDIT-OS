import { createClient } from '@supabase/supabase-js';

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

export { supabaseAdmin };
