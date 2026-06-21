// ─────────────────────────────────────────────
//  CREDITOS — Sentry instrumentation
//  instrument.js
//
//  Must be the first import in server.js so Sentry can
//  instrument all subsequently-loaded modules.
//
//  When SENTRY_DSN is not set this file is a true no-op:
//  @sentry/node is never imported, so its OpenTelemetry
//  auto-instrumentation can't crash the serverless cold start.
// ─────────────────────────────────────────────

let Sentry = null;

if (process.env.SENTRY_DSN) {
  // Imported lazily and awaited so the default export below is the real,
  // initialised Sentry object. A plain `export default <reassigned let>`
  // would capture the initial null and never see the reassignment.
  const mod = await import('@sentry/node');
  Sentry = mod.default ?? mod;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.1,
    integrations: [Sentry.expressIntegration()],
  });

  console.log(`[sentry] Initialised (env: ${process.env.NODE_ENV || 'production'})`);
} else {
  console.log('[sentry] SENTRY_DSN not set — error reporting disabled.');
}

export default Sentry;
