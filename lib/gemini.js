const DEFAULT_MODEL = 'gemini-3.5-flash';

function geminiApiKey() {
  return String(process.env.GEMINI_API_KEY || '').trim();
}

export function geminiConfigured() {
  return geminiApiKey().length > 0;
}

export function geminiModel() {
  return String(process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
}

function toTextPart(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(toTextPart).join('');
  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.content === 'string') return content.content;
    if (Array.isArray(content.parts)) return content.parts.map(toTextPart).join('');
  }
  return '';
}

function normalizeParts(content) {
  const text = toTextPart(content).trim();
  return text ? [{ text }] : [];
}

function normalizeMessages(body = {}) {
  if (Array.isArray(body.contents) && body.contents.length) {
    return body.contents
      .map(entry => ({
        role: entry.role === 'assistant' ? 'model' : 'user',
        parts: normalizeParts(entry.parts || entry.content || entry.text)
      }))
      .filter(entry => entry.parts.length);
  }

  if (Array.isArray(body.messages) && body.messages.length) {
    return body.messages
      .map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: normalizeParts(msg.content || msg.parts || msg.text)
      }))
      .filter(entry => entry.parts.length);
  }

  const parts = normalizeParts(body.prompt || body.input || body.text || body.content);
  return parts.length ? [{ role: 'user', parts }] : [];
}

function normalizeSystemInstruction(body = {}) {
  const text = toTextPart(body.system || body.systemInstruction || body.system_instruction).trim();
  return text ? { parts: [{ text }] } : undefined;
}

export async function callGemini(body = {}) {
  const apiKey = geminiApiKey();
  if (!apiKey) {
    const error = new Error('Gemini API key is not configured.');
    error.status = 503;
    throw error;
  }

  const model = body.model || geminiModel();
  const contents = normalizeMessages(body);
  const systemInstruction = normalizeSystemInstruction(body);
  const generationConfig = {};

  const maxTokens = body.max_tokens ?? body.maxOutputTokens ?? body.generationConfig?.maxOutputTokens;
  if (maxTokens != null && Number.isFinite(Number(maxTokens))) {
    generationConfig.maxOutputTokens = Number(maxTokens);
  }

  const temperature = body.temperature ?? body.generationConfig?.temperature;
  if (temperature != null && Number.isFinite(Number(temperature))) {
    generationConfig.temperature = Number(temperature);
  }

  const responseMimeType = body.responseMimeType ?? body.generationConfig?.responseMimeType;
  if (responseMimeType) {
    generationConfig.responseMimeType = String(responseMimeType);
  }

  const payload = { contents };
  if (systemInstruction) payload.systemInstruction = systemInstruction;
  if (Object.keys(generationConfig).length) payload.generationConfig = generationConfig;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(payload)
    }
  );

  return resp;
}

export function toGeminiText(data) {
  if (!data) return '';
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts;
    if (Array.isArray(parts)) {
      const text = parts.map(part => typeof part?.text === 'string' ? part.text : '').join('');
      if (text.trim()) return text;
    }
    const text = candidate?.content?.text;
    if (typeof text === 'string' && text.trim()) return text;
  }
  return '';
}
