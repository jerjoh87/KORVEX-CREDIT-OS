const isProduction = process.env.NODE_ENV === 'production' || process.env.LAUNCH_MODE === 'production';
const env = process.env;
const appUrl = safeValue('APP_URL');

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
  if (!raw) return requireKey('ALLOWED_ORIGINS');

  const origins = raw.split(',').map(v => v.trim()).filter(Boolean);
  if (!origins.length) {
    report(isProduction ? 'fail' : 'blocked', 'ALLOWED_ORIGINS is empty');
    return false;
  }

  let ok = true;
  for (const origin of origins) {
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

console.log(`CREDITOS env validation (${isProduction ? 'production' : 'local'} mode)`);

let failed = false;

failed = !requireKey('APP_URL', 'APP_URL') || failed;
failed = !validateUrl('APP_URL', 'APP_URL') || failed;
failed = !validateOrigins() || failed;

failed = !requireKey('SUPABASE_URL', 'SUPABASE_URL') || failed;
failed = !validateUrl('SUPABASE_URL', 'SUPABASE_URL') || failed;
failed = !requireKey('SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY') || failed;
failed = !requireKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY') || failed;

failed = !requireKey('GEMINI_API_KEY', 'GEMINI_API_KEY') || failed;
failed = !optionalKey('GEMINI_MODEL', 'GEMINI_MODEL') || failed;
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

report('pass', appUrl ? `Auth redirect: ${appUrl}/app.html` : 'Auth redirect: not available until APP_URL is set');
report('pass', appUrl ? `Stripe success redirect: ${appUrl}/app.html?checkout=success` : 'Stripe success redirect: not available until APP_URL is set');
report('pass', appUrl ? `Stripe cancel redirect: ${appUrl}/app.html?checkout=cancelled` : 'Stripe cancel redirect: not available until APP_URL is set');
report('na', 'OCR/scanner provider key: browser-based OCR is used in the current build');
report('na', 'PDF generation provider key: browser-based PDF export is used in the current build');

if (failed && isProduction) {
  process.exitCode = 1;
} else if (failed && !isProduction) {
  process.exitCode = 0;
}
