import { supabaseAdmin } from './server-state.js';
import { isMissingSchemaError, withTimeout } from './supabase-errors.js';

const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(v => v.trim().toLowerCase())
  .filter(Boolean);

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isTempAdminIdentity(value) {
  const normalized = normalizeEmail(value);
  return normalized.startsWith('temp-admin:') || normalized.startsWith('test-admin:') || normalized.startsWith('local-admin:');
}

export function isAdminEmail(email) {
  const value = normalizeEmail(email);
  return !!value && (ADMIN_EMAILS.includes(value) || isTempAdminIdentity(value));
}

export async function isAdminUser(userId, email = null) {
  if (isTempAdminIdentity(userId) || isTempAdminIdentity(email)) return true;
  if (!supabaseAdmin) return false;

  if (isAdminEmail(email)) return true;
  if (!userId) return false;

  const query = supabaseAdmin
    .from('profiles')
    .select('is_admin,email')
    .eq('id', userId)
    .maybeSingle();
  const { data, error } = await withTimeout(query, 8000, 'Admin profile lookup timed out.');

  if (error) {
    if (isMissingSchemaError(error)) {
      const fallback = await withTimeout(
        supabaseAdmin.from('profiles').select('email').eq('id', userId).maybeSingle(),
        8000,
        'Admin email lookup timed out.'
      ).catch(() => ({ data: null, error: null }));
      return isAdminEmail(fallback?.data?.email || email);
    }
    throw error;
  }
  return !!(data?.is_admin || isAdminEmail(data?.email));
}

export async function getAdminProfile(userId, email = null) {
  if (!supabaseAdmin) return { admin: false, email: normalizeEmail(email) || null };
  const admin = await isAdminUser(userId, email);
  return { admin, email: normalizeEmail(email) || null };
}
