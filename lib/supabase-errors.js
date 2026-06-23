export function isMissingSchemaError(error) {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || error || '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    message.includes('does not exist') ||
    message.includes('could not find the table') ||
    message.includes('schema cache')
  );
}

export async function withTimeout(promise, timeoutMs, message = 'Request timed out.') {
  const ms = Number(timeoutMs || 0);
  if (!ms || ms <= 0) return promise;

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message);
      error.status = 504;
      reject(error);
    }, ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
