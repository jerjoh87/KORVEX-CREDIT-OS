# CREDITOS Security Launch Checklist

Use this before inviting beta users. Keep the list short, boring, and explicit.

## Secrets and access

- [ ] Never paste live secrets into chat, tickets, docs, or screenshots.
- [ ] Revoke any secret that has already been pasted into chat.
- [ ] Confirm no real secrets are committed anywhere in the repo.
- [ ] Confirm `.env`, `.env.local`, `.env.production`, `.env.development`, `.env.test`, and other local env files stay untracked.
- [ ] Confirm `.env.example` contains placeholders only.
- [ ] Confirm the browser/client code never references `SUPABASE_SERVICE_ROLE_KEY` or any other server-only secret.
- [ ] Confirm only the Supabase anon key is used in client code, and that it is treated as public.
- [ ] Search the repo again before launch for:
  - `sk_live_`
  - `whsec_`
  - `sbp_`
  - `SERVICE_ROLE`
  - `GEMINI_API_KEY`
  - `SENTRY_DSN`

## Immediate rotation items

- [ ] Revoke the Supabase access token that was pasted into chat.
- [ ] Rotate any Supabase service-role key that may have been exposed during development.
- [ ] Rotate any Stripe secret or webhook secret that was ever shared outside the intended environment.
- [ ] Rotate any Gemini API key if it was copied into logs, screenshots, or shared notes.
- [ ] Rotate any Sentry DSN or internal webhook secret if either was exposed beyond the team.
- [ ] Confirm no secrets appear in console logs, commits, docs, or screenshots.

## Production safety checks

- [ ] Confirm `ALLOWED_ORIGINS` contains only the production domain(s) and trusted local dev hosts.
- [ ] Confirm `APP_URL` is the production app URL, not localhost.
- [ ] Confirm Supabase Auth site URL and redirect allow-list point to the production domain.
- [ ] Confirm Stripe webhook signing secret is set only on the server.
- [ ] Confirm the app still works when the server-side env vars are absent locally.
- [ ] Confirm uploaded report text is not logged in production.
- [ ] Confirm failed auth, failed AI requests, and failed webhook signatures return friendly errors without leaking secrets.

## Database and auth

- [ ] Confirm RLS is enabled on every user-owned table.
- [ ] Confirm user-owned tables only allow authenticated owner access.
- [ ] Confirm `deduct_credits` is not executable by `anon` or `authenticated`.
- [ ] Confirm Supabase Auth email links redirect back to the production app, not localhost.

## Stripe

- [ ] Confirm webhook signature verification is enabled.
- [ ] Confirm duplicate webhook events are ignored or idempotent.
- [ ] Confirm failed payments do not grant access or credits.
- [ ] Confirm checkout success and cancel URLs are production URLs.

## Final sign-off

- [ ] Run one final secret scan before launch.
- [ ] Re-test auth, Stripe, OCR, and PDF generation with real credentials.
- [ ] Save screenshots or notes for anything that failed so it can be fixed before opening beta.
