// ─────────────────────────────────────────────
//  CREDITOS — Credits & Billing Routes
//  routes/credits.js
//
//  GET  /api/credits/balance       — current balance
//  POST /api/credits/checkout      — create a Stripe Checkout Session
//  POST /api/credits/stripe        — Stripe webhook (signature-verified)
//  POST /api/credits/add           — internal credit adjustment
//
//  Stripe events handled:
//    checkout.session.completed    — new purchase → assign plan + credits
//    customer.subscription.updated — plan change / renewal → sync plan
//    customer.subscription.deleted — cancellation → downgrade to free
//    invoice.payment_failed        — failed charge → flag account
//    invoice.paid                  — charge recovered → clear flag, sync plan
// ─────────────────────────────────────────────
import { Router } from 'express';
import Stripe from 'stripe';
import { requireAuth, supabaseAdmin } from '../server.js';
import {
  getPlanFromAmount,
  getPlanFromSubscription,
  resolveSubscriptionAction,
  isUnlimitedPlan,
  PLAN_PRICES_CENTS
} from '../lib/billing.js';

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' })
  : null;

const router = Router();

// ── Supabase helpers ───────────────────────────────────────────────────────────

// Look up a profile by Stripe customer ID first (most reliable), then email.
async function findUser(stripeCustomerId, email) {
  if (stripeCustomerId) {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('id, plan, credits')
      .eq('stripe_customer_id', stripeCustomerId)
      .limit(1);
    if (data?.length) return data[0];
  }
  if (email) {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('id, plan, credits')
      .eq('email', email)
      .limit(1);
    if (data?.length) return data[0];
  }
  return null;
}

async function updateProfile(userId, fields) {
  const { error } = await supabaseAdmin
    .from('profiles')
    .update(fields)
    .eq('id', userId);
  if (error) throw new Error(error.message);
}

// ── Webhook event handlers ─────────────────────────────────────────────────────

// checkout.session.completed — one-time purchase or new subscription checkout
async function handleCheckout(event) {
  const session       = event.data.object;
  const customerEmail = session.customer_details?.email || session.customer_email;
  const amountTotal   = session.amount_total || 0;

  if (!customerEmail) {
    console.warn('[stripe:checkout] No customer email in session', session.id);
    return { warning: 'No email in session.' };
  }

  const { plan, credits } = getPlanFromAmount(amountTotal);
  console.log(`[stripe:checkout] ${customerEmail} $${(amountTotal / 100).toFixed(2)} → ${plan}`);

  const user = await findUser(session.customer, customerEmail);
  if (!user) {
    console.warn('[stripe:checkout] User not found:', customerEmail);
    return { warning: 'User not found yet.' };
  }

  await updateProfile(user.id, {
    plan,
    credits,
    stripe_customer_id: session.customer || null,
    payment_failed:     false
  });

  console.log(`[stripe:checkout] Updated ${customerEmail} → ${plan}`);
  return { plan, credits };
}

// customer.subscription.updated — plan change, renewal, trial end, status change
async function handleSubscriptionUpdated(event) {
  const sub    = event.data.object;
  const status = sub.status; // active | trialing | past_due | canceled | unpaid | paused

  console.log(`[stripe:sub.updated] customer=${sub.customer} status=${status}`);

  const user = await findUser(sub.customer, null);
  if (!user) {
    console.warn('[stripe:sub.updated] No user found for customer', sub.customer);
    return { warning: 'User not found.' };
  }

  const action = resolveSubscriptionAction(status);

  if (action === 'sync') {
    const { plan, credits } = getPlanFromSubscription(sub);
    await updateProfile(user.id, { plan, credits, payment_failed: false });
    console.log(`[stripe:sub.updated] ${user.id} → ${plan} (${status})`);
    return { plan, status };
  }

  if (action === 'flag') {
    // Grace period — keep current plan, just flag it.
    await updateProfile(user.id, { payment_failed: true });
    console.warn(`[stripe:sub.updated] ${user.id} past_due — plan kept, payment_failed flagged`);
    return { status, action: 'flagged' };
  }

  if (action === 'downgrade') {
    await updateProfile(user.id, { plan: 'free', credits: 0, payment_failed: false });
    console.log(`[stripe:sub.updated] ${user.id} → free (${status})`);
    return { plan: 'free', status };
  }

  // paused or any other status — no change, just log
  console.log(`[stripe:sub.updated] ${user.id} unhandled status=${status} — no change`);
  return { status, action: 'skipped' };
}

// customer.subscription.deleted — hard cancellation
async function handleSubscriptionDeleted(event) {
  const sub = event.data.object;

  console.log(`[stripe:sub.deleted] customer=${sub.customer}`);

  const user = await findUser(sub.customer, null);
  if (!user) {
    console.warn('[stripe:sub.deleted] No user found for customer', sub.customer);
    return { warning: 'User not found.' };
  }

  await updateProfile(user.id, { plan: 'free', credits: 0, payment_failed: false });
  console.log(`[stripe:sub.deleted] ${user.id} downgraded to free`);
  return { plan: 'free' };
}

