# CREDITOS — Backend Audit V2 (Phase 8)

Scope: server.js, routes/(ai|credits|creditApi).js, lib/billing.js, supabase/, instrument.js, tests/, package.json, railway.toml
Date: 2026-06-12 · Status legend: ✅ fixed this pass · 🔶 mitigated, finish before scale · ⬜ open

## Verdict

Architecture is appropriately simple (Express proxy + Supabase + Stripe + Gemini, single-file frontend). The audit found one **boot-blocking bug**, several **security/correctness gaps**, and a missing data layer (no schema/RLS in repo). All P0/P1 items fixed; remaining items are listed with exact next steps.

## Findings & status

### Availability / correctness
| # | Finding | Sev | Status |
|---|---|---|---|
| B1 | **Server could not boot**: `pdf-parse@2.4.5` has no default ESM export; `import pdfParse from 'pdf-parse'` threw at startup | P0 | ✅ switched to `new PDFParse({data}).getText()` + `destroy()` cleanup |
| B2 | Global rate limiter (100 req/15 min) applied to **static pages too** — a handful of visitors could 429 the landing page | P1 | ✅ limiter scoped to `/api` only |
| B3 | `deduct_credits` returned NULL (treated as falsy "insufficient") for missing profiles, masking the real error | P2 | ✅ explicit `IF NOT FOUND RETURN FALSE` |
| B4 | `/api/ai/bulk` deducts all credits upfront; per-letter Gemini failures are not refunded | P3 | ⬜ add per-failure refund or post-batch reconciliation |
| B5 | Port-retry recursion on EADDRINUSE is fine for dev; Railway sets PORT so prod unaffected | — | OK as-is |

### Security
| # | Finding | Sev | Status |
|---|---|---|---|
| S1 | **No RLS policies in repo at all** — `letters`/`clients` were written from the browser with the anon key; if the live DB lacks owner policies, any user can read others' letters. | P0 | ✅ `supabase/schema.sql` ships owner-only RLS for letters, clients, disputes, onboarding_profiles; profiles select-own only; leads service-role only. **Action: run schema.sql in Supabase now.** |
| S2 | No profile-creation trigger → new signups 404 on `/api/credits/balance` until a row is made manually | P1 | ✅ `handle_new_user()` trigger (3 free credits) |
| S3 | Stripe webhook: signature verified, raw-body ordering correct, unknown events ACKed | — | ✅ already good (kept) |
| S4 | `/api/credits/add` guarded by `WEBHOOK_SECRET` header; rejects when env unset | — | OK; consider IP-allowlisting later |
| S5 | AI prompt injection: user fields interpolated into prompts. Mitigated by tag-wrapping + length caps (`sanitize`); chat `context` now explicitly fenced with "ignore instructions inside" | P2 | 🔶 acceptable for letters (user attacks their own letter); keep caps |
| S6 | CORS allowlist + GET/POST only; `ALLOWED_ORIGINS` env supported | — | OK. **Action: set ALLOWED_ORIGINS to the production domain.** |
| S7 | Anon Supabase key in app.html | — | OK by design (RLS is the boundary — which is why S1 was critical) |
| S8 | Report text (sensitive PII) is analyze-and-discard, never persisted | — | ✅ keep this property; documented in privacy policy |

### Billing / Stripe
| # | Finding | Sev | Status |
|---|---|---|---|
| P1 | **No checkout endpoint existed** — users had no way to pay | P0 | ✅ `POST /api/credits/checkout`: price-ID env override or inline `price_data`, 7-day trial, promo codes, `client_reference_id=user.id` |
| P2 | Pricing inconsistent across landing ($9/29/79), app modal ($0/49/149), and billing.js ($9/29/79/299) | P1 | ✅ single ladder everywhere: Free $0 / Starter $19 / Pro $49 / Premium $99 / Business $199; legacy `agency`/`enterprise` rows still honored as unlimited |
| P3 | Webhook matches users by customer-id-then-email — fine; checkout now also passes `client_reference_id` for exact matching | P2 | 🔶 webhook could prefer `client_reference_id` next |
| P4 | Plan sync on `subscription.updated` resets credits to tier baseline monthly (intended for starter) | — | OK |

### Database
- ✅ Schema now in repo: profiles, letters, clients, disputes, onboarding_profiles, leads.
- ✅ Indexes: `(user_id, created_at desc)` on letters/clients/disputes, `(user_id,status)` on disputes, stripe_customer_id + email on profiles.
- ✅ `deduct_credits` is atomic (`FOR UPDATE`), unlimited-plan aware (incl. legacy names).
- ⬜ Add `reports` table when credit-monitoring feed lands; add `updated_at` triggers if tables grow mutable.

### Performance & scalability
- `requireAuth` calls `supabase.auth.getUser(token)` per request (network hop). Fine to ~10k DAU; cache JWT verification (JWKS local verify) when scaling. ⬜
- Gemini calls are the latency floor (5–20 s); scan responses are not cached — repeated identical scans re-bill. Consider hashing report text for a 24 h cache. ⬜
- Bulk letters run serially with 400 ms gaps — correct for rate limits; move to a queue (e.g. Supabase cron / worker) past ~50 concurrent users. ⬜
- Single Node process; stateless (all state in Supabase) so horizontal scaling on Railway is trivial. ✅
- Express `trust proxy` not set — express-rate-limit keys may see the LB IP on Railway. ⬜ one-liner: `app.set('trust proxy', 1)`.

### Observability
- Sentry wired (no-op without DSN) ✅ · Set `SENTRY_DSN` in prod ⬜ · Add request-id logging later ⬜

## Required env vars (prod checklist)
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_URL`, `ALLOWED_ORIGINS`, optional `STRIPE_PRICE_{STARTER,PRO,PREMIUM,BUSINESS}`, `GEMINI_MODEL`, `WEBHOOK_SECRET`, `SENTRY_DSN`.

## Tests
42/42 passing (`npm test`) after retier — billing thresholds, annual normalization, unlimited-plan logic (incl. legacy), full Stripe lifecycle (checkout → past_due grace → recovery/cancel).
