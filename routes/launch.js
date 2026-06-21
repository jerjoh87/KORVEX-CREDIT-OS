import { Router } from 'express';
import { requireAuth } from '../lib/server-state.js';
import {
  LAUNCH_VERIFICATION_CHECKS,
  isLaunchVerificationAdmin,
  loadLaunchVerificationDashboard,
  recordLaunchVerificationEvent
} from '../lib/launch-verification.js';

const router = Router();

router.post('/verification/events', requireAuth, async (req, res) => {
  try {
    const eventType = String(req.body?.event_type || req.body?.eventType || '').trim().toLowerCase();
    const provider = String(req.body?.provider || 'system').trim().toLowerCase();
    const status = String(req.body?.status || 'pass').trim().toLowerCase();
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};

    const allowed = new Set([
      ...LAUNCH_VERIFICATION_CHECKS.flatMap(check => check.eventTypes),
      'stripe_billing_portal_opened'
    ]);

    if (!allowed.has(eventType)) {
      return res.status(400).json({ error: 'Unsupported launch verification event.' });
    }

    const row = await recordLaunchVerificationEvent({
      eventType,
      provider,
      status,
      userId: req.user.id,
      metadata
    });

    if (!row) return res.status(503).json({ error: 'Launch verification storage is unavailable.' });

    res.json({ success: true });
  } catch (e) {
    console.error('[launch verification:event]', e.message);
    res.status(e.status || 500).json({ error: e.message || 'Could not store launch verification event.' });
  }
});

router.get('/verification/dashboard', requireAuth, async (req, res) => {
  try {
    const admin = await isLaunchVerificationAdmin(req.user.id);
    if (!admin) {
      return res.status(403).json({ error: 'Admin access required.' });
    }

    const dashboard = await loadLaunchVerificationDashboard(req.user.id);
    res.json({ success: true, ...dashboard });
  } catch (e) {
    console.error('[launch verification:dashboard]', e.message);
    res.status(e.status || 500).json({ error: e.message || 'Could not load launch verification dashboard.' });
  }
});

export default router;
