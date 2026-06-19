# CREDITOS Auth Live QA

Run this with real Supabase Auth settings and a real email inbox.

## Where to add env values

- Local dev: put Supabase settings in `.env.local`
- Hosting: add the same values in your provider’s environment settings
- Never commit `.env.local`

## Simple launch board

Legend:

- done = implemented and verified locally
- blocked by credentials = needs real live keys / inbox access
- blocked by schema/config = needs production auth settings or redirect URLs

| Area | Status | Notes |
|---|---|---|
| Magic-link sign-in | blocked by credentials | Needs a real Supabase auth setup and a test inbox. |
| Password recovery | blocked by credentials | Needs a real inbox plus production recovery redirects. |
| Signup verification redirect | blocked by schema/config | Requires production Site URL / redirect allow-list. |
| Friendly auth errors | done | Invalid/expired links already fail cleanly in the app. |

## Exact live test flow

1. Set `APP_URL` to your production app URL.
2. In Supabase Auth, add these redirect URLs:
   - `APP_URL/app.html`
3. Open the app and sign up with a real test inbox.
4. Open the verification email and confirm the user lands on `APP_URL/app.html`.
5. Log out, then request a magic link and confirm it returns to `APP_URL/app.html`.
6. Trigger password recovery and confirm recovery mode opens and accepts a new password.
7. Open an expired or reused link and confirm the app shows a friendly retry message.
8. Sign out again, then sign back in and confirm the session restores cleanly.

## Live credential checks

- [ ] PASS - Supabase magic-link sign-in returns to `APP_URL/app.html`.
- [ ] PASS - Supabase password recovery opens recovery mode and accepts a new password.
- [ ] PASS - Signup verification returns the user to the app without a localhost redirect.
- [ ] PASS - Invalid, expired, or already-used auth links show a friendly retry message.
- [ ] BLOCKED - live Supabase auth credentials or test inbox are not available yet.

## Flows to test

- [ ] Signup creates a new account and sends a verification email.
- [ ] Verification link returns the user to `APP_URL/app.html`.
- [ ] Login returns the user to the app without a broken localhost redirect.
- [ ] Magic-link login opens the app and signs the user in.
- [ ] Password reset opens recovery mode and allows setting a new password.
- [ ] Session expiry shows a friendly message and does not break the app.
- [ ] Logout keeps local device progress available while removing the session.

## Error cases

- [ ] Expired auth link shows a friendly retry message.
- [ ] Already-used auth link shows a friendly retry message.
- [ ] Invalid auth link shows a friendly retry message.
- [ ] Missing auth config fails cleanly in local dev.

## Manual evidence to capture

- [ ] Screenshot of the verification or magic-link landing state.
- [ ] Screenshot of the password recovery state.
- [ ] Screenshot of the friendly expired-link message.
- [ ] Screenshot of the signed-in dashboard after redirect.
