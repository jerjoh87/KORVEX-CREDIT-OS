# CREDITOS Stripe Live QA

Run this only with live Stripe credentials and a real test customer.

## Simple launch board

Legend:

- done = implemented and verified locally
- blocked by credentials = needs real live keys / Stripe account access
- blocked by schema/config = needs production webhook or redirect wiring

| Area | Status | Notes |
|---|---|---|
| Checkout flow | blocked by credentials | Needs live Stripe test keys and a real test customer. |
| Webhook signature verification | blocked by schema/config | Needs the production webhook endpoint and signing secret. |
| Subscription state updates | blocked by credentials | Requires a real test-mode payment event. |
| Duplicate event handling | done | The backend path is built to stay idempotent. |

## Live credential checks

- [ ] PASS - Stripe checkout test-mode payment succeeds and returns to the app.
- [ ] PASS - Stripe webhook event receipt is confirmed in the backend logs.
- [ ] PASS - Subscription state updates after payment without double-crediting.
- [ ] PASS - Duplicate webhook events are ignored or idempotent.
- [ ] BLOCKED - live Stripe test credentials are not available yet.

## Webhook and checkout checks

- [ ] `POST /api/credits/stripe` verifies the Stripe signature with the raw request body.
- [ ] `STRIPE_WEBHOOK_SECRET` is loaded from the server environment.
- [ ] Checkout success grants the expected plan or credits once.
- [ ] Premium Checkout charges $1 today, records `trialing`, and schedules the $99 renewal exactly seven days later.
- [ ] The one-time $1 invoice is classified as Premium from Checkout metadata, not as a low-dollar Starter purchase.
- [ ] Checkout cancel returns the user to the app without changing billing state.
- [ ] Failed payment flags the account but does not unlock paid access.
- [ ] Duplicate webhook deliveries do not double-credit the user.
- [ ] `invoice.paid` clears any failure flag safely.
- [ ] `customer.subscription.deleted` downgrades to free as expected.
- [ ] `customer.subscription.created` grants Premium trial access even if it arrives before `checkout.session.completed`.
- [ ] `customer.subscription.trial_will_end` creates the in-app renewal reminder.

## Manual test cases

- [ ] Checkout success.
- [ ] Checkout cancel.
- [ ] Failed payment.
- [ ] Duplicate webhook event.
- [ ] Customer portal access.
- [ ] Subscription cancellation, if subscriptions are enabled.
- [ ] Credit purchase, if credits are enabled.

## Safety checks

- [ ] Webhook errors are logged without leaking secrets.
- [ ] No paid feature unlocks happen on failed payment.
- [ ] The webhook endpoint rejects invalid signatures.
