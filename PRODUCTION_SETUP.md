# CREDITOS Production Setup

This is the launch wiring guide for the current Express + Supabase + Stripe setup.

## Where to put env values

- Local dev: `.env.local`
- Production hosting: your provider’s environment settings
- Never commit `.env.local`

## What goes where

### Server-only

Set these only on the backend host:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `WEBHOOK_SECRET`
- `SENTRY_DSN`

These must never be exposed in the browser.

### Public client-safe

These can be shipped to the browser or embedded in the client:

- `SUPABASE_ANON_KEY`
- `APP_URL`
- `APP_BASE_URL`
- `ALLOWED_ORIGINS`
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_PRO`
- `STRIPE_PRICE_PREMIUM`
- `STRIPE_PRICE_BUSINESS`

The anon key is public by design. The service-role key is not.

Note: the current static client already embeds the Supabase anon key in `app.html`. That is acceptable because the anon key is meant to be public and RLS is the real security boundary.

## Required environment variables

Set these before launch:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `APP_BASE_URL` (preferred) or legacy `APP_URL`
- `ALLOWED_ORIGINS`

Optional, depending on deployment:

- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_PRO`
- `STRIPE_PRICE_PREMIUM`
- `STRIPE_PRICE_BUSINESS`
- `STRIPE_PREMIUM_PRICE_ID`
- `STRIPE_TRIAL_ACTIVATION_PRICE_ID`
- `GEMINI_MODEL`
- `SENTRY_DSN`
- `WEBHOOK_SECRET`
- `BUREAU_RESPONSE_BUCKET` (defaults to `bureau-responses`)

## Railway

Add the server-only values above to Railway environment variables.

- `APP_BASE_URL` should be the public production URL, for example `https://app.yourdomain.com`. `APP_URL` remains supported as a fallback.
- `ALLOWED_ORIGINS` should include only the production app domain and any trusted local dev hosts.
- `SENTRY_DSN` is optional, but if used it must be the production DSN.

Restart the service after changing env vars.

## Netlify

If you host the marketing site or static assets on Netlify:

- Put the public client-safe values in the site environment settings if the build needs them:
  - `SUPABASE_ANON_KEY`
  - `APP_URL`
  - `ALLOWED_ORIGINS`
  - any `STRIPE_PRICE_*` values used by the client
- Keep server-only secrets out of any frontend-only bundle.
- Make sure any frontend redirect links use the production `APP_URL`, not a localhost URL.

## Supabase

In the Supabase dashboard:

- Set the Auth site URL to the production app URL.
- Add production redirect URLs that return users to the app after email verification, magic-link login, and password reset.
- Confirm email auth is allowed for the beta flow you want to test.
- Confirm RLS is enabled and the schema/migrations are applied.

Recommended redirect allow-list entries:

- `https://app.yourdomain.com/app.html`
- `https://app.yourdomain.com/app.html?checkout=success`
- `https://app.yourdomain.com/app.html?checkout=cancelled`

## Stripe

In Stripe:

- Set the webhook endpoint to `POST /api/credits/stripe` on the production backend.
- Copy the live webhook signing secret into `STRIPE_WEBHOOK_SECRET`.
- Optional: create a recurring $99/month Premium Price and set its ID as `STRIPE_PREMIUM_PRICE_ID` or `STRIPE_PRICE_PREMIUM`. If omitted, Checkout uses inline recurring price data.
- Optional: create a one-time $1 activation Price and set its ID as `STRIPE_TRIAL_ACTIVATION_PRICE_ID`. If omitted, Checkout uses inline one-time price data.
- Enable and configure the Stripe Customer Portal so users can cancel or update payment details themselves.
- If you use saved Price IDs, set the matching `STRIPE_PRICE_*` values.
- Confirm Checkout success and cancel URLs point to the production app.

## Redirect URLs

The app sends auth users back to `APP_BASE_URL/app.html` (or legacy `APP_URL/app.html`).

Use these as your baseline:

- Signup verification: `https://app.yourdomain.com/app.html`
- Magic-link login: `https://app.yourdomain.com/app.html`
- Password reset: `https://app.yourdomain.com/app.html`
- Checkout success: `https://app.yourdomain.com/app.html?checkout=success`
- Checkout cancel: `https://app.yourdomain.com/app.html?checkout=cancelled`

If your final domain differs, update the same pattern everywhere.

## Production checklist

- [ ] Backend env vars are set on the server host.
- [ ] Public client values are not being used as secrets.
- [ ] Supabase Auth redirects point at the production domain.
- [ ] Stripe webhook is live and signing secret is current.
- [ ] `ALLOWED_ORIGINS` contains the production origin.
- [ ] `APP_URL` is not localhost.
- [ ] `APP_BASE_URL` is the canonical production origin.
- [ ] Premium Checkout has either saved Price IDs configured or inline price-data fallback verified.
- [ ] Migration `20260621090000_premium_response_workflow.sql` is applied.
- [ ] The app works with a fresh auth session, expired session, and password reset.
