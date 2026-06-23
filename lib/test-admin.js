import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_PREFIX = 'temp-admin:';
const DEFAULT_LOCAL_USERNAME = 'admin';
const DEFAULT_LOCAL_PASSWORD = 'password';
const DEFAULT_EMAIL = 'temp-admin@creditos.test';

function boolEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function base64UrlEncode(value) {
  return Buffer.from(String(value)).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(String(value), 'base64url').toString('utf8');
}

function tokenSecret() {
  return String(
    process.env.TEST_ADMIN_SECRET ||
    process.env.WEBHOOK_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    ''
  ).trim();
}

export function testAdminModeEnabled() {
  return boolEnv(process.env.TEST_ADMIN_MODE) || boolEnv(process.env.TEMP_ADMIN_LOGIN_ENABLED);
}

export function testAdminCredentials() {
  return {
    username: String(process.env.TEST_ADMIN_USERNAME || DEFAULT_LOCAL_USERNAME).trim(),
    password: String(process.env.TEST_ADMIN_PASSWORD || DEFAULT_LOCAL_PASSWORD).trim(),
    email: String(process.env.TEST_ADMIN_EMAIL || DEFAULT_EMAIL).trim().toLowerCase()
  };
}

export function validateTestAdminCredentials(username, password) {
  if (!testAdminModeEnabled()) return false;
  const expected = testAdminCredentials();
  return String(username || '').trim() === expected.username && String(password || '') === expected.password;
}

function signPayload(payload) {
  const secret = tokenSecret();
  if (!secret) return null;
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createTestAdminToken({ email = null } = {}) {
  const safeEmail = String(email || testAdminCredentials().email || DEFAULT_EMAIL).trim().toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(JSON.stringify({
    sub: 'temp-admin',
    email: safeEmail,
    iat: now,
    exp: now + 12 * 60 * 60
  }));
  const signature = signPayload(payload);
  if (!signature) {
    const error = new Error('Temporary admin secret is not configured.');
    error.status = 503;
    throw error;
  }
  return `${TOKEN_PREFIX}${payload}.${signature}`;
}

export function verifyTestAdminToken(token) {
  const raw = String(token || '').trim();
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const body = raw.slice(TOKEN_PREFIX.length);

  // Local legacy token: temp-admin:email@example.com
  if (!body.includes('.')) {
    return { email: body.trim().toLowerCase() || DEFAULT_EMAIL, legacy: true };
  }

  const [payload, signature] = body.split('.');
  const expected = signPayload(payload);
  if (!payload || !signature || !expected) return null;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(base64UrlDecode(payload));
    if (parsed?.sub !== 'temp-admin') return null;
    if (Number(parsed?.exp || 0) < Math.floor(Date.now() / 1000)) return null;
    return { email: String(parsed.email || DEFAULT_EMAIL).trim().toLowerCase(), legacy: false };
  } catch {
    return null;
  }
}

export function testAdminUser(token) {
  const verified = verifyTestAdminToken(token);
  if (!verified) return null;
  const id = `${TOKEN_PREFIX}${verified.email}`;
  return {
    id,
    email: verified.email,
    app_metadata: { provider: 'temp-admin' },
    user_metadata: { full_name: 'Temporary Admin' }
  };
}
