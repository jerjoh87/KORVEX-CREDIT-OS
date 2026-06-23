const isProduction = process.env.NODE_ENV === 'production' || process.env.LAUNCH_MODE === 'production';
const env = process.env;
const appUrl = safeValue('APP_BASE_URL') || safeValue('APP_URL');

function hasValue(name) {
  return String(env[name] || '').trim().length > 0;
}

function safeValue(name) {
  return String(env[name] || '').trim();
}

function report(status, message) {
  console.log(`[${status}] ${message}`);
}

function requireKey(name, label = name) {
  if (hasValue(name)) {
    report('pass', `${label} is set`);
    return true;
  }

  report('blocked', `${label} is not set`);
  return false;
}

function optionalKey(name, label = name) {
  if (hasValue(name)) {
    report('pass', `${label} is set`);
    return true;
  }
  report('na', `${label} is not set (optional)`);
  return false;
}

function validateUrl(name, label = name) {
  const value = safeValue(name);
  if (!value) return false;

  try {
    new URL(value);
    report('pass', `${label} is a valid URL`);
    return true;
  } catch {
    report(isProduction ? 'fail' : 'blocked', `${label} is not a valid URL`);
    return false;
  }
}

function validateOrigins() {
  const raw = safeValue('ALLOWED_ORIGINS');
  const origins = raw ? raw.split(',').map(v => v.trim()).filter(Boolean) : [];
  const appOrigins = [safeValue('APP_BASE_URL'), safeValue('APP_URL')].filter(Boolean);
  const combined = [...new Set([...origins, ...appOrigins])];

  if (!combined.length) return requireKey('ALLOWED_ORIGINS');

  if (!raw && appOrigins.length) {
    report('na', 'ALLOWED_ORIGINS is not set; APP_BASE_URL / APP_URL will be used for same-origin requests');
  }

  if (!combined.length) {
    report(isProduction ? 'fail' : 'blocked', 'ALLOWED_ORIGINS is empty');
    return false;
  }

  let ok = true;
  for (const origin of combined) {
    try {
      new URL(origin);
      report('pass', `Allowed origin configured: ${origin}`);
    } catch {
      ok = false;
      report(isProduction ? 'fail' : 'blocked', `Allowed origin is invalid: ${origin}`);
    }
  }
  return ok;
}

function validatePriceId(name) {
  const value = safeValue(name);
  if (!value) {
    report('na', `${name} not set (fallback price_data will be used)`);
    return true;
  }
  if (/^price_[A-Za-z0-9]+$/.test(value)) {
    report('pass', `${name} looks valid`);
    return true;
  }
  report(isProduction ? 'fail' : 'blocked', `${name} does not look like a Stripe Price ID`);
  return false;
}

function boolEnv(name) {
  return ['1', 'true', 'yes', 'on'].includes(safeValue(name).toLowerCase());
}

function validateTemporaryAdminSafety() {
  const enabled = boolEnv('TEST_ADMIN_MODE') || boolEnv('TEMP_ADMIN_LOGIN_ENABLED');
  if (!enabled) {
    report('pass', 'Temporary admin login is disabled');
    return true;
  }

  if (!isProduction) {
    report('na', 'Temporary admin login is enabled for local testing');
    return true;
  }

  report('fail', 'Temporary admin login is enabled in production; disable before public launch');
  return false;
}

console.log(`CREDITOS env validation (${isProduction ? 'production' : 'local'} mode)`);

let failed = false;
failed = !validateTemporaryAdminSafety() || failed;

if (hasValue('APP_BASE_URL')) {
  failed = !validateUrl('APP_BASE_URL', 'APP_BASE_URL') || failed;
} else {
  failed = !requireKey('APP_URL', 'APP_BASE_URL or legacy APP_URL') || failed;
  failed = !validateUrl('APP_URL', 'APP_URL') || failed;
}
failed = !validateOrigins() || failed;

