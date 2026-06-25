import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import Stripe from 'stripe';
import { requireAuth, supabaseAdmin } from '../lib/server-state.js';
import { isMissingSchemaError, withTimeout } from '../lib/supabase-errors.js';
import { click2mailConfigured, sendCertifiedMail } from '../lib/click2mail.js';
import { createCertifiedMailPacket } from '../lib/mail-packet.js';
import {
  getSystemRecipients,
  normalizeRecipientAddress,
  recipientDisplayName,
  recipientSnapshot,
  toRecipientBookRow,
  validateRecipientRecord
} from '../lib/recipient-address-book.js';
import { recordLaunchVerificationEvent } from '../lib/launch-verification.js';

const router = Router();
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' })
  : null;

const MAIL_BUCKET = String(process.env.MAILING_BUCKET || 'mailing-docs').trim();
const MAIL_PACKET_BUCKET = String(process.env.MAIL_PACKET_BUCKET || 'mailing-packets').trim();
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);

function serviceUnavailable(message) {
  const error = new Error(message);
  error.status = 503;
  return error;
}

function normalizeAddress(address = {}) {
  return {
    firstName: String(address.firstName || address.firstname || '').trim(),
    lastName: String(address.lastName || address.lastname || '').trim(),
    organization: String(address.organization || address.name || address.recipient_name || '').trim(),
    department: String(address.department || '').trim(),
    address1: String(address.address1 || address.address_line_1 || address.line1 || '').trim(),
    address2: String(address.address2 || address.address_line_2 || address.line2 || '').trim(),
    city: String(address.city || '').trim(),
    state: String(address.state || '').trim(),
    postalCode: String(address.postalCode || address.postal_code || address.zip || '').trim(),
    country: String(address.country || 'United States').trim() || 'United States'
  };
}

function hasAddress(address) {
  return !!(address.address1 && address.city && address.state && address.postalCode);
}

function isZipValid(zip) {
  return /^[A-Za-z0-9 -]{3,12}$/.test(String(zip || '').trim());
}

async function ensureBucket(bucketName) {
  if (!supabaseAdmin) throw serviceUnavailable('Mailing storage is unavailable.');
  const { data } = await supabaseAdmin.storage.listBuckets();
  if (data?.some(bucket => bucket.name === bucketName)) return;
  const { error } = await supabaseAdmin.storage.createBucket(bucketName, { public: false });
  if (error && !String(error.message || '').toLowerCase().includes('already exists')) throw error;
}

async function getMailingProfile(userId) {
  const { data, error } = await supabaseAdmin
    .from('user_state')
    .select('state')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.state?.mailingProfile || null;
}

async function isAdminUser(userId) {
  const { data, error } = await withTimeout(supabaseAdmin
    .from('profiles')
    .select('is_admin,email')
    .eq('id', userId)
    .maybeSingle(), 8000, 'Mailing admin lookup timed out.');
  if (error) {
    if (isMissingSchemaError(error)) return false;
    throw error;
  }
  if (data?.is_admin) return true;
  if (data?.email && ADMIN_EMAILS.includes(String(data.email).toLowerCase())) return true;
  return false;
}

