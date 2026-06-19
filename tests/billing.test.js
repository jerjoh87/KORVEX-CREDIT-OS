// ─────────────────────────────────────────────
//  CREDITOS — Billing logic tests
//  tests/billing.test.js
//
//  Run:  npm test
//        node --test tests/billing.test.js
// ─────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPlanFromAmount,
  getPlanFromSubscription,
  resolveSubscriptionAction,
  isUnlimitedPlan,
  PLAN_PRICES_CENTS,
} from '../lib/billing.js';

// ── getPlanFromAmount ─────────────────────────────────────────────────────────
describe('getPlanFromAmount', () => {
  test('$19/mo → starter with 25 credits', () => {
    const r = getPlanFromAmount(1900);
    assert.equal(r.plan, 'starter');
    assert.equal(r.credits, 25);
  });

  test('$49/mo → pro with 999 credits', () => {
    const r = getPlanFromAmount(4900);
    assert.equal(r.plan, 'pro');
    assert.equal(r.credits, 999);
  });

  test('$99/mo → premium with 999 credits', () => {
    const r = getPlanFromAmount(9900);
    assert.equal(r.plan, 'premium');
    assert.equal(r.credits, 999);
  });

  test('$199/mo → business with 999 credits', () => {
    const r = getPlanFromAmount(19900);
    assert.equal(r.plan, 'business');
    assert.equal(r.credits, 999);
  });

  test('amount below minimum → starter fallback', () => {
    const r = getPlanFromAmount(100);
    assert.equal(r.plan, 'starter');
    assert.equal(r.credits, 25);
  });

  test('amount of 0 → starter fallback', () => {
    assert.equal(getPlanFromAmount(0).plan, 'starter');
  });

  test('amount exactly at pro threshold (4900) qualifies', () => {
    assert.equal(getPlanFromAmount(4900).plan, 'pro');
  });

  test('amount one cent below pro threshold does not qualify', () => {
    assert.equal(getPlanFromAmount(4899).plan, 'starter');
  });

  test('PLAN_PRICES_CENTS round-trips through getPlanFromAmount', () => {
    for (const [plan, cents] of Object.entries(PLAN_PRICES_CENTS)) {
      assert.equal(getPlanFromAmount(cents).plan, plan, `$${cents / 100} should map to ${plan}`);
    }
  });
});

// ── isUnlimitedPlan ───────────────────────────────────────────────────────────
describe('isUnlimitedPlan', () => {
  test('pro, premium, business are unlimited', () => {
    for (const p of ['pro', 'premium', 'business']) assert.equal(isUnlimitedPlan(p), true);
  });

  test('legacy agency and enterprise stay unlimited', () => {
    for (const p of ['agency', 'enterprise']) assert.equal(isUnlimitedPlan(p), true);
  });

  test('free and starter are metered', () => {
    for (const p of ['free', 'starter', undefined, null]) assert.equal(isUnlimitedPlan(p), false);
  });
});

// ── getPlanFromSubscription — monthly + annual ────────────────────────────────
describe('getPlanFromSubscription', () => {
  function makeSub(amountCents, interval = 'month') {
    return {
      items: {
        data: [{
          price: {
            unit_amount: amountCents,
            recurring: { interval },
          },
        }],
      },
    };
  }

  test('monthly $19 → starter', () => {
    assert.equal(getPlanFromSubscription(makeSub(1900)).plan, 'starter');
  });

  test('monthly $49 → pro', () => {
    assert.equal(getPlanFromSubscription(makeSub(4900)).plan, 'pro');
  });

  test('monthly $99 → premium', () => {
    assert.equal(getPlanFromSubscription(makeSub(9900)).plan, 'premium');
  });

  test('monthly $199 → business', () => {
    assert.equal(getPlanFromSubscription(makeSub(19900)).plan, 'business');
  });

  // Annual plans must not cross-contaminate tier thresholds
  test('annual $588/yr ($49×12) normalises to $49/mo → pro', () => {
    assert.equal(getPlanFromSubscription(makeSub(4900 * 12, 'year')).plan, 'pro');
  });

  test('annual $1188/yr ($99×12) normalises to $99/mo → premium', () => {
    assert.equal(getPlanFromSubscription(makeSub(9900 * 12, 'year')).plan, 'premium');
  });

  test('annual $2388/yr ($199×12) normalises to $199/mo → business', () => {
    assert.equal(getPlanFromSubscription(makeSub(19900 * 12, 'year')).plan, 'business');
  });

  test('missing price data → free plan with 0 credits', () => {
    const r = getPlanFromSubscription({ items: { data: [] } });
    assert.equal(r.plan, 'free');
    assert.equal(r.credits, 0);
  });

  test('null/undefined subscription → free plan with 0 credits', () => {
    assert.equal(getPlanFromSubscription(null).plan, 'free');
    assert.equal(getPlanFromSubscription(undefined).plan, 'free');
  });
});

// ── resolveSubscriptionAction ─────────────────────────────────────────────────
describe('resolveSubscriptionAction', () => {
  test('active → sync', () => {
    assert.equal(resolveSubscriptionAction('active'), 'sync');
  });

  test('trialing → sync', () => {
    assert.equal(resolveSubscriptionAction('trialing'), 'sync');
  });

  test('past_due → flag (grace period, no downgrade yet)', () => {
    assert.equal(resolveSubscriptionAction('past_due'), 'flag');
  });

  test('canceled → downgrade', () => {
    assert.equal(resolveSubscriptionAction('canceled'), 'downgrade');
  });

  test('unpaid → downgrade', () => {
    assert.equal(resolveSubscriptionAction('unpaid'), 'downgrade');
  });

  test('paused → noop', () => {
    assert.equal(resolveSubscriptionAction('paused'), 'noop');
  });

  test('unknown status → noop', () => {
    assert.equal(resolveSubscriptionAction('something_new'), 'noop');
  });
});
