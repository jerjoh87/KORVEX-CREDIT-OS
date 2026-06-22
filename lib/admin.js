import { supabaseAdmin } from './server-state.js';

const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(v => v.trim().toLowerCase())
  .filter(Boolean);

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isAdminEmail(email) {
  const value = normalizeEmail(email);
  return !!value && ADMIN_EMAILS.includes(value);
}

export async function isAdminUser(userId, email = null) {
  if (!supabaseAdmin) return false;

  if (isAdminEmail(email)) return true;
  if (!userId) return false;

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('is_admin,email')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return !!(data?.is_admin || isAdminEmail(data?.email));
}

export async function getAdminProfile(userId, email = null) {
  if (!supabaseAdmin) return { admin: false, email: normalizeEmail(email) || null };
  const admin = await isAdminUser(userId, email);
  return { admin, email: normalizeEmail(email) || null };
}
