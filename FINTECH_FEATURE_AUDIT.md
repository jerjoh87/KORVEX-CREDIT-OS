# CREDITOS — Fintech Industry Audit (Phase 2)

Benchmark set: Credit Karma, Rocket Money, Nav, Ramp, Brex, Mercury, Robinhood, Stripe, plus credit-repair incumbents (Credit Repair Cloud, Dovly, CreditVersio).

## 1. Credit Repair

| Capability | Industry bar | CREDITOS before | CREDITOS now |
|---|---|---|---|
| Dispute workflows | Multi-round, per-bureau, deadline-driven (Dovly automates rounds) | Letters generated but untracked; "Dispute Timeline" page was static demo HTML | Real dispute objects: Draft → Mailed → Received → Investigating → Resolved, FCRA 30-day countdown per dispute, round escalation prompt at day 30 |
| Credit monitoring | Daily/weekly bureau pulls via Array/CRS APIs | None (manual report upload only) | Still upload-based — **top roadmap item**; clearly labeled as not connected |
| Negative item tracking | Itemized derogatory list w/ status | Only inside one ephemeral scan render | Persisted scan → Negative Accounts summary on dashboard, item-level dispute linkage |
| Collection tracking | Removal pipeline + paid/deleted states | None | Dispute type=collection filter + Wins feed on deletion |
| Inquiry management | Inquiry list w/ age-off dates | Dispute letter type existed | Tracked as disputes; age-off view recommended next |
| Utilization tracking | Per-card utilization + alerts | One hardcoded sentence | Utilization captured at onboarding, shown w/ target band (<10%), payoff scenario in simulator |

## 2. Funding

| Capability | Industry bar (Nav, Lendio) | Before | Now |
|---|---|---|---|
| Personal funding | Matched offers w/ explainable fit | Static 3-lender list labeled "Live endpoint" | Category tabs with projected profile fit, why recommended, improvements, documents, and no fake application flow |
| Business funding | Readiness + tradeline building | Good skeleton (vendors kanban, roadmap) | Kept + business profile fields (EIN/DUNS progress, revenue) persisted |
| Card / LOC recommendations | Pre-qual API integrations | None | Curated cards w/ requirements; affiliate-link slots ready |
| Funding readiness | Score 0–100 + blockers | Only inside AI roadmap response | First-class score on dashboard, blockers w/ fixes |
| Application flow | Live lender/affiliate integration | None | Qualification steps only; lender links clearly marked not connected |

## 3. AI

| Capability | Before | Now |
|---|---|---|
| AI advisor | Generic chat w/ fake seeded conversation | "Jordan" — context-aware system prompt (gets user's goal, score, utilization, dispute count), suggested prompts, weekly check-in nudge, goal card |
| AI dispute assistant | 4 letter generators (good prompts, FCRA-cited) | Same engines + auto-prefill from scan findings + letters attach to tracked disputes |
| AI funding advisor | Roadmap JSON endpoint (good) | Kept; results persist; feeds readiness score |
| AI credit coach / plans | None | Blueprint at onboarding: 30/90/180-day plans, goal tracking |

## 4. Missing automations (revenue + retention)

1. **Auto-round escalation** (biggest retention lever): at day 30 with no resolution, prompt 1-click Round 2 escalation letter (engine already exists). 🔶 prompt shipped; full automation needs a scheduler.
2. **Mail fulfillment** (Lob/Click2Mail): charge $3–6/letter mailed — high-margin transactional revenue. ⬜
3. **Bureau data feed** (Array/CRS): converts the product from "upload a PDF" to "always-on monitoring" — justifies $29–49/mo alone. ⬜
4. **Weekly digest email** (score deltas, dispute status, next action). ⬜
5. **Lead-to-user nurture**: quiz leads now stored in `leads` table → connect ESP. 🔶

## 5. Missing revenue opportunities (found in audit)

| Opportunity | Mechanism | Est. value |
|---|---|---|
| Checkout didn't exist | Upgrade buttons now create Stripe Checkout Sessions | Unblocks 100% of subscription revenue |
| Letter mailing | Per-letter fee via Lob | $3–6/letter, ~70% margin |
| Affiliate funding offers | Card/LOC referral payouts (Credit Karma's core model) | $50–200/funded referral |
| Business credit bundle | EIN/DUNS/vendor program as Business-plan exclusive | Anchors $199/mo tier |
| Credit packs | One-time credit top-ups for free/starter users | Impulse revenue, already modeled in `profiles.credits` |
| White-label / agency seats | Existing pages, now gated to Business plan | B2B expansion |

## 6. Compliance flags (Credit Industry Expert review)

- **CROA (Credit Repair Organizations Act)**: positioning matters. Software that consumers use themselves ≈ tool; doing repair *for* them ≈ CRO with contract/cancellation/no-advance-fee duties. Added disclaimer: CREDITOS is self-help software, not a credit repair organization; users can dispute for free themselves. **Get counsel review before launch.**
- **FCRA accuracy**: letters cite §611/§604/§605 correctly. Kept.
- **TSR/advance-fee**: subscription for software is fine; never charge "per deletion" promises.
- **Claims hygiene**: removed fabricated testimonials/score promises; all projections now labeled "estimate".
- **Data**: credit reports are sensitive PII — retention window + encryption noted in privacy copy; report text should not be stored longer than needed (analyze-and-discard is current behavior — good, keep it).
