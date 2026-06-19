// ─────────────────────────────────────────────
//  ContentEmpire AI — Sentry instrumentation
//  instrument.js
//
//  Must be the first import in server.js so Sentry
//  can instrument all subsequent modules.
//
//  If SENTRY_DSN is not set, this file is a no-op.
//  Run once after adding the DSN:
//    npm install   (adds @sentry/node)
// ─────────────────────────────────────────────
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,

    // Tag every event with the environment so prod/staging stay separate
    environment: process.env.NODE_ENV || 'production',

    // Capture 10 % of transactions for performance monitoring — raise if needed
    tracesSampleRate: 0.1,

    // Attach request data (URL, method, headers) to every error automatically
    integrations: [
      Sentry.expressIntegration(),
    ],
  });

  console.log(`[sentry] Initialised (env: ${process.env.NODE_ENV || 'production'})`);
} else {
  console.log('[sentry] SENTRY_DSN not set — error reporting disabled.');
}

export default Sentry;
