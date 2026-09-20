// Central, redacted operational logging for the Worker.
// Logs are diagnostic only; never use this module as business state.

const SENSITIVE_KEY = /password|token|secret|api[_-]?key|authorization|cookie|card|cvv|email|phone|address|ip/i;
const SENSITIVE_VALUE = /(bearer\s+|sk_live_|pk_live_|password\s*[=:]|token\s*[=:]|api[_-]?key\s*[=:])/i;

function clean(value, depth = 0) {
  if (depth > 2 || value === null || value === undefined) return undefined;
  if (typeof value === 'string') return SENSITIVE_VALUE.test(value) ? '[REDACTED]' : value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 10).map(item => clean(item, depth + 1)).filter(item => item !== undefined);
  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 20)) output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : clean(item, depth + 1);
    return output;
  }
  return String(value).slice(0, 100);
}

export function safeErrorDetails(error) {
  return {
    name: String(error?.name || 'Error').slice(0, 80),
    message: clean(String(error?.message || error || 'Unknown error')) || 'Unknown error',
  };
}

export function reportOperationalError(scope, error, context = {}) {
  try {
    console.error(`[JobForion:${String(scope).slice(0, 80)}]`, JSON.stringify({ ...safeErrorDetails(error), context: clean(context) }));
  } catch (ignored) {
    console.error(`[JobForion:${String(scope).slice(0, 80)}] operational failure`);
  }
}
