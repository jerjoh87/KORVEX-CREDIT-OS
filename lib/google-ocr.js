import crypto from 'node:crypto';
import fetch from 'node-fetch';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DOC_AI_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const VISION_SCOPE = 'https://www.googleapis.com/auth/cloud-vision';
const tokenCache = new Map();

function envValue(name) {
  return String(process.env[name] || '').trim();
}

function parseServiceAccount() {
  const rawJson = envValue('GOOGLE_SERVICE_ACCOUNT_JSON');
  const rawBase64 = envValue('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64');
  if (!rawJson && !rawBase64) return null;
  try {
    const json = rawJson || Buffer.from(rawBase64, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    if (!parsed.client_email || !parsed.private_key) return null;
    parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
    return parsed;
  } catch {
    return null;
  }
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getAccessToken(scope) {
  const serviceAccount = parseServiceAccount();
  if (!serviceAccount) throw new Error('Google OCR is not configured.');

  const cached = tokenCache.get(scope);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now
  }));
  const unsigned = `${header}.${claim}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(serviceAccount.private_key);
  const assertion = `${unsigned}.${base64Url(signature)}`;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error('Google OCR authentication failed.');
  }

  tokenCache.set(scope, {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000
  });
  return data.access_token;
}

export function googleDocumentAiConfigured() {
  return !!(
    envValue('GOOGLE_CLOUD_PROJECT_ID') &&
    envValue('GOOGLE_DOCUMENT_AI_PROCESSOR_ID') &&
    parseServiceAccount()
  );
}

export function googleVisionConfigured() {
  return !!(
    envValue('GOOGLE_VISION_OCR_ENABLED').toLowerCase() === 'true' &&
    parseServiceAccount()
  );
}

export async function extractWithGoogleDocumentAi({ buffer, mimeType }) {
  if (!googleDocumentAiConfigured()) throw new Error('Google Document AI is not configured.');

  const projectId = envValue('GOOGLE_CLOUD_PROJECT_ID');
  const location = envValue('GOOGLE_CLOUD_LOCATION') || 'us';
  const processorId = envValue('GOOGLE_DOCUMENT_AI_PROCESSOR_ID');
  const processorVersion = envValue('GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION');
  const processorPath = processorVersion
    ? `projects/${projectId}/locations/${location}/processors/${processorId}/processorVersions/${processorVersion}`
    : `projects/${projectId}/locations/${location}/processors/${processorId}`;
  const url = `https://${location}-documentai.googleapis.com/v1/${processorPath}:process`;
  const token = await getAccessToken(DOC_AI_SCOPE);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      rawDocument: {
        content: buffer.toString('base64'),
        mimeType: mimeType || 'application/pdf'
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error('Google Document AI could not process this report.');
  }

  return {
    text: String(data?.document?.text || '').trim(),
    provider: 'google-document-ai',
    metadata: {
      pages: Array.isArray(data?.document?.pages) ? data.document.pages.length : null,
      processor: processorId,
      location
    }
  };
}

export async function extractWithGoogleVisionOcr({ buffer }) {
  if (!googleVisionConfigured()) throw new Error('Google Vision OCR is not configured.');

  const token = await getAccessToken(VISION_SCOPE);
  const response = await fetch('https://vision.googleapis.com/v1/images:annotate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [{
        image: { content: buffer.toString('base64') },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
      }]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error('Google Vision OCR could not process this report.');
  }
  const item = data?.responses?.[0] || {};
  if (item.error) throw new Error('Google Vision OCR returned an error.');

  return {
    text: String(item.fullTextAnnotation?.text || item.textAnnotations?.[0]?.description || '').trim(),
    provider: 'google-vision-ocr',
    metadata: { pages: null }
  };
}
