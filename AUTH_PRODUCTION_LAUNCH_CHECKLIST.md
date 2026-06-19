# CREDITOS Supabase Auth Production Launch Checklist

Use this only for the live production launch pass.

## Required Supabase dashboard settings

- Site URL: set to your production app origin
- Redirect allow-list: include the production app redirect below
- Email confirmation: enabled
- Password recovery redirect target: `APP_URL/app.html`
- Approved production domain: your real production domain only

Production redirect target:

- `APP_URL/app.html`

## Required environment variables

Set these in `.env.local` for local work or in your hosting provider’s environment settings for production. Never paste the values into chat.

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_URL`
- `ALLOWED_ORIGINS`

## Exact live test order

1. Signup verification
2. Magic-link sign-in
3. Password recovery
4. Logout
5. Expired / invalid / reused auth link handling
6. Session expiry behavior

## Pass / Fail / Blocked table

Legend:

- PASS = verified working live
- FAIL = broken in live environment
- BLOCKED = missing credential, inbox, or Supabase dashboard setting

| Check | Status | Notes |
|---|---|---|
| Signup verification | BLOCKED | Needs live Supabase Auth settings and a real inbox. |
| Magic-link sign-in | BLOCKED | Needs live Supabase Auth settings and a real inbox. |
| Password recovery | BLOCKED | Needs production recovery redirects and a real inbox. |
| Logout | PASS when confirmed | Should remove session and keep local device progress available. |
| Expired / invalid / reused link handling | PASS when confirmed | Must show a friendly retry message. |
| Session expiry behavior | PASS when confirmed | Should show a friendly message and not break the app. |

## Manual evidence checklist

- Screenshot of Supabase URL settings
- Screenshot of signed-in dashboard
- Screenshot of verification redirect
- Screenshot of password recovery state
- Screenshot of friendly expired-link message

## Secret safety notes

- Never paste keys into chat.
- Never commit `.env.local`.
- Rotate any exposed service role key.
- Keep the service role key server-only.
- Confirm no secrets appear in logs, screenshots, docs, or commits.

## Live test notes

- The app is already verified locally.
- `npm run launch:check` passes locally.
- Missing Supabase config fails cleanly locally.
- If a live credential or dashboard setting is missing, mark it BLOCKED, not FAIL.
