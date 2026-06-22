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
//    customer.subscription.created — initial subscription state → sync access
//    customer.subscription.updated — plan change / renewal → sync plan
//    customer.subscription.trial_will_end — schedule renewal disclosure reminder
//    customer.subscription.deleted — cancellation → downgrade to free
//    invoice.payment_failed        — failed charge → flag account
//    invoice.paid                  — charge recovered → clear flag, sync plan
// ─────────────────────────────────────────────
import { Router } from 'express';
import Stripe from 'stripe';
import { requireAuth, supabaseAdmin } from '../lib/server-state.js';
import { isAdminUser } from '../lib/admin.js';
import {
  getPlanFromCheckoutSession,
  getPlanFromSubscription,
  resolveSubscriptionAction,
  isUnlimitedPlan,
  hasPremiumAccess,
  getSubscriptionBillingFields,
  PLAN_PRICES_CENTS
} from '../lib/billing.js';
import { recordLaunchVerificationEvent } from '../lib/launch-verification.js';
import { finalizeCertifiedMailBatch, finalizeCertifiedMailJob } from './mailing.js';

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' })
  : null;

const router = Router();

// ── Supabase helpers ───────────────────────────────────────────────────────────

// Look up a profile by exact user id first, then Stripe customer ID, then email.
async function findUser(userId, stripeCustomerId, email) {
  const fields = 'id, email, plan, credits, stripe_customer_id, stripe_subscription_id, subscription_status, trial_started_at, trial_ends_at, next_bill_at, canceled_at, payment_failed';
  if (userId) {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select(fields)
      .eq('id', userId)
      .limit(1);
    if (data?.length) return data[0];
  }
  if (stripeCustomerId) {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select(fields)
      .eq('stripe_customer_id', stripeCustomerId)
      .limit(1);
    if (data?.length) return data[0];
  }
  if (email) {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select(fields)
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

function subscriptionPlan(subscription) {
  const metadataPlan = String(subscription?.metadata?.plan || '').toLowerCase();
  if (PLAN_PRICES_CENTS[metadataPlan]) {
    return { plan: metadataPlan, credits: metadataPlan === 'starter' ? 25 : 999 };
  }
  return getPlanFromSubscription(subscription);
}

async function syncPremiumTrial(userId, subscription, overrides = {}) {
  const billing = getSubscriptionBillingFields(subscription);
  const row = {
    user_id: userId,
    stripe_customer_id: subscription?.customer || null,
    stripe_subscription_id: subscription?.id || null,
    status: subscription?.status || 'trialing',
    trial_started_at: billing.trial_started_at,
    trial_ends_at: billing.trial_ends_at,
    next_bill_at: billing.next_bill_at,
    canceled_at: billing.canceled_at,
    updated_at: new Date().toISOString(),
    ...overrides
  };
  const { error } = await supabaseAdmin
    .from('premium_trials')
    .upsert(row, { onConflict: 'user_id' });
  if (error) throw error;
  return row;
}

async function claimStripeEvent(event) {
  const { error } = await supabaseAdmin.from('stripe_webhook_events').insert({
    id: event.id,
    event_type: event.type,
    status: 'processing'
  });
  if (!error) return true;
  if (error.code === '23505') return false;
  if (error.code === '42P01' || /does not exist/i.test(error.message || '')) {
    console.warn('[stripe] stripe_webhook_events migration not applied; processing without idempotency storage.');
    return true;
  }
  throw error;
}

async function completeStripeEvent(eventId) {
  const { error } = await supabaseAdmin
    .from('stripe_webhook_events')
    .update({ status: 'completed', processed_at: new Date().toISOString() })
    .eq('id', eventId);
  if (error && error.code !== '42P01') console.warn('[stripe] Could not mark event completed:', error.message);
}

async function releaseStripeEvent(eventId) {
  const { error } = await supabaseAdmin.from('stripe_webhook_events').delete().eq('id', eventId);
  if (error && error.code !== '42P01') console.warn('[stripe] Could not release failed event:', error.message);
}

// ── Webhook event handlers ─────────────────────────────────────────────────────

// checkout.session.completed — one-time purchase or new subscription checkout
async function handleCheckout(event) {
  const session       = event.data.object;
  const customerEmail = session.customer_details?.email || session.customer_email;
  const amountTotal   = session.amount_total || 0;
  console.log(`[stripe:checkout.session.completed] event=${event.id} session=${session.id} customer=${session.customer || 'n/a'}`);
  await recordLaunchVerificationEvent({
    eventType: 'stripe_checkout_completed',
    provider: 'stripe',
    status: 'pass',
    metadata: {
      event_id: event.id,
      session_id: session.id,
      purpose: session.metadata?.purpose || null,
      amount_total: amountTotal
    }
  });

  if (session.metadata?.purpose === 'certified_mail') {
    const mailBatchId = session.metadata.mail_batch_id;
    const mailJobId = session.metadata.mail_job_id;
    if (mailBatchId) {
      try {
        const results = await finalizeCertifiedMailBatch(mailBatchId);
        return { mailed: true, batchId: mailBatchId, results };
      } catch (e) {
        console.error('[stripe:certified_mail batch]', e.message);
        const { error: updateError } = await supabaseAdmin
          .from('mail_jobs')
          .update({
            status: 'failed',
            error: e.message,
            updated_at: new Date().toISOString()
          })
          .eq('mail_batch_id', mailBatchId);
        if (updateError) console.error('[stripe:certified_mail batch] update failed', updateError.message);
        return { warning: 'Certified mail processing failed.' };
      }
    }

    if (!mailJobId) {
      console.warn('[stripe:checkout] Certified mail session missing mail_job_id');
      return { warning: 'Missing certified mail job ID.' };
    }

    const { data: job, error } = await supabaseAdmin
      .from('mail_jobs')
      .select('*')
      .eq('id', mailJobId)
      .maybeSingle();
    if (error) throw error;
    if (!job) return { warning: 'Mail job not found.' };

    try {
      return await finalizeCertifiedMailJob({ job, session });
    } catch (e) {
      console.error('[stripe:certified_mail]', e.message);
      await supabaseAdmin
        .from('mail_jobs')
        .update({
          status: 'failed',
          error: e.message,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);
      return { warning: 'Certified mail processing failed.' };
    }
  }

  if (!customerEmail) {
    console.warn('[stripe:checkout] No customer email in session', session.id);
    return { warning: 'No email in session.' };
  }

  const explicitPlan = String(session.metadata?.plan || '').toLowerCase();
  const isPremiumTrial = session.metadata?.purpose === 'premium_trial' && explicitPlan === 'premium';
  const { plan, credits } = getPlanFromCheckoutSession(session);
  console.log(`[stripe:checkout] ${customerEmail} $${(amountTotal / 100).toFixed(2)} → ${plan}`);

  const user = await findUser(session.client_reference_id || null, session.customer, customerEmail);
  if (!user) {
    console.warn('[stripe:checkout] User not found:', customerEmail);
    return { warning: 'User not found yet.' };
  }

  let subscription = null;
  if (session.subscription && stripe) {
    subscription = await stripe.subscriptions.retrieve(session.subscription, {
      expand: ['items.data.price']
    });
  }
  const billing = subscription ? getSubscriptionBillingFields(subscription) : {};

  await updateProfile(user.id, {
    plan,
    credits,
    stripe_customer_id: session.customer || null,
    payment_failed: false,
    ...billing
  });

  if (isPremiumTrial && subscription) {
    await syncPremiumTrial(user.id, subscription);
  }

  console.log(`[stripe:checkout] Updated ${customerEmail} → ${plan}`);
  return { plan, credits };
}

// customer.subscription.updated — plan change, renewal, trial end, status change
async function handleSubscriptionUpdated(event) {
  const sub    = event.data.object;
  const status = sub.status; // active | trialing | past_due | canceled | unpaid | paused

  console.log(`[stripe:customer.subscription.updated] event=${event.id} customer=${sub.customer} status=${status}`);
  await recordLaunchVerificationEvent({
    eventType: 'stripe_subscription_updated',
    provider: 'stripe',
    status: 'pass',
    metadata: {
      event_id: event.id,
      subscription_id: sub.id,
      customer_id: sub.customer,
      status
    }
  });

  const user = await findUser(sub.metadata?.user_id || null, sub.customer, null);
  if (!user) {
    console.warn('[stripe:sub.updated] No user found for customer', sub.customer);
    return { warning: 'User not found.' };
  }

  const action = resolveSubscriptionAction(status);

  if (action === 'sync') {
    const { plan, credits } = subscriptionPlan(sub);
    const billing = getSubscriptionBillingFields(sub);
    await updateProfile(user.id, { plan, credits, payment_failed: false, ...billing });
    if (plan === 'premium' || user.plan === 'premium') await syncPremiumTrial(user.id, sub);
    console.log(`[stripe:sub.updated] ${user.id} → ${plan} (${status})`);
    return { plan, status };
  }

  if (action === 'flag') {
    // Grace period — keep current plan, just flag it.
    await updateProfile(user.id, {
      payment_failed: true,
      subscription_status: status,
      ...getSubscriptionBillingFields(sub)
    });
    if (user.plan === 'premium') await syncPremiumTrial(user.id, sub);
    console.warn(`[stripe:sub.updated] ${user.id} past_due — plan kept, payment_failed flagged`);
    return { status, action: 'flagged' };
  }

  if (action === 'downgrade') {
    await updateProfile(user.id, {
      plan: 'free', credits: 0, payment_failed: false,
      ...getSubscriptionBillingFields(sub)
    });
    if (user.plan === 'premium') await syncPremiumTrial(user.id, sub);
    console.log(`[stripe:sub.updated] ${user.id} → free (${status})`);
    return { plan: 'free', status };
  }

  // paused or any other status — no change, just log
  await updateProfile(user.id, getSubscriptionBillingFields(sub));
  if (user.plan === 'premium') await syncPremiumTrial(user.id, sub);
  console.log(`[stripe:sub.updated] ${user.id} unhandled status=${status} — no change`);
  return { status, action: 'skipped' };
}

// customer.subscription.deleted — hard cancellation
async function handleSubscriptionDeleted(event) {
  const sub = event.data.object;

  console.log(`[stripe:customer.subscription.deleted] event=${event.id} customer=${sub.customer}`);
  await recordLaunchVerificationEvent({
    eventType: 'stripe_subscription_cancelled',
    provider: 'stripe',
    status: 'pass',
    metadata: {
      event_id: event.id,
      subscription_id: sub.id,
      customer_id: sub.customer
    }
  });

  const user = await findUser(sub.metadata?.user_id || null, sub.customer, null);
  if (!user) {
    console.warn('[stripe:sub.deleted] No user found for customer', sub.customer);
    return { warning: 'User not found.' };
  }

  await updateProfile(user.id, {
    plan: 'free', credits: 0, payment_failed: false,
    ...getSubscriptionBillingFields(sub)
  });
  if (user.plan === 'premium') await syncPremiumTrial(user.id, sub, {
    status: 'canceled',
    canceled_at: getSubscriptionBillingFields(sub).canceled_at || new Date().toISOString()
  });
  console.log(`[stripe:sub.deleted] ${user.id} downgraded to free`);
  return { plan: 'free' };
}

// invoice.payment_failed — charge attempt failed (Stripe will retry automatically)
async function handlePaymentFailed(event) {
  const invoice = event.data.object;

  console.warn(`[stripe:invoice.payment_failed] event=${event.id} customer=${invoice.customer} attempt=${invoice.attempt_count}`);

  const user = await findUser(null, invoice.customer, invoice.customer_email);
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

  console.log(`[stripe:invoice.paid] event=${event.id} customer=${invoice.customer}`);

  const user = await findUser(null, invoice.customer, invoice.customer_email);
  if (!user) {
    console.warn('[stripe:invoice.paid] No user found for customer', invoice.customer);
    return { warning: 'User not found.' };
  }

  // Clear the payment_failed flag — subscription event will sync the plan
  const periodEnds = (invoice.lines?.data || [])
    .map(line => Number(line?.period?.end))
    .filter(value => Number.isFinite(value) && value > 0);
  const nextBillAt = periodEnds.length ? new Date(Math.max(...periodEnds) * 1000).toISOString() : user.next_bill_at;
  await updateProfile(user.id, { payment_failed: false, next_bill_at: nextBillAt || null });
  console.log(`[stripe:invoice.paid] ${user.id} payment_failed cleared`);
  return { cleared: true };
}

async function handleTrialWillEnd(event) {
  const sub = event.data.object;
  const user = await findUser(sub.metadata?.user_id || null, sub.customer, null);
  if (!user) return { warning: 'User not found.' };
  if (user.plan !== 'premium' && sub.metadata?.plan !== 'premium') {
    return { skipped: true, reason: 'Not a Premium trial.' };
  }

  const billing = getSubscriptionBillingFields(sub);
  await updateProfile(user.id, billing);
  await syncPremiumTrial(user.id, sub);
  const alertDate = new Date().toISOString();
  const { error } = await supabaseAdmin.from('deadline_alerts').upsert({
    user_id: user.id,
    dispute_round_id: null,
    alert_type: 'trial_ending',
    alert_date: alertDate,
    status: 'due',
    metadata: {
      title: 'Your Premium trial ends soon',
      next_bill_at: billing.next_bill_at || billing.trial_ends_at,
      message: 'Manage or cancel billing before the renewal date if you do not want Premium to continue.'
    },
    dedupe_key: `subscription:${sub.id}:trial_ending`
  }, { onConflict: 'dedupe_key' });
  if (error) throw error;
  return { alerted: true, trial_ends_at: billing.trial_ends_at };
}

// ── Webhook dispatcher ────────────────────────────────────────────────────────

const EVENT_HANDLERS = {
  'checkout.session.completed':    handleCheckout,
  'customer.subscription.created': handleSubscriptionUpdated,
  'customer.subscription.updated': handleSubscriptionUpdated,
  'customer.subscription.trial_will_end': handleTrialWillEnd,
  'customer.subscription.deleted': handleSubscriptionDeleted,
  'invoice.payment_failed':        handlePaymentFailed,
  'invoice.paid':                  handleInvoicePaid,
};

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET /api/credits/balance
router.get('/balance', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('credits, plan, payment_failed, subscription_status, trial_started_at, trial_ends_at, next_bill_at, canceled_at, stripe_customer_id')
      .eq('id', req.user.id).single();
    if (error) return res.status(404).json({ error: 'Profile not found.' });
    const unlimited = isUnlimitedPlan(data.plan);
    const testAdmin = await isAdminUser(req.user?.id, req.user?.email || null);
    res.json({
      credits:        (unlimited || testAdmin) ? 999 : data.credits,
      plan:           data.plan || 'free',
      unlimited: unlimited || testAdmin,
      premium_access: hasPremiumAccess(data.plan, data.subscription_status),
      payment_failed: data.payment_failed || false,
      subscription_status: data.subscription_status || null,
      trial_started_at: data.trial_started_at || null,
      trial_ends_at: data.trial_ends_at || null,
      next_bill_at: data.next_bill_at || null,
      canceled_at: data.canceled_at || null,
      can_manage_billing: !!data.stripe_customer_id || testAdmin
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

  const appUrl = process.env.APP_BASE_URL || process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const priceId = plan === 'premium'
    ? (process.env.STRIPE_PREMIUM_PRICE_ID || process.env.STRIPE_PRICE_PREMIUM)
    : process.env[`STRIPE_PRICE_${plan.toUpperCase()}`];

  try {
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('plan, stripe_customer_id, subscription_status')
      .eq('id', req.user.id)
      .single();
    if (profileError) throw profileError;

    if (plan === 'premium') {
      if (hasPremiumAccess(profile.plan, profile.subscription_status)) {
        return res.status(409).json({ error: 'Premium access is already active. Use Manage billing in Settings.' });
      }
      const { data: priorTrial, error: trialError } = await supabaseAdmin
        .from('premium_trials')
        .select('id,status')
        .eq('user_id', req.user.id)
        .maybeSingle();
      if (trialError && trialError.code !== 'PGRST116') throw trialError;
      if (priorTrial) {
        return res.status(409).json({ error: 'The $1 Premium trial is limited to one per account. Manage billing or choose another plan.' });
      }
    }

    const lineItems = [
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
    ];
    const trialEnd = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    if (plan === 'premium') {
      lineItems.push(process.env.STRIPE_TRIAL_ACTIVATION_PRICE_ID
        ? { price: process.env.STRIPE_TRIAL_ACTIVATION_PRICE_ID, quantity: 1 }
        : {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: 100,
              product_data: { name: 'CREDITOS Premium trial activation' }
            }
          });
    }

    const customerField = profile.stripe_customer_id
      ? { customer: profile.stripe_customer_id }
      : { customer_email: req.user.email };
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      ...customerField,
      client_reference_id: req.user.id,
      line_items: lineItems,
      metadata: { plan, purpose: plan === 'premium' ? 'premium_trial' : 'plan_checkout' },
      subscription_data: {
        metadata: { plan, user_id: req.user.id },
        ...(plan === 'premium' ? { trial_end: trialEnd } : {})
      },
      ...(plan === 'premium' ? {
        custom_text: {
          submit: {
            message: `You pay $1 today for seven days of self-service Premium software access. Premium renews at $${(amount / 100).toFixed(0)}/month on ${new Date(trialEnd * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} unless canceled before renewal. No score increase or deletion is guaranteed.`
          }
        }
      } : {}),
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

// POST /api/credits/portal — open Stripe's self-service billing portal.
router.post('/portal', requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments are not configured on this server.' });
  try {
    const user = await findUser(req.user.id, null, req.user.email);
    if (!user?.stripe_customer_id) return res.status(404).json({ error: 'No Stripe billing account was found.' });
    const appUrl = process.env.APP_BASE_URL || process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${appUrl}/app.html?billing=return`
    });
    recordLaunchVerificationEvent({
      eventType: 'stripe_billing_portal_opened',
      provider: 'stripe',
      status: 'pass',
      userId: req.user.id,
      metadata: { customer_id: user.stripe_customer_id, return_url: `${appUrl}/app.html?billing=return` }
    }).catch(() => {});
    res.json({ url: session.url });
  } catch (e) {
    console.error('[billing portal]', e.message);
    res.status(500).json({ error: 'Could not open billing management. Please try again.' });
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

  recordLaunchVerificationEvent({
    eventType: 'stripe_webhook_received',
    provider: 'stripe',
    status: 'pass',
    metadata: { event_id: event.id, event_type: event.type }
  }).catch(() => {});

  const handler = EVENT_HANDLERS[event.type];
  if (!handler) {
    return res.json({ received: true, skipped: true, type: event.type });
  }

  try {
    const claimed = await claimStripeEvent(event);
    if (!claimed) return res.json({ received: true, duplicate: true, type: event.type });
    const result = await handler(event);
    await completeStripeEvent(event.id);
    res.json({ received: true, success: true, type: event.type, ...result });
  } catch (e) {
    await releaseStripeEvent(event.id);
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