function normalizeBookRow(row = {}) {
  const normalized = normalizeRecipientAddress(row);
  return {
    id: row.id || null,
    organization_id: row.organization_id ?? null,
    user_id: row.user_id ?? null,
    recipient_type: String(row.recipient_type || 'custom').trim(),
    recipient_name: normalized.recipient_name || row.recipient_name || '',
    department: normalized.department || row.department || '',
    address_line_1: normalized.address_line_1 || row.address_line_1 || '',
    address_line_2: normalized.address_line_2 || row.address_line_2 || '',
    city: normalized.city || row.city || '',
    state: normalized.state || row.state || '',
    postal_code: normalized.postal_code || row.postal_code || '',
    country: normalized.country || row.country || 'United States',
    is_default: !!row.is_default,
    is_active: row.is_active !== false,
    is_system_recipient: !!row.is_system_recipient,
    last_verified_at: row.last_verified_at || null,
    notes: row.notes || '',
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

async function seedSystemRecipients() {
  if (!supabaseAdmin) return [];
  const rows = getSystemRecipients().map(recipient =>
    toRecipientBookRow(recipient, { id: recipient.id, user_id: null, organization_id: null })
  );
  const { error } = await withTimeout(supabaseAdmin
    .from('recipient_address_book')
    .upsert(rows, { onConflict: 'id' }), 8000, 'Recipient address book seed timed out.');
  if (error) {
    if (isMissingSchemaError(error)) return rows;
    throw error;
  }
  return rows;
}

async function loadRecipients(userId, { includeInactive = false, adminView = false } = {}) {
  const systemFallback = await seedSystemRecipients();
  const { data, error } = await withTimeout(supabaseAdmin
    .from('recipient_address_book')
    .select('*')
    .order('is_system_recipient', { ascending: false })
    .order('is_default', { ascending: false })
    .order('recipient_name', { ascending: true }), 8000, 'Recipient address book lookup timed out.');
  if (error) {
    if (isMissingSchemaError(error)) {
      return systemFallback.map(normalizeBookRow).filter(row => includeInactive || row.is_active);
    }
    throw error;
  }

  return (data || [])
    .map(normalizeBookRow)
    .filter(row => {
      if (row.is_system_recipient) return includeInactive || row.is_active;
      if (adminView) return includeInactive || row.is_active;
      return row.is_active && (row.organization_id === userId || row.user_id === userId);
    });
}

async function getRecipientById(id) {
  const { data, error } = await withTimeout(supabaseAdmin
    .from('recipient_address_book')
    .select('*')
    .eq('id', id)
    .maybeSingle(), 8000, 'Recipient lookup timed out.');
  if (error) {
    if (isMissingSchemaError(error)) {
      const system = getSystemRecipients()
        .map(recipient => toRecipientBookRow(recipient, { id: recipient.id, user_id: null, organization_id: null }))
        .find(row => row.id === id);
      return system ? normalizeBookRow(system) : null;
    }
    throw error;
  }
  return data ? normalizeBookRow(data) : null;
}

async function assertRecipientAccess(userId, recipient, { adminOverride = false } = {}) {
  if (!recipient) {
    const error = new Error('Recipient not found.');
    error.status = 404;
    throw error;
  }

  if (recipient.is_system_recipient) {
    if (!adminOverride) {
      const error = new Error('You do not have permission to edit system recipients.');
      error.status = 403;
      throw error;
    }
    return true;
  }

  if (recipient.organization_id && recipient.organization_id !== userId) {
    const error = new Error('You do not have permission to edit this recipient.');
    error.status = 403;
    throw error;
  }

  if (recipient.user_id && recipient.user_id !== userId) {
    const error = new Error('You do not have permission to edit this recipient.');
    error.status = 403;
    throw error;
  }

  return true;
}

async function ensureVerifiedDefaults() {
  await seedSystemRecipients();
}

async function downloadDocument(doc) {
  if (!doc?.path) return null;
  const { data, error } = await supabaseAdmin.storage.from(MAIL_BUCKET).download(doc.path);
  if (error) throw error;
  if (!data) return null;
  const mimeType = String(doc.mimeType || data.type || 'application/octet-stream');
  const bytes = Buffer.from(await data.arrayBuffer());
  return {
    bytes,
    mimeType,
    fileName: doc.fileName || doc.path.split('/').pop() || 'document',
    docType: doc.docType || 'supporting'
  };
}

async function uploadPacket(jobId, packetBytes) {
  await ensureBucket(MAIL_PACKET_BUCKET);
  const path = `${jobId}/creditos-certified-mail-packet.pdf`;
  const { error } = await supabaseAdmin.storage.from(MAIL_PACKET_BUCKET).upload(path, packetBytes, {
    contentType: 'application/pdf',
    upsert: true
  });
  if (error) throw error;
  return path;
}

async function updateMailJob(jobId, fields) {
  const { error } = await supabaseAdmin
    .from('mail_jobs')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) throw error;
}

async function updateLinkedDispute(job) {
  if (!job?.dispute_id) return;
  const { error } = await supabaseAdmin
    .from('disputes')
    .update({
      status: 'mailed',
      mailed_at: new Date().toISOString()
    })
    .eq('id', job.dispute_id);
  if (error) throw error;
}

async function resolveRecipientSelection(userId, selection = {}) {
  if (selection.recipient_address_book_id) {
    const bookRow = await getRecipientById(selection.recipient_address_book_id);
    if (!bookRow) {
      const error = new Error('Selected recipient was not found.');
      error.status = 404;
      throw error;
    }

    const adminOverride = await isAdminUser(userId);
    await assertRecipientAccess(userId, bookRow, { adminOverride });

    if (bookRow.is_active === false) {
      const error = new Error('Selected recipient is inactive.');
      error.status = 422;
      throw error;
    }

    return {
      kind: 'book',
      bookRow,
      address: normalizeAddress(bookRow),
      snapshot: recipientSnapshot(bookRow)
    };
  }

  if (selection.custom_recipient_address) {
    const custom = normalizeRecipientAddress(selection.custom_recipient_address);
    const validation = validateRecipientRecord({
      recipient_type: String(selection.recipient_type || 'custom').trim() || 'custom',
      recipient_name: custom.recipient_name || custom.organization || '',
      department: custom.department,
      address_line_1: custom.address_line_1,
      address_line_2: custom.address_line_2,
      city: custom.city,
      state: custom.state,
      postal_code: custom.postal_code,
      country: custom.country
    }, { requireAddress: true });

    if (validation.errors.length) {
      const error = new Error(validation.errors[0]);
      error.status = 422;
      throw error;
    }

    const customRow = {
      recipient_type: 'custom',
      recipient_name: custom.recipient_name || custom.organization || 'Custom recipient',
      department: custom.department || '',
      address_line_1: custom.address_line_1,
      address_line_2: custom.address_line_2,
      city: custom.city,
      state: custom.state,
      postal_code: custom.postal_code,
      country: custom.country,
      is_default: false,
      is_active: true,
      is_system_recipient: false,
      notes: custom.notes || null,
      organization_id: userId,
      user_id: userId
    };

    return {
      kind: 'custom',
      address: normalizeAddress(customRow),
      snapshot: recipientSnapshot(customRow),
      customRow
    };
  }

  const error = new Error('Recipient address is required.');
  error.status = 400;
  throw error;
}

async function finalizeSingleMailJob(job, session) {
  if (!job) throw new Error('Mail job not found.');
  if (job.status === 'mailed') {
    return { alreadyProcessed: true, jobId: job.id };
  }

  const profile = await getMailingProfile(job.user_id);
  const billingAddress = normalizeAddress(job.return_address || profile?.billingAddress || {});
  const recipientAddress = normalizeAddress(job.recipient_snapshot_json || job.recipient_address || {});
  const docs = Array.isArray(job.supporting_docs) ? job.supporting_docs : [];

  if (!hasAddress(billingAddress)) {
    throw new Error('Billing address is missing from the mailing profile.');
  }
  if (!hasAddress(recipientAddress)) {
    throw new Error('Recipient mailing address is missing.');
  }

  const supportDocs = [];
  for (const doc of docs) {
    const downloaded = await downloadDocument(doc);
    if (downloaded) supportDocs.push(downloaded);
  }

  const packetBytes = await createCertifiedMailPacket({
    letterText: job.letter_text,
    billingAddress,
    recipientAddress,
    supportDocs
  });

  recordLaunchVerificationEvent({
    eventType: 'click2mail_packet_generated',
    provider: 'click2mail',
    status: 'pass',
    userId: job.user_id,
    metadata: { job_id: job.id, dispute_id: job.dispute_id || null }
  }).catch(() => {});

  const packetPath = await uploadPacket(job.id, packetBytes);
  const sent = await sendCertifiedMail({
    packetBytes,
    recipientAddress,
    returnAddress: billingAddress
  });

  await updateMailJob(job.id, {
    status: 'mailed',
    packet_path: packetPath,
    click2mail_document_id: sent.documentId,
    click2mail_address_list_id: sent.addressListId,
    click2mail_job_id: sent.jobId,
    error: null,
    mailed_at: new Date().toISOString()
  });

  await updateLinkedDispute(job);

  recordLaunchVerificationEvent({
    eventType: 'click2mail_tracking_status_received',
    provider: 'click2mail',
    status: 'pass',
    userId: job.user_id,
    metadata: {
      job_id: job.id,
      click2mail_job_id: sent.jobId,
      click2mail_document_id: sent.documentId
    }
  }).catch(() => {});

  return {
    mailed: true,
    jobId: job.id,
    click2mail_job_id: sent.jobId,
    click2mail_document_id: sent.documentId
  };
}

export async function finalizeCertifiedMailJob({ job, session }) {
  return finalizeSingleMailJob(job, session);
}

async function createMailJobsForSelection({ userId, disputeId, letterId, letterText, billingAddress, selections }) {
  const batchId = randomUUID();
  const rows = selections.map((selection, index) => ({
    user_id: userId,
    dispute_id: disputeId,
    letter_id: letterId,
    mail_batch_id: batchId,
    mail_batch_index: index + 1,
    status: 'payment_pending',
    recipient_address_book_id: selection.bookRow?.id || null,
    recipient_address: selection.address,
    recipient_snapshot_json: selection.snapshot,
    return_address: billingAddress,
    supporting_docs: selection.supportingDocs || [],
    letter_text: letterText,
    service_fee_cents: 1999,
    mailing_cost_cents: 550
  }));

  const { data, error } = await supabaseAdmin
    .from('mail_jobs')
    .insert(rows)
    .select('id, mail_batch_id, recipient_snapshot_json');
  if (error) throw error;

  recordLaunchVerificationEvent({
    eventType: 'click2mail_certified_mail_job_created',
    provider: 'click2mail',
    status: 'pass',
    userId: userId,
    metadata: {
      batch_id: batchId,
      job_count: rows.length,
      dispute_id: disputeId || null,
      letter_id: letterId || null
    }
  }).catch(() => {});

  return { batchId, jobs: data || [] };
}

function recipientSummaryFromSelection(selection) {
  return {
    recipient_name: selection.snapshot?.recipient_name || '',
    recipient_type: selection.snapshot?.recipient_type || 'custom',
    address_line_1: selection.snapshot?.address_line_1 || '',
    address_line_2: selection.snapshot?.address_line_2 || '',
    city: selection.snapshot?.city || '',
    state: selection.snapshot?.state || '',
    postal_code: selection.snapshot?.postal_code || '',
    country: selection.snapshot?.country || 'United States'
  };
}

router.get('/profile', requireAuth, async (req, res) => {
  try {
    const profile = await getMailingProfile(req.user.id);
    res.json({ success: true, profile });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/recipients', requireAuth, async (req, res) => {
  try {
    await ensureVerifiedDefaults();
    const adminView = await isAdminUser(req.user.id);
    const includeInactive = String(req.query.includeInactive || '') === '1';
    const recipients = await loadRecipients(req.user.id, { includeInactive, adminView });
    res.json({
      success: true,
      canManageSystem: adminView,
      recipients,
      groups: {
        saved: recipients.filter(r => !r.is_system_recipient),
        system: recipients.filter(r => r.is_system_recipient)
      },
      adminWarning: 'Verify bureau mailing addresses before live certified-mail use. Credit bureau addresses can change.'
    });
  } catch (e) {
    console.error('[mailing/recipients:get]', e.message);
    res.status(e.status || 500).json({ error: e.message || 'Address book unavailable.' });
  }
});

router.post('/recipients', requireAuth, async (req, res) => {
  try {
    const adminView = await isAdminUser(req.user.id);
    const input = req.body || {};
    const recipient_type = String(input.recipient_type || input.recipientType || 'custom').trim() || 'custom';
    const validation = validateRecipientRecord({
      recipient_type,
      recipient_name: input.recipient_name || input.recipientName,
      department: input.department,
      address_line_1: input.address_line_1 || input.addressLine1,
      address_line_2: input.address_line_2 || input.addressLine2,
      city: input.city,
      state: input.state,
      postal_code: input.postal_code || input.postalCode,
      country: input.country,
      notes: input.notes
    }, { requireAddress: true });

    if (validation.errors.length) {
      return res.status(422).json({ error: validation.errors[0] });
    }

    const isSystemRecipient = !!input.is_system_recipient || !!input.isSystemRecipient;
    if (isSystemRecipient && !adminView) {
      return res.status(403).json({ error: 'Only admins can manage system recipients.' });
    }

    const row = toRecipientBookRow({
      recipient_type: isSystemRecipient ? recipient_type : 'custom',
      recipient_name: validation.record.recipient_name,
      department: validation.record.department,
      address_line_1: validation.record.address_line_1,
      address_line_2: validation.record.address_line_2,
      city: validation.record.city,
      state: validation.record.state,
      postal_code: validation.record.postal_code,
      country: validation.record.country,
      is_default: !!input.is_default,
      is_active: input.is_active !== false,
      is_system_recipient: isSystemRecipient,
      last_verified_at: input.last_verified_at || input.lastVerifiedAt || null,
      notes: validation.record.notes || null,
      organization_id: isSystemRecipient ? null : req.user.id,
      user_id: isSystemRecipient ? null : req.user.id
    }, {
      user_id: isSystemRecipient ? null : req.user.id,
      organization_id: isSystemRecipient ? null : req.user.id
    });

    const { data, error } = await supabaseAdmin
      .from('recipient_address_book')
      .insert(row)
      .select('*')
      .single();
    if (error) throw error;

    res.json({ success: true, recipient: normalizeBookRow(data) });
  } catch (e) {
    console.error('[mailing/recipients:post]', e.message);
    res.status(e.status || 500).json({ error: e.message || 'Could not save recipient.' });
  }
});

router.patch('/recipients/:id', requireAuth, async (req, res) => {
  try {
    const recipient = await getRecipientById(req.params.id);
    const adminView = await isAdminUser(req.user.id);
    await assertRecipientAccess(req.user.id, recipient, { adminOverride: adminView });

    const input = req.body || {};
    const merged = {
      ...recipient,
      ...input,
      recipient_type: String(input.recipient_type || recipient.recipient_type || 'custom').trim(),
      recipient_name: input.recipient_name ?? input.recipientName ?? recipient.recipient_name,
      department: input.department ?? recipient.department,
      address_line_1: input.address_line_1 ?? input.addressLine1 ?? recipient.address_line_1,
      address_line_2: input.address_line_2 ?? input.addressLine2 ?? recipient.address_line_2,
      city: input.city ?? recipient.city,
      state: input.state ?? recipient.state,
      postal_code: input.postal_code ?? input.postalCode ?? recipient.postal_code,
      country: input.country ?? recipient.country,
      notes: input.notes ?? recipient.notes,
      is_default: input.is_default ?? recipient.is_default,
      is_active: input.is_active ?? recipient.is_active,
      last_verified_at: input.last_verified_at ?? input.lastVerifiedAt ?? recipient.last_verified_at
    };

    const validation = validateRecipientRecord(merged, { requireAddress: true });
    if (validation.errors.length) return res.status(422).json({ error: validation.errors[0] });

    const update = {
      recipient_type: merged.recipient_type,
      recipient_name: validation.record.recipient_name,
      department: validation.record.department,
      address_line_1: validation.record.address_line_1,
      address_line_2: validation.record.address_line_2,
      city: validation.record.city,
      state: validation.record.state,
      postal_code: validation.record.postal_code,
      country: validation.record.country,
      is_default: !!merged.is_default,
      is_active: merged.is_active !== false,
      last_verified_at: merged.last_verified_at || null,
      notes: validation.record.notes || null,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabaseAdmin
      .from('recipient_address_book')
      .update(update)
      .eq('id', recipient.id)
      .select('*')
      .single();
    if (error) throw error;

    res.json({ success: true, recipient: normalizeBookRow(data) });
  } catch (e) {
    console.error('[mailing/recipients:patch]', e.message);
    res.status(e.status || 500).json({ error: e.message || 'Could not update recipient.' });
  }
});

router.delete('/recipients/:id', requireAuth, async (req, res) => {
  try {
    const recipient = await getRecipientById(req.params.id);
    const adminView = await isAdminUser(req.user.id);
    await assertRecipientAccess(req.user.id, recipient, { adminOverride: adminView });

    if (recipient.is_system_recipient) {
      const { error } = await supabaseAdmin
        .from('recipient_address_book')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', recipient.id);
      if (error) throw error;
      return res.json({ success: true, recipient: { ...recipient, is_active: false } });
    }

    const { error } = await supabaseAdmin
      .from('recipient_address_book')
      .delete()
      .eq('id', recipient.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error('[mailing/recipients:delete]', e.message);
    res.status(e.status || 500).json({ error: e.message || 'Could not delete recipient.' });
  }
});

router.post('/checkout', requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments are not configured on this server.' });
  if (!click2mailConfigured()) return res.status(503).json({ error: 'Click2Mail is not configured on this server.' });

  const letterText = String(req.body?.letterText || '').trim();
  const disputeId = req.body?.disputeId || null;
  const letterId = req.body?.letterId || null;
  const appUrl = process.env.APP_BASE_URL || process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const saveCustomRecipient = !!req.body?.save_custom_recipient || !!req.body?.saveCustomRecipient;
  const recipientMode = String(req.body?.recipient_mode || req.body?.recipientMode || 'single').trim();

  if (!letterText || letterText.length < 20) {
    return res.status(400).json({ error: 'A dispute letter is required before mailing.' });
  }

  try {
    const profile = await getMailingProfile(req.user.id);
    const billingAddress = normalizeAddress(profile?.billingAddress || {});
    const docs = Array.isArray(profile?.documents) ? profile.documents : [];

    if (!hasAddress(billingAddress)) {
      return res.status(422).json({
        error: 'Add your billing address in the mailing profile before using Click2Mail.'
      });
    }

    const docTypes = new Set(docs.map(doc => String(doc?.docType || '').toLowerCase()));
    if (!docTypes.has('driver_license') || !docTypes.has('ssn_card') || !docTypes.has('proof_of_address')) {
      return res.status(422).json({
        error: 'Upload your driver license, SSN card, and proof of address before mailing.'
      });
    }

    const selections = [];
    if (recipientMode === 'all_three') {
      const allThree = ['experian', 'equifax', 'transunion'];
      for (const recipient_type of allThree) {
        const recipient_address_book_id = req.body?.[`recipient_${recipient_type}_id`] || req.body?.recipient_address_book_id;
        const selection = await resolveRecipientSelection(req.user.id, {
          recipient_address_book_id,
          custom_recipient_address: req.body?.custom_recipient_address || req.body?.customRecipientAddress,
          recipient_type
        });
        selections.push({
          ...selection,
          supportingDocs: docs
        });
      }
    } else {
      const selection = await resolveRecipientSelection(req.user.id, {
        recipient_address_book_id: req.body?.recipient_address_book_id || req.body?.recipientAddressBookId,
        custom_recipient_address: req.body?.custom_recipient_address || req.body?.customRecipientAddress,
        recipient_type: req.body?.recipient_type || req.body?.recipientType || 'custom'
      });

      selections.push({ ...selection, supportingDocs: docs });

      if (saveCustomRecipient && selection.kind === 'custom' && selection.customRow) {
        const { error: insertError } = await supabaseAdmin
          .from('recipient_address_book')
          .insert({
            ...selection.customRow,
            organization_id: req.user.id,
            user_id: req.user.id
          });
        if (insertError) console.warn('[mailing/recipients] Could not save custom recipient:', insertError.message);
      }
    }

    const totalRecipients = selections.length;
    const { batchId, jobs } = await createMailJobsForSelection({
      userId: req.user.id,
      disputeId,
      letterId,
      letterText,
      billingAddress,
      selections
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: req.user.email,
      client_reference_id: req.user.id,
      line_items: [
        {
          quantity: totalRecipients,
          price_data: {
            currency: 'usd',
            unit_amount: 1999,
            product_data: { name: 'CREDITOS Certified Mail Service' }
          }
        },
        {
          quantity: totalRecipients,
          price_data: {
            currency: 'usd',
            unit_amount: 550,
            product_data: { name: 'USPS Certified Mailing Cost' }
          }
        }
      ],
      allow_promotion_codes: false,
      success_url: `${appUrl}/app.html?mail=success&batch=${batchId}`,
      cancel_url: `${appUrl}/app.html?mail=cancelled&batch=${batchId}`,
      metadata: {
        purpose: 'certified_mail',
        mail_batch_id: batchId,
        mail_job_id: jobs[0]?.id || '',
        recipient_count: String(totalRecipients)
      }
    });

    const { error: updateError } = await supabaseAdmin
      .from('mail_jobs')
      .update({ stripe_session_id: session.id, updated_at: new Date().toISOString() })
      .eq('mail_batch_id', batchId);
    if (updateError) throw updateError;

    res.json({
      url: session.url,
      mail_job_id: jobs[0]?.id || null,
      mail_job_ids: jobs.map(job => job.id),
      mail_batch_id: batchId,
      recipients: selections.map(recipientSummaryFromSelection)
    });
  } catch (e) {
    console.error('[mailing/checkout]', e.message);
    res.status(e.status || 500).json({ error: e.message || 'Could not start certified mail checkout.' });
  }
});

export async function loadMailingPayload(userId) {
  const profile = await getMailingProfile(userId);
  if (!profile) return null;
  const adminView = await isAdminUser(userId).catch(() => false);
  const recipients = await loadRecipients(userId, { adminView }).catch(() => []);
  return {
    billingAddress: normalizeAddress(profile.billingAddress || {}),
    documents: Array.isArray(profile.documents) ? profile.documents : [],
    recipients
  };
}

export async function finalizeCertifiedMailBatch(batchId) {
  const { data: jobs, error } = await supabaseAdmin
    .from('mail_jobs')
    .select('*')
    .eq('mail_batch_id', batchId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const results = [];
  for (const job of jobs || []) {
    results.push(await finalizeSingleMailJob(job));
  }
  return results;
}

export default router;
