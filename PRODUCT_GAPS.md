# CREDITOS — Product Gaps (Phase 1 Audit)

Legend: ✅ shipped in this pass · 🔶 scaffolded (UI + data model ready, needs depth) · ⬜ recommended next

## Missing features (vs. modern fintech bar: Credit Karma / Rocket Money / Nav)

| Gap | Severity | Status |
|---|---|---|
| Onboarding wizard (goals → situation → income → blueprint) | Critical | ✅ 8-step wizard, < 5 min, generates AI Financial Blueprint |
| Credit Health Score (0–100) | Critical | ✅ computed from onboarding + scan data |
| Funding Readiness Score (0–100) | Critical | ✅ on dashboard + funding center |
| Dispute tracking with real state (open/sent/resolved + timeline) | Critical | ✅ package-tracking timeline, persisted (Supabase + local fallback) |
| Stripe checkout (any way to pay at all) | Critical | ✅ `/api/credits/checkout` + plan-aligned upgrade modal |
| Lead capture from landing quiz | Critical | ✅ `/api/leads` + quiz answers carried into onboarding |
| Settings page | High | ✅ simple: profile, plan, notifications, data & privacy, sign out |
| Credit simulator (baseline from real profile) | High | ✅ baseline now from user's own score; adds utilization payoff scenario |
| Funding simulator ("what if my score rises?") | High | ✅ slider with unlock tiers |
| 30/90/180-day AI roadmap | High | ✅ generated at onboarding, shown on dashboard; 365-day ⬜ |
| Smart notifications (dispute deadlines, weekly check-in) | High | 🔶 in-app nudges (deadline countdowns, Jordan weekly check-in); email/push ⬜ |
| Gamification (badges, streaks, milestones) | Medium | ✅ streaks, 8 badges, milestone list |
| Debt payoff planner | Medium | 🔶 utilization payoff card in simulator; full avalanche/snowball planner ⬜ |
| Collection removal tracker | Medium | ✅ dispute type filter + resolved wins feed |
| Inquiry tracker | Medium | 🔶 tracked as dispute type; dedicated 24-month aging view ⬜ |
| Tradeline tracker (personal) | Medium | 🔶 business vendor kanban exists; personal tradelines ⬜ |
| Funding vault (saved offers) | Medium | ✅ "Save offer" persists to vault in Funding Center |
| Funding eligibility matching | Medium | ✅ educational profile-fit guidance; live lender offers/applications require an integration |
| Credit monitoring (bureau data feeds) | High | ⬜ requires Array/CRS/Plaid-type API partnership — biggest unlock, see FINTECH_FEATURE_AUDIT.md |
| Password reset / magic link UX | High | ✅ reset request, invalid/expired handling, magic link, and in-app password completion |
| PDF letter download / mail fulfillment | Medium | ✅ Round 1 audit + bureau PDF packet shipped; Click2Mail fulfillment wired, real mailed-order proof ⬜ |

## Workflow gaps fixed

- **Scan results were ephemeral** → now persisted (last scan cached, feeds dashboard Negative Accounts + Action Center).
- **No bridge from analysis to action** → every scan finding has "Generate dispute letter" which pre-fills the letter form and creates a tracked dispute.
- **Three disconnected letter tools** → letters auto-attach to disputes; history shows status.
- **Quiz → app cold start** → quiz answers prefill onboarding step answers.
- **Onboarding progress could be lost** → every step now validates, autosaves, and resumes after reload.
- **State was device-local only** → signed-in state now syncs through the owner-only `user_state` Supabase table, with local fallback.
- **Scanned reports failed silently** → PNG/JPG and image-only PDFs now route through OCR with progress, retry, and low-evidence confirmations.

## Things removed (were hurting trust)

- Hardcoded "PRO ACTIVE" pill while signed out.
- Fake dashboard data: "$1,740 subscriptions revenue", "Collection deleted — Marcus T. 2h ago", fake client counts. (Agency revenue widgets removed from consumer dashboard entirely.)
- "Live endpoint" badge on a static lender list.
- Fake coach roster with hardcoded prices presented as bookable.
- "680 Score" pill hardcoded in the top bar.

## Conversion & retention gaps

| Gap | Fix shipped |
|---|---|
| No reason to return daily | Streak + Action Center + dispute countdowns |
| No upgrade triggers | Gates at: out of credits, bulk letters, funding match engine, business suite — each opens contextual upgrade modal |
| No win celebration | Recent Wins feed + badge toasts on first scan/letter/dispute resolved |
| Demo data could look real | Landing dashboard is explicitly labeled as illustrative sample data |
| Anonymous value = zero | Simulators + onboarding work before sign-up; auth requested at save/AI moments |
