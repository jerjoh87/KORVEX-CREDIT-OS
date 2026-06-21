import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSubscriptionBillingFields,
  getPlanFromCheckoutSession,
  hasPremiumAccess
} from '../lib/billing.js';
import {
  buildDeadlineAlerts,
  calculateDisputeDeadlines,
  inferResponseCategory,
  normalizeResponseAnalysis,
  normalizeResponseCategory
} from '../lib/bureau-response.js';

describe('Premium entitlement', () => {
  test('Premium and Business receive premium workflow access', () => {
    assert.equal(hasPremiumAccess('premium', 'trialing'), true);
    assert.equal(hasPremiumAccess('premium', 'active'), true);
    assert.equal(hasPremiumAccess('business', 'active'), true);
  });

  test('Pro is not treated as Premium and canceled Premium is closed', () => {
    assert.equal(hasPremiumAccess('pro', 'active'), false);
    assert.equal(hasPremiumAccess('premium', 'canceled'), false);
  });

  test('subscription dates support item-level current period end', () => {
    const fields = getSubscriptionBillingFields({
      id: 'sub_123',
      status: 'trialing',
      trial_start: 1_800_000_000,
      trial_end: 1_800_604_800,
      items: { data: [{ current_period_end: 1_800_604_800 }] }
    });
    assert.equal(fields.stripe_subscription_id, 'sub_123');
    assert.equal(fields.subscription_status, 'trialing');
    assert.equal(fields.next_bill_at, new Date(1_800_604_800 * 1000).toISOString());
  });

  test('$1 activation invoice still unlocks Premium from Checkout metadata', () => {
    const plan = getPlanFromCheckoutSession({
      amount_total: 100,
      metadata: { plan: 'premium', purpose: 'premium_trial' }
    });
    assert.deepEqual(plan, { plan: 'premium', credits: 999 });
  });
});

describe('30/45-day dispute timeline', () => {
  test('delivery date is the preferred deadline anchor', () => {
    const deadlines = calculateDisputeDeadlines({
      sentAt: '2026-06-01T12:00:00.000Z',
      deliveredAt: '2026-06-04T12:00:00.000Z'
    });
    assert.equal(deadlines.anchorAt, '2026-06-04T12:00:00.000Z');
    assert.equal(deadlines.standardDueAt, '2026-07-04T12:00:00.000Z');
    assert.equal(deadlines.maxDueAt, '2026-07-19T12:00:00.000Z');
  });

  test('sent date is used when delivery is unavailable', () => {
    const deadlines = calculateDisputeDeadlines({ sentAt: '2026-06-01T12:00:00.000Z' });
    assert.equal(deadlines.standardDueAt, '2026-07-01T12:00:00.000Z');
    assert.equal(deadlines.maxDueAt, '2026-07-16T12:00:00.000Z');
  });

  test('alert schedule contains day 21, 30, 38, and 45', () => {
    const alerts = buildDeadlineAlerts('round-1', { sentAt: '2026-06-01T00:00:00.000Z' });
    assert.deepEqual(alerts.map(alert => alert.metadata.day), [21, 30, 38, 45]);
    assert.equal(alerts[3].alert_date, '2026-07-16T00:00:00.000Z');
  });
});

describe('Bureau response normalization', () => {
  test('maps bureau wording to the supported category set', () => {
    assert.equal(normalizeResponseCategory('Verified as accurate'), 'verified');
    assert.equal(normalizeResponseCategory('Frivolous / irrelevant'), 'frivolous_or_irrelevant');
    assert.equal(normalizeResponseCategory('No clear result detected'), 'unclear');
  });

  test('preliminary classifier recognizes common response outcomes', () => {
    assert.equal(inferResponseCategory('The account was deleted from your file.'), 'deleted');
    assert.equal(inferResponseCategory('We verified this account as accurate.'), 'verified');
    assert.equal(inferResponseCategory('We need additional documentation.'), 'needs_more_information');
  });

  test('normalizes account actions and clamps confidence', () => {
    const analysis = normalizeResponseAnalysis({
      bureau: 'Trans Union',
      overall_category: 'verified_as_accurate',
      confidence_score: 180,
      accounts: [{ account_name: 'Example Bank', account_last4: 'xx-4821', result: 'verified' }]
    });
    assert.equal(analysis.bureau, 'TransUnion');
    assert.equal(analysis.overall_category, 'verified');
    assert.equal(analysis.confidence_score, 100);
    assert.equal(analysis.accounts[0].account_last4, '4821');
    assert.equal(analysis.recommended_letter_type, 'method_of_verification');
  });
});
