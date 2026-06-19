# CREDITOS — UX Scorecard (Phase 1 Audit)

Audited: app.html (member app), index.html (landing), privacy.html, terms.html
Date: 2026-06-12 · Auditors: Product / UX / UI / Frontend roles

Scoring: 1–10. Anything below 9 has a fix listed in LAUNCH_READINESS_REPORT.md.

| Area | Score (before) | Score (after fixes) | Notes |
|---|---|---|---|
| Navigation | 4 | 8 | 15 nav items across 4 groups for a consumer app; agency tools (CRM, White-Label, Vendors) mixed with consumer tools. Fixed: consumer-first nav, agency tools grouped + gated. |
| Information architecture | 4 | 8 | "Fix My Credit" vs "Dispute Timeline" vs "Analyze My Report" split one job across 3 pages with no flow between them. Fixed: Scanner → Disputes pipeline. |
| User flows | 3 | 8 | No path from scan results → letter → dispute tracking. Scan results were render-only (lost on refresh). Fixed: scan persists, "Create dispute" buttons, tracked disputes. |
| Onboarding | 2 | 9 | "Guided Setup" was 3 static cards, not onboarding. No goal capture, no personalization. Fixed: 8-step wizard < 5 min, generates Blueprint (health score, readiness, 30/90/180 plans). |
| Mobile experience | 3 | 8 | **P0: Sign In button was `display:none` under 760px** — mobile users could not authenticate at all. Hamburger menu worked, but primary CTAs hidden. Fixed. |
| Desktop experience | 6 | 9 | Layout was solid but dark "neon SaaS" theme reads gamer, not fintech. Replaced with light premium theme (Ramp/Mercury style). |
| Loading states | 6 | 8 | Scanner/roadmap had spinners; chat had "..."; dashboard metrics showed "—" forever when logged out. Fixed with explicit signed-out states. |
| Empty states | 5 | 8 | CRM and letter history had empty states; dashboard, disputes, wins did not (showed fake data instead). Fixed. |
| Error states | 6 | 8 | Scanner/roadmap had real error cards; 402 → upgrade CTA worked. Letter SSE errors dumped raw text. Improved messaging. |
| Conversion points | 2 | 8 | **Upgrade modal buttons did nothing** (no Stripe checkout existed anywhere). Landing quiz collected email into a dead `<input>`. Fixed: /api/credits/checkout + /api/leads. |
| Trust & credibility | 3 | 8 | Fake data presented as real ("Collection deleted 2h ago", hardcoded "PRO ACTIVE", fake revenue). No security/compliance messaging. Fixed: demo data removed or labeled, CROA/FCRA notices, encryption microcopy. |
| Copy & comprehension (teen test) | 5 | 9 | "Metro 2 Inaccuracy", "FCRA Validation", "Paydex" unexplained. Fixed: plain-English labels + tooltips ("What's this?"). |

## Critical bugs found (would have shipped broken)

1. **`updateAuthUI` infinite recursion (P0).** app.html declared `function updateAuthUI` twice; the second wrapper captured *itself* via `const _origAuthChange = updateAuthUI` (function declarations hoist — the later one wins before that line runs). Every sign-in/sign-out → `RangeError: Maximum call stack size exceeded`. Dashboard metrics, CRM, and letter history never loaded.
2. **`generateLetter` same recursion pattern (P0).** `const _origGenerateLetter = generateLetter` captured the new declaration → "Generate Letter" looped forever.
3. **Mobile auth lockout (P0).** `@media(max-width:760px){.topActions .primary,.topActions .ghost{display:none}}` hid Sign In, Analyze, and Home on phones.
4. **TXT upload path never updated the credit balance badge** (`credits_remaining` ignored), so users saw stale credit counts after paid scans.
5. **Scanner double-charged latency**: `runCreditAnalysis` POSTed the same text to `/api/upload-credit-report` then `/api/analyze-credit` — the first call was pure waste.

## Unnecessary clicks / friction removed

- Scan → dispute letter previously required re-typing creditor/bureau into a separate form. Now one click from a scan finding.
- Sign-in required before user sees any value; landing quiz answers were discarded. Now answers persist into onboarding.
- Letter copy used `alert()` (blocking). Replaced with inline toast.

## Drop-off risk map (before fixes)

1. Landing quiz → app: email field went nowhere (100% lead loss).
2. Sign-up → first value: no onboarding, user lands on dashboard full of someone else's fake data.
3. First scan → action: results disappeared on refresh; no "what next".
4. Upgrade intent → payment: modal buttons dead. (Direct revenue loss.)
5. Mobile visitor → anything: could not sign in.
