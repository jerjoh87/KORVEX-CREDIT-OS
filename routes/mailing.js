import { Router } from 'express';
import Stripe from 'stripe';
import { requireAuth, supabaseAdmin } from '../lib/server-state.js';
import { click2mailConfigured } from '../lib/click2mail.js';
import { createCertifiedMailPacket } from '../lib/mail-packet.js';
import { sendCertifiedMail } from '../lib/click2mail.js';

const router = Router();
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' })
  : null;

const MAIL_BUCKET = String(process.env.MAILING_BUCKET || 'mailing-docs').trim();
const MAIL_PACKET_BUCKET = String(process.env.MAIL_PACKET_BUCKET || 'mailing-packets').trim();

function serviceUnavailable(message) {
  const error = new Error(message);
  error.status = 503;
  return error;
}

async function ensureBucket() {
  if (!supabaseAdmin) throw serviceUnavailable('Mailing storage is unavailable.');
  const { data } = await supabaseAdmin.storage.listBuckets();
  if (data?.some(bucket => bucket.name === MAIL_BUCKET)) return;
  const { error } = await supabaseAdmin.storage.createBucket(MAIL_BUCKET, { public: false });
  if (error && !String(error.message || '').toLowerCase().includes('already exists')) {
    throw error;
  }
}

async function ensurePacketBucket() {
  if (!supabaseAdmin) throw serviceUnavailable('Mailing storage is unavailable.');
  const { data } = await supabaseAdmin.storage.listBuckets();
  if (data?.some(bucket => bucket.name === MAIL_PACKET_BUCKET)) return;
  const { error } = await supabaseAdmin.storage.createBucket(MAIL_PACKET_BUCKET, { public: false });
  if (error && !String(error.message || '').toLowerCase().includes('already exists')) {
    throw error;
  }
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

function normalizeAddress(address = {}) {
  return {
    firstName: String(address.firstName || address.firstname || '').trim(),
    lastName: String(address.lastName || address.lastname || '').trim(),
    organization: String(address.organization || address.name || '').trim(),
    address1: String(address.address1 || address.line1 || '').trim(),
    address2: String(address.address2 || address.line2 || '').trim(),
    city: String(address.city || '').trim(),
    state: String(address.state || '').trim(),
    postalCode: String(address.postalCode || address.zip || address.postal_code || '').trim(),
    country: String(address.country || 'United States').trim() || 'United States'
  };
}

function hasAddress(address) {
  return !!(address.address1 && address.city && address.state && address.postalCode);
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
  await ensurePacketBucket();
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

export async function finalizeCertifiedMailJob({ job, session }) {
  if (!job) throw new Error('Mail job not found.');
  if (job.status === 'mailed') {
    return { alreadyProcessed: true, jobId: job.id };
  }

  const profile = await getMailingProfile(job.user_id);
  const billingAddress = normalizeAddress(job.return_address || profile?.billingAddress || {});
  const recipientAddress = normalizeAddress(job.recipient_address || {});
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

  return {
    mailed: true,
    jobId: job.id,
    click2mail_job_id: sent.jobId,
    click2mail_document_id: sent.documentId
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

router.post('/upload-doc', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Mailing uploads are not configured.' });

  const docType = String(req.body?.docType || '').trim();
  const fileName = String(req.body?.fileName || 'document').trim().slice(0, 200);
  const mimeType = String(req.body?.mimeType || 'application/octet-stream').trim();
  const fileData = String(req.body?.fileData || '').trim();

  if (!docType) return res.status(400).json({ error: 'docType is required.' });
  if (!fileData) return res.status(400).json({ error: 'fileData is required.' });

  const base64 = fileData.includes(',') ? fileData.split(',').pop() : fileData;
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) return res.status(400).json({ error: 'File could not be read.' });
  if (bytes.length > 10 * 1024 * 1024) return res.status(413).json({ error: 'Identity documents must be under 10 MB each.' });

  try {
    await ensureBucket();
    const safeName = fileName.replace(/[^a-z0-9._-]/gi, '_');
    const path = `${req.user.id}/${docType}/${Date.now()}-${safeName}`;
    const { error } = await supabaseAdmin.storage.from(MAIL_BUCKET).upload(path, bytes, {
      contentType: mimeType,
      upsert: true
    });
    if (error) throw error;

    res.json({
      success: true,
      doc: {
        docType,
        fileName,
        mimeType,
        path,
        uploadedAt: new Date().toISOString()
      }
    });
  } catch (e) {
    console.error('[mailing/upload-doc]', e.message);
    res.status(500).json({ error: 'Could not save the identity document.' });
  }
});

router.post('/checkout', requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments are not configured on this server.' });
  if (!click2mailConfigured()) return res.status(503).json({ error: 'Click2Mail is not configured on this server.' });

  const letterText = String(req.body?.letterText || '').trim();
  const disputeId = req.body?.disputeId || null;
  const letterId = req.body?.letterId || null;
  const recipientAddress = normalizeAddress(req.body?.recipientAddress || {});
  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

  if (!letterText || letterText.length < 20) {
    return res.status(400).json({ error: 'A dispute letter is required before mailing.' });
  }

  if (!hasAddress(recipientAddress)) {
    return res.status(400).json({ error: 'Recipient mailing address is required.' });
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

    if (docs.length < 2) {
      return res.status(422).json({
        error: 'Upload at least your driver license and SSN card before mailing.'
      });
    }

    const { data: job, error: jobError } = await supabaseAdmin
      .from('mail_jobs')
      .insert({
        user_id: req.user.id,
        dispute_id: disputeId,
        letter_id: letterId,
        status: 'payment_pending',
        recipient_address: recipientAddress,
        return_address: billingAddress,
        supporting_docs: docs,
        letter_text: letterText,
        service_fee_cents: 1999,
        mailing_cost_cents: 550
      })
      .select('id')
      .single();

    if (jobError) throw jobError;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: req.user.email,
      client_reference_id: req.user.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: 1999,
            product_data: { name: 'CREDITOS Certified Mail Service' }
          }
        },
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: 550,
            product_data: { name: 'USPS Certified Mailing Cost' }
          }
        }
      ],
      allow_promotion_codes: false,
      success_url: `${appUrl}/app.html?mail=success&job=${job.id}`,
      cancel_url: `${appUrl}/app.html?mail=cancelled&job=${job.id}`,
      metadata: {
        purpose: 'certified_mail',
        mail_job_id: job.id
      }
    });

    const { error: updateError } = await supabaseAdmin
      .from('mail_jobs')
      .update({ stripe_session_id: session.id, updated_at: new Date().toISOString() })
      .eq('id', job.id);
    if (updateError) throw updateError;

    res.json({ url: session.url, mail_job_id: job.id });
  } catch (e) {
    console.error('[mailing/checkout]', e.message);
    res.status(e.status || 500).json({ error: e.message || 'Could not start certified mail checkout.' });
  }
});

export async function loadMailingPayload(userId) {
  const profile = await getMailingProfile(userId);
  if (!profile) return null;
  return {
    billingAddress: normalizeAddress(profile.billingAddress || {}),
    documents: Array.isArray(profile.documents) ? profile.documents : []
  };
}

export default router;