// invoice.payment_failed — charge attempt failed (Stripe will retry automatically)
async function handlePaymentFailed(event) {
  const invoice = event.data.object;

  console.warn(`[stripe:payment_failed] customer=${invoice.customer} attempt=${invoice.attempt_count}`);

  const user = await findUser(invoice.customer, invoice.customer_email);
  if (!user) {
    console.warn('[stripe:payment_failed] No user found for customer', invoice.customer);
    return { warning: 'User not found.' };
  }

  // Flag the account but do NOT revoke access — Stripe retries before deleting
  // the subscription. If it fails definitively, subscription.deleted fires.
  await updateProfile(user.id, { payment_failed: true });
  console.warn(`[stripe:payment_failed] ${user.id} flagged (attempt ${invoice.attempt_count})`);
  return { flagged: true, attempt: invoice.attempt_count };
}

// invoice.paid — payment recovered or renewal succeeded; clear any failure flag
async function handleInvoicePaid(event) {
  const invoice = event.data.object;

  console.log(`[stripe:invoice.paid] customer=${invoice.customer}`);

  const user = await findUser(invoice.customer, invoice.customer_email);
  if (!user) {
    console.warn('[stripe:invoice.paid] No user found for customer', invoice.customer);
    return { warning: 'User not found.' };
  }

  // Clear the payment_failed flag — subscription event will sync the plan
  await updateProfile(user.id, { payment_failed: false });
  console.log(`[stripe:invoice.paid] ${user.id} payment_failed cleared`);
  return { cleared: true };
}

// ── Webhook dispatcher ────────────────────────────────────────────────────────

const EVENT_HANDLERS = {
  'checkout.session.completed':    handleCheckout,
  'customer.subscription.updated': handleSubscriptionUpdated,
  'customer.subscription.deleted': handleSubscriptionDeleted,
  'invoice.payment_failed':        handlePaymentFailed,
  'invoice.paid':                  handleInvoicePaid,
};

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET /api/credits/balance
router.get('/balance', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles').select('credits, plan, payment_failed').eq('id', req.user.id).single();
    if (error) return res.status(404).json({ error: 'Profile not found.' });
    const unlimited = isUnlimitedPlan(data.plan);
    res.json({
      credits:        unlimited ? 999 : data.credits,
      plan:           data.plan || 'free',
      unlimited,
      payment_failed: data.payment_failed || false
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/credits/checkout — create a Stripe Checkout Session for a plan.
// Uses STRIPE_PRICE_<PLAN> env price IDs when provided; otherwise falls back
// to inline price_data so checkout works with only STRIPE_SECRET_KEY set.
router.post('/checkout', requireAuth, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Payments are not configured on this server.' });
  }

  const plan = String(req.body?.plan || '').toLowerCase();
  const amount = PLAN_PRICES_CENTS[plan];
  if (!amount) {
    return res.status(400).json({ error: `Unknown plan "${plan}". Valid: ${Object.keys(PLAN_PRICES_CENTS).join(', ')}.` });
  }

  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const priceId = process.env[`STRIPE_PRICE_${plan.toUpperCase()}`];

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: req.user.email,
      client_reference_id: req.user.id,
      line_items: [
        priceId
          ? { price: priceId, quantity: 1 }
          : {
              quantity: 1,
              price_data: {
                currency: 'usd',
                unit_amount: amount,
                recurring: { interval: 'month' },
                product_data: { name: `CREDITOS ${plan.charAt(0).toUpperCase()}${plan.slice(1)}` }
              }
            }
      ],
      subscription_data: { trial_period_days: 7 },
      allow_promotion_codes: true,
      success_url: `${appUrl}/app.html?checkout=success`,
      cancel_url:  `${appUrl}/app.html?checkout=cancelled`
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('[checkout]', e.message);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
});

// POST /api/credits/stripe — Stripe webhook (signature-verified)
router.post('/stripe', async (req, res) => {
  if (!stripe) {
    console.warn('[stripe] STRIPE_SECRET_KEY not set — webhook disabled.');
    return res.status(503).json({ error: 'Stripe not configured.' });
  }

  const sig           = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[stripe] STRIPE_WEBHOOK_SECRET not set — rejecting request.');
    return res.status(500).json({ error: 'Webhook secret not configured.' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[stripe] Signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook signature invalid: ${err.message}` });
  }

  const handler = EVENT_HANDLERS[event.type];
  if (!handler) {
    return res.json({ received: true, skipped: true, type: event.type });
  }

  try {
    const result = await handler(event);
    res.json({ received: true, success: true, type: event.type, ...result });
  } catch (e) {
    console.error(`[stripe:${event.type}]`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/credits/add — Internal credit adjustment
router.post('/add', async (req, res) => {
  const secret = req.headers['x-webhook-secret'];
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  const { user_id, email, credits, plan } = req.body;
  if (!user_id && !email) return res.status(400).json({ error: 'user_id or email required.' });
  try {
    const updates = {};
    if (credits !== undefined) updates.credits = credits;
    if (plan)                  updates.plan    = plan;
    let query = supabaseAdmin.from('profiles').update(updates);
    query = user_id ? query.eq('id', user_id) : query.eq('email', email);
    const { error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, updates });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
