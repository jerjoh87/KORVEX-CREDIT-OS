// ─────────────────────────────────────────────
//  CREDITOS — Billing helpers
//  lib/billing.js
//
//  Pure functions with no external dependencies.
//  Safe to import in tests, routes, and scripts.
//
//  Plan ladder (monthly USD):
//    free     $0    — 3 trial credits (set at signup, not here)
//    starter  $19   — 25 credits / month
//    pro      $49   — unlimited
//    premium  $99   — unlimited + automation/matching
//    business $199  — unlimited + agency suite
//
//  Legacy plan names ('agency', 'enterprise') may still exist on
//  old profile rows — treat them as unlimited everywhere.
// ─────────────────────────────────────────────

export const PLAN_PRICES_CENTS = {
  starter:  1900,
  pro:      4900,
  premium:  9900,
  business: 19900,
};

export const UNLIMITED_PLANS = ['pro', 'premium', 'business', 'agency', 'enterprise'];
export const PREMIUM_ACCESS_PLANS = ['premium', 'business', 'agency', 'enterprise'];

export function isUnlimitedPlan(plan) {
  return UNLIMITED_PLANS.includes(plan);
}

export function hasPremiumAccess(plan, subscriptionStatus = null) {
  if (!PREMIUM_ACCESS_PLANS.includes(plan)) return false;
  return !['canceled', 'unpaid', 'incomplete_expired', 'paused'].includes(subscriptionStatus);
}

export function unixToIso(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : null;
}

export function getSubscriptionPeriodEnd(subscription) {
  const topLevel = Number(subscription?.current_period_end);
  if (Number.isFinite(topLevel) && topLevel > 0) return topLevel;
  const itemEnds = (subscription?.items?.data || [])
    .map(item => Number(item?.current_period_end))
    .filter(value => Number.isFinite(value) && value > 0);
  return itemEnds.length ? Math.max(...itemEnds) : null;
}

export function getSubscriptionBillingFields(subscription = {}) {
  const periodEnd = getSubscriptionPeriodEnd(subscription);
  return {
    stripe_subscription_id: subscription.id || null,
    subscription_status: subscription.status || null,
    trial_started_at: unixToIso(subscription.trial_start),
    trial_ends_at: unixToIso(subscription.trial_end),
    next_bill_at: unixToIso(periodEnd || subscription.trial_end),
    canceled_at: unixToIso(subscription.canceled_at || subscription.cancel_at)
  };
}

// Map a monthly amount (cents) to a plan name + starting credits.
export function getPlanFromAmount(monthlyAmountCents) {
  if (monthlyAmountCents >= 19900) return { plan: 'business', credits: 999 };
  if (monthlyAmountCents >= 9900)  return { plan: 'premium',  credits: 999 };
  if (monthlyAmountCents >= 4900)  return { plan: 'pro',      credits: 999 };
  if (monthlyAmountCents >= 1900)  return { plan: 'starter',  credits: 25  };
  // One-time credit packs / unknown small amounts fall back to starter credits
  return { plan: 'starter', credits: 25 };
}

export function getPlanFromCheckoutSession(session = {}) {
  const explicitPlan = String(session?.metadata?.plan || '').toLowerCase();
  if (PLAN_PRICES_CENTS[explicitPlan]) {
    return { plan: explicitPlan, credits: explicitPlan === 'starter' ? 25 : 999 };
  }
  return getPlanFromAmount(Number(session?.amount_total) || 0);
}

// Derive a plan from a Stripe Subscription object.
// Normalises annual prices to their monthly equivalent so the thresholds
// in getPlanFromAmount always apply correctly (e.g. $588/yr → $49/mo → pro).
export function getPlanFromSubscription(subscription) {
  const item  = subscription?.items?.data?.[0];
  const price = item?.price;
  if (!price?.unit_amount) return { plan: 'free', credits: 0 };

  let monthly = price.unit_amount;
  if (price.recurring?.interval === 'year') {
    monthly = Math.round(monthly / 12);
  }
  return getPlanFromAmount(monthly);
}

// Decide what to do with a subscription based on its Stripe status.
// Returns one of: 'sync' | 'flag' | 'downgrade' | 'noop'
export function resolveSubscriptionAction(status) {
  if (status === 'active' || status === 'trialing') return 'sync';
  if (status === 'past_due')                        return 'flag';
  if (status === 'canceled' || status === 'unpaid') return 'downgrade';
  return 'noop';
}
