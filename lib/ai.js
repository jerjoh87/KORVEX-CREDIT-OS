const DEFAULT_PROVIDER = 'openai';
const DEFAULT_OPENAI_MODEL = 'gpt-5.5';
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

function hasValue(value) {
  return String(value || '').trim().length > 0;
}

function openAiApiKey() {
  return String(
    process.env.OPENAI_API_KEY ||
    process.env.CHATGPT_API_KEY ||
    ''
  ).trim();
}

function geminiApiKey() {
  return String(
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GEMINI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ''
  ).trim();
}

export function aiProvider() {
  const preferred = String(process.env.AI_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();
  if (preferred === 'openai' && hasValue(openAiApiKey())) return 'openai';
  if (preferred === 'gemini' && hasValue(geminiApiKey())) return 'gemini';
  if (hasValue(openAiApiKey())) return 'openai';
  if (hasValue(geminiApiKey())) return 'gemini';
  return preferred === 'gemini' ? 'gemini' : 'openai';
}

export function aiConfigured() {
  return aiProvider() === 'openai' ? hasValue(openAiApiKey()) : hasValue(geminiApiKey());
}

export function aiModel() {
  if (aiProvider() === 'openai') {
    return String(process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim();
  }
  return String(process.env.GEMINI_MODEL || process.env.GOOGLE_GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
}

export function aiProviderLabel() {
  return aiProvider() === 'openai' ? 'OpenAI' : 'Gemini';
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

function normalizeGeminiParts(content) {
  const values = Array.isArray(content) ? content : [content];
  const parts = [];
  for (const value of values) {
    if (value && typeof value === 'object' && value.inlineData?.data && value.inlineData?.mimeType) {
      parts.push({ inlineData: { data: String(value.inlineData.data), mimeType: String(value.inlineData.mimeType) } });
      continue;
    }
    const text = toTextPart(value).trim();
    if (text) parts.push({ text });
  }
  return parts;
}

function normalizeGeminiMessages(body = {}) {
  if (Array.isArray(body.contents) && body.contents.length) {
    return body.contents
      .map(entry => ({
        role: entry.role === 'assistant' ? 'model' : 'user',
        parts: normalizeGeminiParts(entry.parts || entry.content || entry.text)
      }))
      .filter(entry => entry.parts.length);
  }

  if (Array.isArray(body.messages) && body.messages.length) {
    return body.messages
      .map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: normalizeGeminiParts(msg.content || msg.parts || msg.text)
      }))
      .filter(entry => entry.parts.length);
  }

  const parts = normalizeGeminiParts(body.prompt || body.input || body.text || body.content);
  return parts.length ? [{ role: 'user', parts }] : [];
}

function normalizeGeminiSystemInstruction(body = {}) {
  const text = toTextPart(body.system || body.systemInstruction || body.system_instruction).trim();
  return text ? { parts: [{ text }] } : undefined;
}

function dataUrlForInlineData(mimeType, data) {
  return `data:${mimeType};base64,${data}`;
}

function filenameForMimeType(mimeType = 'application/octet-stream') {
  if (mimeType === 'application/pdf') return 'upload.pdf';
  if (mimeType === 'text/plain') return 'upload.txt';
  if (mimeType === 'image/png') return 'upload.png';
  if (mimeType === 'image/jpeg') return 'upload.jpg';
  return 'upload.bin';
}

function normalizeOpenAiContent(content) {
  const values = Array.isArray(content) ? content : [content];
  const parts = [];
  for (const value of values) {
    if (value && typeof value === 'object' && value.inlineData?.data && value.inlineData?.mimeType) {
      const mimeType = String(value.inlineData.mimeType);
      const data = String(value.inlineData.data);
      if (mimeType.startsWith('image/')) {
        parts.push({ type: 'input_image', image_url: dataUrlForInlineData(mimeType, data) });
      } else {
        parts.push({
          type: 'input_file',
          filename: filenameForMimeType(mimeType),
          file_data: dataUrlForInlineData(mimeType, data)
        });
      }
      continue;
    }
    const text = toTextPart(value).trim();
    if (text) parts.push({ type: 'input_text', text });
  }
  return parts;
}

function normalizeOpenAiMessages(body = {}) {
  if (Array.isArray(body.contents) && body.contents.length) {
    return body.contents
      .map(entry => ({
        role: entry.role === 'assistant' ? 'assistant' : 'user',
        content: normalizeOpenAiContent(entry.parts || entry.content || entry.text)
      }))
      .filter(entry => entry.content.length);
  }

  if (Array.isArray(body.messages) && body.messages.length) {
    return body.messages
      .filter(msg => msg.role !== 'system')
      .map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: normalizeOpenAiContent(msg.content || msg.parts || msg.text)
      }))
      .filter(entry => entry.content.length);
  }

  const content = normalizeOpenAiContent(body.prompt || body.input || body.text || body.content);
  return content.length ? [{ role: 'user', content }] : [];
}

function normalizeOpenAiInstructions(body = {}) {
  const systemText = toTextPart(body.system || body.systemInstruction || body.system_instruction).trim();
  if (systemText) return systemText;
  if (Array.isArray(body.messages)) {
    const systemParts = body.messages
      .filter(msg => msg.role === 'system')
      .map(msg => toTextPart(msg.content || msg.parts || msg.text).trim())
      .filter(Boolean);
    if (systemParts.length) return systemParts.join('\n\n');
  }
  return '';
}

async function callOpenAi(body = {}) {
  const apiKey = openAiApiKey();
  if (!apiKey) {
    const error = new Error('OpenAI API key is not configured.');
    error.status = 503;
    throw error;
  }

  const payload = {
    model: body.model || aiModel(),
    input: normalizeOpenAiMessages(body)
  };

  const instructions = normalizeOpenAiInstructions(body);
  if (instructions) payload.instructions = instructions;

  const maxTokens = body.max_tokens ?? body.maxOutputTokens ?? body.max_output_tokens;
  if (maxTokens != null && Number.isFinite(Number(maxTokens))) {
    payload.max_output_tokens = Number(maxTokens);
  }

  const temperature = body.temperature;
  if (temperature != null && Number.isFinite(Number(temperature))) {
    payload.temperature = Number(temperature);
  }

  const timeoutMs = Number(body.timeoutMs || body.timeout_ms || 0);
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    return await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: body.signal || controller?.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('AI analysis timed out before completion.');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function callGeminiProvider(body = {}) {
  const apiKey = geminiApiKey();
  if (!apiKey) {
    const error = new Error('Gemini API key is not configured.');
    error.status = 503;
    throw error;
  }

  const model = body.model || aiModel();
  const contents = normalizeGeminiMessages(body);
  const systemInstruction = normalizeGeminiSystemInstruction(body);
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

  const timeoutMs = Number(body.timeoutMs || body.timeout_ms || 0);
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify(payload),
        signal: body.signal || controller?.signal
      }
    );
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('AI analysis timed out before completion.');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function callAi(body = {}) {
  return aiProvider() === 'openai'
    ? callOpenAi(body)
    : callGeminiProvider(body);
}

export function toAiText(data) {
  if (!data) return '';

  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }

  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item?.type === 'message' && Array.isArray(item.content)) {
        const text = item.content
          .map(part => {
            if (typeof part?.text === 'string') return part.text;
            if (typeof part?.output_text === 'string') return part.output_text;
            return '';
          })
          .join('');
        if (text.trim()) return text;
      }
    }
  }

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
