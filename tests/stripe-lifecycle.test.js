// ─────────────────────────────────────────────
//  CREDITOS — Stripe lifecycle tests
//  tests/stripe-lifecycle.test.js
//
//  Tests the event-handler routing and profile
//  update logic using lightweight stubs — no real
//  Stripe or Supabase calls are made.
//
//  Run:  npm test
//        node --test tests/stripe-lifecycle.test.js
// ─────────────────────────────────────────────
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPlanFromAmount,
  getPlanFromSubscription,
  resolveSubscriptionAction,
} from '../lib/billing.js';

// ── Stub helpers ──────────────────────────────────────────────────────────────
// Simulate what each webhook handler does to a profile, without hitting
// Supabase or Stripe. Each function mirrors the logic in routes/credits.js.

function simulateCheckout(amountCents, initialProfile = {}) {
  const { plan, credits } = getPlanFromAmount(amountCents);
  return { ...initialProfile, plan, credits, payment_failed: false };
}

function simulateSubscriptionUpdated(status, sub, initialProfile = {}) {
  const action = resolveSubscriptionAction(status);

  if (action === 'sync') {
    const { plan, credits } = getPlanFromSubscription(sub);
    return { ...initialProfile, plan, credits, payment_failed: false };
  }
  if (action === 'flag') {
    return { ...initialProfile, payment_failed: true };
  }
  if (action === 'downgrade') {
    return { ...initialProfile, plan: 'free', credits: 0, payment_failed: false };
  }
  return initialProfile; // noop
}

function simulateSubscriptionDeleted(initialProfile = {}) {
  return { ...initialProfile, plan: 'free', credits: 0, payment_failed: false };
}

function simulatePaymentFailed(initialProfile = {}) {
  return { ...initialProfile, payment_failed: true };
}

function simulateInvoicePaid(initialProfile = {}) {
  return { ...initialProfile, payment_failed: false };
}

function makeMonthlySubscription(amountCents) {
  return {
    items: { data: [{ price: { unit_amount: amountCents, recurring: { interval: 'month' } } }] },
  };
}

// ── checkout.session.completed ────────────────────────────────────────────────
describe('checkout.session.completed', () => {
  test('assigns correct plan and credits for each tier', () => {
    const cases = [
      { amount: 1900,  plan: 'starter',  credits: 25  },
      { amount: 4900,  plan: 'pro',      credits: 999 },
      { amount: 9900,  plan: 'premium',  credits: 999 },
      { amount: 19900, plan: 'business', credits: 999 },
    ];
    for (const { amount, plan, credits } of cases) {
      const profile = simulateCheckout(amount);
      assert.equal(profile.plan, plan, `$${amount / 100} should map to ${plan}`);
      assert.equal(profile.credits, credits);
    }
  });

  test('clears payment_failed flag on successful purchase', () => {
    const profile = simulateCheckout(4900, { payment_failed: true });
    assert.equal(profile.payment_failed, false);
  });
});

// ── customer.subscription.updated ────────────────────────────────────────────
describe('customer.subscription.updated', () => {
  test('active status syncs plan from subscription price', () => {
    const sub = makeMonthlySubscription(4900);
    const profile = simulateSubscriptionUpdated('active', sub, { plan: 'starter' });
    assert.equal(profile.plan, 'pro');
    assert.equal(profile.payment_failed, false);
  });

  test('trialing status syncs plan', () => {
    const sub = makeMonthlySubscription(9900);
    const profile = simulateSubscriptionUpdated('trialing', sub, {});
    assert.equal(profile.plan, 'premium');
  });

  test('past_due flags account but keeps plan intact', () => {
    const sub = makeMonthlySubscription(4900);
    const initial = { plan: 'pro', credits: 999, payment_failed: false };
    const profile = simulateSubscriptionUpdated('past_due', sub, initial);
    assert.equal(profile.plan, 'pro',    'plan must not change on past_due');
    assert.equal(profile.credits, 999,   'credits must not change on past_due');
    assert.equal(profile.payment_failed, true);
  });

  test('canceled status downgrades to free with 0 credits', () => {
    const sub = makeMonthlySubscription(4900);
    const profile = simulateSubscriptionUpdated('canceled', sub, { plan: 'pro', credits: 999 });
    assert.equal(profile.plan, 'free');
    assert.equal(profile.credits, 0);
    assert.equal(profile.payment_failed, false);
  });

  test('unpaid status downgrades to free', () => {
    const sub = makeMonthlySubscription(4900);
    const profile = simulateSubscriptionUpdated('unpaid', sub, { plan: 'pro' });
    assert.equal(profile.plan, 'free');
    assert.equal(profile.credits, 0);
  });

  test('paused status makes no profile changes', () => {
    const sub = makeMonthlySubscription(4900);
    const initial = { plan: 'pro', credits: 999 };
    const profile = simulateSubscriptionUpdated('paused', sub, initial);
    assert.equal(profile.plan, 'pro');
    assert.equal(profile.credits, 999);
  });
});

// ── customer.subscription.deleted ────────────────────────────────────────────
describe('customer.subscription.deleted', () => {
  test('always downgrades to free and zeroes credits', () => {
    const profile = simulateSubscriptionDeleted({ plan: 'business', credits: 999 });
    assert.equal(profile.plan, 'free');
    assert.equal(profile.credits, 0);
  });

  test('clears payment_failed flag on deletion', () => {
    const profile = simulateSubscriptionDeleted({ plan: 'pro', payment_failed: true });
    assert.equal(profile.payment_failed, false);
  });
});

// ── invoice.payment_failed ────────────────────────────────────────────────────
describe('invoice.payment_failed', () => {
  test('sets payment_failed flag without changing plan', () => {
    const profile = simulatePaymentFailed({ plan: 'pro', credits: 999 });
    assert.equal(profile.payment_failed, true);
    assert.equal(profile.plan, 'pro',    'plan must be preserved');
    assert.equal(profile.credits, 999,   'credits must be preserved');
  });
});

// ── invoice.paid ──────────────────────────────────────────────────────────────
describe('invoice.paid', () => {
  test('clears payment_failed flag without changing plan', () => {
    const profile = simulateInvoicePaid({ plan: 'pro', credits: 999, payment_failed: true });
    assert.equal(profile.payment_failed, false);
    assert.equal(profile.plan, 'pro');
  });
});

// ── Grace period contract ─────────────────────────────────────────────────────
describe('grace period contract', () => {
  test('payment_failed → invoice.paid restores clean state', () => {
    let profile = { plan: 'pro', credits: 999, payment_failed: false };
    profile = simulatePaymentFailed(profile);    // charge fails
    assert.equal(profile.payment_failed, true);
    assert.equal(profile.plan, 'pro');           // still on pro during grace
    profile = simulateInvoicePaid(profile);      // Stripe retries and succeeds
    assert.equal(profile.payment_failed, false);
    assert.equal(profile.plan, 'pro');           // back to clean
  });

  test('payment_failed → subscription.deleted drops to free', () => {
    let profile = { plan: 'pro', credits: 999, payment_failed: false };
    profile = simulatePaymentFailed(profile);    // charge fails
    profile = simulateSubscriptionDeleted(profile); // Stripe gives up and cancels
    assert.equal(profile.plan, 'free');
    assert.equal(profile.credits, 0);
    assert.equal(profile.payment_failed, false);
  });
});
