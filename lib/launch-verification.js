import { supabaseAdmin } from './server-state.js';

const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(v => v.trim().toLowerCase())
  .filter(Boolean);

export const LAUNCH_VERIFICATION_CHECKS = [
  {
    key: 'auth_email_verification',
    label: 'Auth email verification tested',
    eventTypes: ['auth_email_verification'],
    provider: 'supabase'
  },
  {
    key: 'auth_magic_link',
    label: 'Magic link tested',
    eventTypes: ['auth_magic_link'],
    provider: 'supabase'
  },
  {
    key: 'auth_google_sign_in',
    label: 'Google sign-in tested',
    eventTypes: ['auth_google_sign_in'],
    provider: 'supabase'
  },
  {
    key: 'auth_password_reset',
    label: 'Password reset tested',
    eventTypes: ['auth_password_reset'],
    provider: 'supabase'
  },
  {
    key: 'stripe_checkout_completed',
    label: 'Stripe checkout completed',
    eventTypes: ['stripe_checkout_completed'],
    provider: 'stripe'
  },
  {
    key: 'stripe_webhook_received',
    label: 'Stripe webhook received',
    eventTypes: ['stripe_webhook_received'],
    provider: 'stripe'
  },
  {
    key: 'stripe_subscription_state',
    label: 'Stripe subscription cancelled/updated',
    eventTypes: ['stripe_subscription_updated', 'stripe_subscription_cancelled'],
    provider: 'stripe'
  },
  {
    key: 'click2mail_packet_generated',
    label: 'Click2Mail packet generated',
    eventTypes: ['click2mail_packet_generated'],
    provider: 'click2mail'
  },
  {
    key: 'click2mail_job_created',
    label: 'Click2Mail certified mail job created',
    eventTypes: ['click2mail_certified_mail_job_created'],
    provider: 'click2mail'
  },
  {
    key: 'click2mail_status_received',
    label: 'Click2Mail tracking/status received',
    eventTypes: ['click2mail_tracking_status_received'],
    provider: 'click2mail'
  }
];

const ALLOWED_EVENT_TYPES = new Set(
  LAUNCH_VERIFICATION_CHECKS.flatMap(check => check.eventTypes).concat([
    'stripe_billing_portal_opened'
  ])
);

const ALLOWED_PROVIDERS = new Set(['supabase', 'stripe', 'click2mail', 'ui', 'system']);
const ALLOWED_STATUSES = new Set(['pass', 'fail', 'blocked']);

function safeStatus(status) {
  const value = String(status || 'pass').trim().toLowerCase();
  return ALLOWED_STATUSES.has(value) ? value : 'pass';
}

function safeProvider(provider) {
  const value = String(provider || 'system').trim().toLowerCase();
  return ALLOWED_PROVIDERS.has(value) ? value : 'system';
}

function safeEventType(eventType) {
  const value = String(eventType || '').trim().toLowerCase();
  return ALLOWED_EVENT_TYPES.has(value) ? value : null;
}

function isLaunchVerificationAdminRow(row = {}) {
  if (row?.is_admin) return true;
  const email = String(row?.email || '').trim().toLowerCase();
  return !!email && ADMIN_EMAILS.includes(email);
}

export async function isLaunchVerificationAdmin(userId) {
  if (!supabaseAdmin || !userId) return false;

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('is_admin,email')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return isLaunchVerificationAdminRow(data);
}

export async function recordLaunchVerificationEvent({
  eventType,
  provider = 'system',
  status = 'pass',
  userId = null,
  metadata = {}
} = {}) {
  if (!supabaseAdmin) return null;

  const safeType = safeEventType(eventType);
  if (!safeType) return null;

  const row = {
    event_type: safeType,
    provider: safeProvider(provider),
    status: safeStatus(status),
    user_id: userId || null,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    created_at: new Date().toISOString()
  };

  const { error } = await supabaseAdmin.from('launch_verification_events').insert(row);
  if (error) {
    if (error.code === '42P01' || /does not exist/i.test(error.message || '')) {
      console.warn('[launch-verification] migration not applied; skipping proof event insert.');
      return null;
    }
    console.warn('[launch-verification] Could not store proof event:', error.message);
    return null;
  }

  return row;
}

function latestEventForCheck(events = [], check = {}) {
  const eventTypes = new Set(check.eventTypes || []);
  return [...events]
    .filter(row => eventTypes.has(String(row.event_type || '').trim().toLowerCase()))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0] || null;
}

export function summarizeLaunchVerificationEvents(events = []) {
  const recentEvents = [...events]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const checks = LAUNCH_VERIFICATION_CHECKS.map(check => {
    const latest = latestEventForCheck(recentEvents, check);
    return {
      key: check.key,
      label: check.label,
      provider: check.provider,
      event_types: check.eventTypes,
      status: latest?.status || 'blocked',
      created_at: latest?.created_at || null,
      metadata: latest?.metadata || {},
      event_type: latest?.event_type || null
    };
  });

  const counts = checks.reduce((acc, check) => {
    acc[check.status] = (acc[check.status] || 0) + 1;
    return acc;
  }, { pass: 0, fail: 0, blocked: 0 });

  return {
    checks,
    recentEvents,
    counts
  };
}

export async function loadLaunchVerificationDashboard(userId) {
  const admin = await isLaunchVerificationAdmin(userId);
  if (!admin) {
    const error = new Error('Admin access required.');
    error.status = 403;
    throw error;
  }

  const { data, error } = await supabaseAdmin
    .from('launch_verification_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  const summary = summarizeLaunchVerificationEvents(data || []);
  return {
    admin: true,
    ...summary
  };
}
