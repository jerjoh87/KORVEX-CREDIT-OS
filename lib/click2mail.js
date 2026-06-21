const DEFAULT_BASE_URL = 'https://rest.click2mail.com/molpro';

function cleanBaseUrl() {
  return String(process.env.CLICK2MAIL_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

function getCredentials() {
  const username = String(process.env.CLICK2MAIL_USERNAME || '').trim();
  const password = String(process.env.CLICK2MAIL_PASSWORD || '').trim();
  return { username, password };
}

export function click2mailConfigured() {
  const { username, password } = getCredentials();
  return !!username && !!password;
}

function authHeader() {
  const { username, password } = getCredentials();
  if (!username || !password) return null;
  const encoded = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${encoded}`;
}

async function request(path, { method = 'POST', headers = {}, body } = {}) {
  const auth = authHeader();
  if (!auth) {
    const error = new Error('Click2Mail is not configured.');
    error.status = 503;
    throw error;
  }

  const res = await fetch(`${cleanBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: auth,
      'User-Agent': 'CREDITOS/1.0',
      ...headers
    },
    body
  });

  const text = await res.text();
  if (!res.ok) {
    const error = new Error(`Click2Mail API error (${res.status})`);
    error.status = res.status;
    error.details = text;
    throw error;
  }
  return text;
}

function parseId(xml) {
  const match = String(xml || '').match(/<id>([^<]+)<\/id>/i);
  return match?.[1] || null;
}

export function buildAddressXml(address, listName = 'CREDITOS Certified Mail') {
  const safe = v => String(v || '').trim();
  return [
    '<addressList>',
    `<addressListName>${escapeXml(listName)}</addressListName>`,
    '<addressMappingId>1</addressMappingId>',
    '<addresses>',
    '<address>',
    `<Firstname>${escapeXml(safe(address.firstName || address.firstname || address.first_name))}</Firstname>`,
    `<Lastname>${escapeXml(safe(address.lastName || address.lastname || address.last_name))}</Lastname>`,
    `<Organization>${escapeXml(safe(address.organization || address.name || address.recipientName))}</Organization>`,
    `<Address1>${escapeXml(safe(address.address1 || address.line1))}</Address1>`,
    `<Address2>${escapeXml(safe(address.address2 || address.line2))}</Address2>`,
    '<Address3></Address3>',
    `<City>${escapeXml(safe(address.city))}</City>`,
    `<State>${escapeXml(safe(address.state))}</State>`,
    `<Postalcode>${escapeXml(safe(address.postalCode || address.zip || address.postal_code))}</Postalcode>`,
    `<Country>${escapeXml(safe(address.country || 'United States'))}</Country>`,
    '</address>',
    '</addresses>',
    '</addressList>'
  ].join('');
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function uploadDocument({ documentName, documentFormat = 'PDF', documentClass = 'Letter 8.5 x 11', fileBytes, fileName = 'packet.pdf' }) {
  const form = new FormData();
  form.append('documentName', documentName || 'CREDITOS Certified Mail Packet');
  form.append('documentFormat', documentFormat);
  form.append('documentClass', documentClass);
  form.append('file', new Blob([fileBytes], { type: 'application/pdf' }), fileName);

  const text = await request('/documents', { body: form });
  return { raw: text, documentId: parseId(text) };
}

export async function uploadAddressList(address, listName = 'CREDITOS Certified Mail') {
  const xml = buildAddressXml(address, listName);
  const text = await request('/addressLists', {
    headers: { Accept: 'application/xml', 'Content-Type': 'application/xml' },
    body: xml
  });
  return { raw: text, addressListId: parseId(text) };
}

export async function createJob({
  documentId,
  addressListId,
  documentClass = 'Letter 8.5 x 11',
  layout = 'Address on Separate Page',
  productionTime = 'Next Day',
  envelope = '#10 Double Window',
  color = 'Black and White',
  paperType = 'White 24#',
  printOption = 'Printing One side'
}) {
  const form = new FormData();
  form.append('documentClass', documentClass);
  form.append('layout', layout);
  form.append('productionTime', productionTime);
  form.append('envelope', envelope);
  form.append('color', color);
  form.append('paperType', paperType);
  form.append('printOption', printOption);
  form.append('documentId', String(documentId));
  form.append('addressId', String(addressListId));

  const text = await request('/jobs', { body: form });
  return { raw: text, jobId: parseId(text) };
}

export async function submitJob(jobId, billingType = 'User Credit') {
  const form = new FormData();
  form.append('billingType', billingType);
  const text = await request(`/jobs/${jobId}/submit`, { body: form });
  return { raw: text };
}

export async function sendCertifiedMail({
  packetBytes,
  recipientAddress,
  returnAddress
}) {
  const uploadedDocument = await uploadDocument({
    documentName: 'CREDITOS Certified Mail Packet',
    fileBytes: packetBytes,
    fileName: 'creditos-certified-mail.pdf'
  });

  if (!uploadedDocument.documentId) {
    const error = new Error('Click2Mail did not return a document ID.');
    error.status = 502;
    throw error;
  }

  const addressList = await uploadAddressList(recipientAddress, 'CREDITOS Certified Mail Recipient');
  if (!addressList.addressListId) {
    const error = new Error('Click2Mail did not return an address list ID.');
    error.status = 502;
    throw error;
  }

  const job = await createJob({
    documentId: uploadedDocument.documentId,
    addressListId: addressList.addressListId
  });

  if (!job.jobId) {
    const error = new Error('Click2Mail did not return a job ID.');
    error.status = 502;
    throw error;
  }

  await submitJob(job.jobId, 'User Credit');

  return {
    documentId: uploadedDocument.documentId,
    addressListId: addressList.addressListId,
    jobId: job.jobId,
    returnAddress
  };
}
