const SYSTEM_RECIPIENTS = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    recipient_type: 'experian',
    recipient_name: 'Experian',
    department: 'Dispute Department',
    address_line_1: 'P.O. Box 4500',
    address_line_2: '',
    city: 'Allen',
    state: 'TX',
    postal_code: '75013',
    country: 'United States',
    is_default: true,
    is_active: true,
    is_system_recipient: true,
    notes: 'Verify bureau mailing addresses before live certified-mail use. Credit bureau addresses can change.',
    last_verified_at: null
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    recipient_type: 'equifax',
    recipient_name: 'Equifax',
    department: 'Dispute Department',
    address_line_1: 'P.O. Box 740256',
    address_line_2: '',
    city: 'Atlanta',
    state: 'GA',
    postal_code: '30374',
    country: 'United States',
    is_default: false,
    is_active: true,
    is_system_recipient: true,
    notes: 'Verify bureau mailing addresses before live certified-mail use. Credit bureau addresses can change.',
    last_verified_at: null
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    recipient_type: 'transunion',
    recipient_name: 'TransUnion',
    department: 'Dispute Department',
    address_line_1: 'P.O. Box 2000',
    address_line_2: '',
    city: 'Chester',
    state: 'PA',
    postal_code: '19016',
    country: 'United States',
    is_default: false,
    is_active: true,
    is_system_recipient: true,
    notes: 'Verify bureau mailing addresses before live certified-mail use. Credit bureau addresses can change.',
    last_verified_at: null
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    recipient_type: 'cfpb',
    recipient_name: 'Consumer Financial Protection Bureau',
    department: 'Consumer Response',
    address_line_1: 'P.O. Box 27170',
    address_line_2: '',
    city: 'Washington',
    state: 'DC',
    postal_code: '20038',
    country: 'United States',
    is_default: false,
    is_active: false,
    is_system_recipient: true,
    notes: 'Verify bureau mailing addresses before live certified-mail use. Credit bureau addresses can change.',
    last_verified_at: null
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    recipient_type: 'original_creditor',
    recipient_name: 'Original Creditor',
    department: '',
    address_line_1: '',
    address_line_2: '',
    city: '',
    state: '',
    postal_code: '',
    country: 'United States',
    is_default: false,
    is_active: false,
    is_system_recipient: true,
    notes: 'Template recipient. Replace with the specific creditor address before mailing.',
    last_verified_at: null
  },
  {
    id: '00000000-0000-4000-8000-000000000006',
    recipient_type: 'collection_agency',
    recipient_name: 'Collection Agency',
    department: '',
    address_line_1: '',
    address_line_2: '',
    city: '',
    state: '',
    postal_code: '',
    country: 'United States',
    is_default: false,
    is_active: false,
    is_system_recipient: true,
    notes: 'Template recipient. Replace with the specific collection agency address before mailing.',
    last_verified_at: null
  }
];

export const RECIPIENT_TYPES = [
  'experian',
  'equifax',
  'transunion',
  'cfpb',
  'original_creditor',
  'collection_agency',
  'custom'
];

export function getSystemRecipients() {
  return SYSTEM_RECIPIENTS.map(recipient => ({ ...recipient }));
}

export function normalizeRecipientAddress(address = {}) {
  return {
    recipient_name: String(address.recipient_name || address.recipientName || address.organization || address.name || '').trim(),
    department: String(address.department || '').trim(),
    address_line_1: String(address.address_line_1 || address.address1 || address.line1 || '').trim(),
    address_line_2: String(address.address_line_2 || address.address2 || address.line2 || '').trim(),
    city: String(address.city || '').trim(),
    state: String(address.state || '').trim(),
    postal_code: String(address.postal_code || address.postalCode || address.zip || address.zipCode || '').trim(),
    country: String(address.country || 'United States').trim() || 'United States',
    notes: String(address.notes || '').trim()
  };
}

export function recipientDisplayName(recipient = {}) {
  return recipient.recipient_name || recipient.department || recipient.recipient_type || 'Recipient';
}

export function recipientSnapshot(recipient = {}) {
  return {
    recipient_name: recipient.recipient_name || '',
    department: recipient.department || '',
    recipient_type: recipient.recipient_type || 'custom',
    address_line_1: recipient.address_line_1 || '',
    address_line_2: recipient.address_line_2 || '',
    city: recipient.city || '',
    state: recipient.state || '',
    postal_code: recipient.postal_code || '',
    country: recipient.country || 'United States',
    is_default: !!recipient.is_default,
    is_active: !!recipient.is_active,
    is_system_recipient: !!recipient.is_system_recipient,
    last_verified_at: recipient.last_verified_at || null,
    notes: recipient.notes || null,
    source: recipient.source || 'address_book'
  };
}

export function validateRecipientRecord(recipient, { requireAddress = true } = {}) {
  const record = normalizeRecipientAddress(recipient);
  const errors = [];

  if (!String(recipient.recipient_type || '').trim()) {
    errors.push('recipient_type is required.');
  } else if (!RECIPIENT_TYPES.includes(String(recipient.recipient_type).trim())) {
    errors.push(`recipient_type must be one of: ${RECIPIENT_TYPES.join(', ')}.`);
  }

  if (!record.recipient_name) errors.push('recipient_name is required.');
  if (!record.country) errors.push('country is required.');

  if (requireAddress) {
    if (!record.address_line_1) errors.push('address_line_1 is required.');
    if (!record.city) errors.push('city is required.');
    if (!record.state) errors.push('state is required.');
    if (!record.postal_code) errors.push('postal_code is required.');
    if (record.postal_code && !/^[A-Za-z0-9 -]{3,12}$/.test(record.postal_code)) {
      errors.push('postal_code format is invalid.');
    }
  }

  return { record, errors };
}

export function toRecipientBookRow(recipient, overrides = {}) {
  const normalized = normalizeRecipientAddress(recipient);
  return {
    id: recipient.id ?? overrides.id ?? null,
    recipient_type: String(recipient.recipient_type || overrides.recipient_type || 'custom').trim(),
    recipient_name: normalized.recipient_name,
    department: normalized.department,
    address_line_1: normalized.address_line_1,
    address_line_2: normalized.address_line_2,
    city: normalized.city,
    state: normalized.state,
    postal_code: normalized.postal_code,
    country: normalized.country,
    is_default: !!recipient.is_default,
    is_active: recipient.is_active !== false,
    is_system_recipient: !!recipient.is_system_recipient,
    last_verified_at: recipient.last_verified_at || null,
    notes: normalized.notes || null,
    organization_id: recipient.organization_id ?? overrides.organization_id ?? null,
    user_id: recipient.user_id ?? overrides.user_id ?? null,
    created_at: recipient.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}