failed = !requireKey('SUPABASE_URL', 'SUPABASE_URL') || failed;
failed = !validateUrl('SUPABASE_URL', 'SUPABASE_URL') || failed;
failed = !requireKey('SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY') || failed;
failed = !requireKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY') || failed;

failed = !requireKey('GEMINI_API_KEY', 'GEMINI_API_KEY') || failed;
failed = !optionalKey('GEMINI_MODEL', 'GEMINI_MODEL') || failed;
const googleOcrConfigured = hasValue('GOOGLE_SERVICE_ACCOUNT_JSON') || hasValue('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64');
if (googleOcrConfigured || hasValue('GOOGLE_DOCUMENT_AI_PROCESSOR_ID') || hasValue('GOOGLE_CLOUD_PROJECT_ID')) {
  failed = !requireKey('GOOGLE_CLOUD_PROJECT_ID', 'GOOGLE_CLOUD_PROJECT_ID') || failed;
  failed = !optionalKey('GOOGLE_CLOUD_LOCATION', 'GOOGLE_CLOUD_LOCATION') || failed;
  failed = !requireKey('GOOGLE_DOCUMENT_AI_PROCESSOR_ID', 'GOOGLE_DOCUMENT_AI_PROCESSOR_ID') || failed;
  failed = !optionalKey('GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION', 'GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION') || failed;
  if (googleOcrConfigured) report('pass', 'Google service account credentials are set');
  else {
    report('blocked', 'GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not set');
    failed = true;
  }
  failed = !optionalKey('GOOGLE_VISION_OCR_ENABLED', 'GOOGLE_VISION_OCR_ENABLED') || failed;
} else {
  report('na', 'Google Document AI OCR is not configured (optional)');
}
failed = !requireKey('STRIPE_SECRET_KEY', 'STRIPE_SECRET_KEY') || failed;
failed = !requireKey('STRIPE_WEBHOOK_SECRET', 'STRIPE_WEBHOOK_SECRET') || failed;
failed = !requireKey('CLICK2MAIL_USERNAME', 'CLICK2MAIL_USERNAME') || failed;
failed = !requireKey('CLICK2MAIL_PASSWORD', 'CLICK2MAIL_PASSWORD') || failed;
failed = !optionalKey('CLICK2MAIL_BASE_URL', 'CLICK2MAIL_BASE_URL') || failed;

failed = !optionalKey('SENTRY_DSN', 'SENTRY_DSN') || failed;
failed = !optionalKey('WEBHOOK_SECRET', 'WEBHOOK_SECRET') || failed;
failed = !validatePriceId('STRIPE_PRICE_STARTER') || failed;
failed = !validatePriceId('STRIPE_PRICE_PRO') || failed;
failed = !validatePriceId('STRIPE_PRICE_PREMIUM') || failed;
failed = !validatePriceId('STRIPE_PRICE_BUSINESS') || failed;
failed = !validatePriceId('STRIPE_PREMIUM_PRICE_ID') || failed;
failed = !validatePriceId('STRIPE_TRIAL_ACTIVATION_PRICE_ID') || failed;

report('pass', appUrl ? `Auth redirect: ${appUrl}/app.html` : 'Auth redirect: not available until APP_URL is set');
report('pass', appUrl ? `Stripe success redirect: ${appUrl}/app.html?checkout=success` : 'Stripe success redirect: not available until APP_URL is set');
report('pass', appUrl ? `Stripe cancel redirect: ${appUrl}/app.html?checkout=cancelled` : 'Stripe cancel redirect: not available until APP_URL is set');
report(googleOcrConfigured ? 'pass' : 'na', googleOcrConfigured ? 'OCR/scanner provider: Google OCR configured with browser fallback' : 'OCR/scanner provider key: browser-based OCR is used until Google OCR is configured');
report('na', 'PDF generation provider key: browser-based PDF export is used in the current build');

if (failed && isProduction) {
  process.exitCode = 1;
} else if (failed && !isProduction) {
  process.exitCode = 0;
}
