# CREDITOS Premium Response Workflow Report

## What was added

- A one-time $1 Premium activation charge with seven days of Premium access, followed by the existing $99/month Premium subscription unless canceled before renewal.
- Exact trial and next-billing dates in the offer modal, account settings, Stripe Checkout disclosure, and webhook-synced profile state.
- One introductory Premium trial per user account.
- Stripe Customer Portal access for self-service cancellation, payment-method updates, and billing management.
- Premium-only bureau response upload for PDF, PNG, JPG, and TXT files up to 10 MB.
- Private Supabase Storage for uploaded bureau responses.
- AI extraction and classification for bureau, response date, account results, bureau explanation, confidence, next action, next letter type, and missing evidence.
- Account response categories: deleted, updated, verified, unchanged, frivolous/irrelevant, needs more information, no investigation, mixed result, and unclear.
- Editable next-round letters, saved letter history, TXT/PDF download, and no-response follow-up generation.
- Dispute rounds anchored to certified-mail delivery date when available, otherwise sent date.
- Day 21, 30, 38, and 45 in-app alerts, plus analysis-ready, next-letter-ready, and trial-ending alerts.
- A mobile-responsive Bureau Response Center with upload, results, letter builder, timeline, alert center, and response history.

## Files changed

- Billing and entitlement: `lib/billing.js`, `routes/credits.js`, `routes/mailing.js`
- Response intelligence: `lib/bureau-response.js`, `lib/gemini.js`, `routes/responses.js`
- App wiring and UI: `server.js`, `public/app.html`
- Database: `supabase/schema.sql`, `supabase/migrations/20260621090000_premium_response_workflow.sql`
- Tests/checks: `tests/premium-response.test.js`, `scripts/typecheck.mjs`
- Setup: `.env.example`, `PRODUCTION_SETUP.md`, `STRIPE_LIVE_QA.md`, `package.json`, `package-lock.json`

## New environment variables

- `APP_BASE_URL` — preferred canonical app origin; legacy `APP_URL` remains supported.
- `STRIPE_PREMIUM_PRICE_ID` — optional recurring Premium monthly Price; Checkout falls back to inline recurring price data.
- `STRIPE_TRIAL_ACTIVATION_PRICE_ID` — optional one-time $1 activation Price; Checkout falls back to inline one-time price data.
- `BUREAU_RESPONSE_BUCKET` — optional private bucket name; defaults to `bureau-responses`.

Existing required Stripe values remain `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.

## New database objects

- Profile fields: `stripe_subscription_id`, `subscription_status`, `trial_started_at`, `trial_ends_at`, `next_bill_at`, `canceled_at`.
- Tables: `premium_trials`, `bureau_responses`, `dispute_rounds`, `deadline_alerts`, `stripe_webhook_events`.
- Private Storage bucket: `bureau-responses`.
- Owner-only read policies for Premium workflow data; all mutations go through the authenticated backend and service role after entitlement checks.

Production status: `supabase/migrations/20260621090000_premium_response_workflow.sql` was applied to the linked `contentempire` Supabase project on June 21, 2026. The five new tables and private `bureau-responses` bucket were verified afterward.

Deployment status: deployed to Vercel production on June 21, 2026 at `https://korvex-credit-os.vercel.app`. Runtime verification reported Supabase, Stripe, Click2Mail, and Gemini connected. The shipped app page includes the Bureau Response Center and `$1` Premium trial copy; the response dashboard API is present and requires authentication.

## Stripe setup steps

1. Optional: create a recurring $99/month Premium product Price and set `STRIPE_PREMIUM_PRICE_ID` or `STRIPE_PRICE_PREMIUM`. If omitted, Checkout uses inline recurring price data.
2. Optional: create a one-time $1 activation Price and set `STRIPE_TRIAL_ACTIVATION_PRICE_ID`. If omitted, Checkout uses inline one-time price data.
3. Configure the Customer Portal for cancellation and payment-method updates.
4. Point the webhook at `POST /api/credits/stripe` and subscribe to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.trial_will_end`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
5. Set `STRIPE_WEBHOOK_SECRET`, `APP_BASE_URL`, and the production allowed origin.
6. Run a Stripe test-clock or test-mode trial through activation, reminder, renewal, payment failure, cancellation-at-period-end, and deletion.

## Manual test checklist

- [ ] A signed-in first-time user sees $1 today, seven days, the exact renewal date, and $99/month before Checkout.
- [ ] Checkout charges only $1 today, collects a payment method, and creates a trialing Premium subscription.
- [ ] The $1 invoice unlocks Premium rather than being mapped to Starter.
- [ ] A second introductory-trial attempt for the same user is blocked.
- [ ] Customer Portal cancellation preserves access while Stripe still reports an active/trialing period, then closes it on deletion/unpaid status.
- [ ] PDF, PNG, JPG, and TXT response files upload; unsupported or files over 10 MB are rejected.
- [ ] Auto-detected bureau and account results can be reviewed against the original response.
- [ ] Deleted items do not automatically produce another letter; other categories recommend the expected letter type.
- [ ] Generated letters are editable, saved, and downloadable.
- [ ] Delivery date overrides sent date as the Day 0 anchor.
- [ ] Day 21, 30, 38, and 45 dates are correct across month boundaries.
- [ ] Day 45 can generate a no-response follow-up.
- [ ] Mobile upload, analysis, billing disclosure, timeline, and alerts have no horizontal overflow.

## Webhook events tested

- Automated tests cover Premium entitlement, the $1 metadata classification guard, subscription date normalization, response-category normalization, and 30/45-day alert calculations.
- Existing automated lifecycle tests cover active/trialing sync, past-due grace behavior, invoice recovery, cancellation, and deletion.
- Signature verification and event-idempotency storage are implemented.
- Live Stripe delivery was not run locally because live/test Stripe and Supabase credentials were not present. Complete the checklist in `STRIPE_LIVE_QA.md` before launch.

## Known risks

- No email delivery provider exists in this repository, so this release schedules in-app alerts only. The data model is ready for a future email worker.
- Image-only responses require the configured Gemini service; searchable PDF/TXT files retain a lower-confidence deterministic fallback if Gemini is unavailable.
- The workflow stores sensitive credit correspondence. Production retention, deletion, access logging, and incident-response policies should be reviewed before launch.
- Trial and credit-services language should receive counsel review for CROA, state credit-services laws, automatic-renewal rules, and the final Stripe Checkout presentation.
- AI analysis can be wrong. The UI requires human review and avoids guaranteed results, but operational support should monitor misclassification patterns.

## Compliance notes

- The offer is described as access to self-service software tools, document storage, AI drafting, education, reminders, and Premium app features.
- The UI and generated-letter prompts do not promise score increases, deletions, or removal of accurate information.
- Billing copy shows $1 today, seven days, the exact next bill date, $99/month afterward, and cancellation timing.
- CREDITOS does not automatically file a dispute or mark an AI-detected deletion as confirmed; the user reviews the bureau response and draft before acting.
