const { redactText, redactSecrets } = require('./redact-secrets');
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

const LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  success: 20,
  http: 20,
  warn: 30,
  error: 40,
  fatal: 50
};

const LEVEL_STYLE = {
  debug: { label: 'DEBUG', icon: '[.]', color: COLORS.gray },
  info: { label: 'INFO ', icon: '[i]', color: COLORS.cyan },
  success: { label: 'OK   ', icon: '[+]', color: COLORS.green },
  http: { label: 'HTTP ', icon: '[>]', color: COLORS.blue },
  warn: { label: 'WARN ', icon: '[!]', color: COLORS.yellow },
  error: { label: 'ERROR', icon: '[x]', color: COLORS.red },
  fatal: { label: 'FATAL', icon: '[X]', color: COLORS.red }
};

const DEFAULT_LEVEL = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

const ErrorCategory = Object.freeze({
  BOOT: 'BOOT',
  CONFIG: 'CONFIG',
  HTTP: 'HTTP',
  SECURITY: 'SECURITY',
  VALIDATION: 'VALIDATION',
  QUEUE: 'QUEUE',
  PROVIDER: 'PROVIDER',
  QUOTA: 'QUOTA',
  MODEL: 'MODEL',
  PIPELINE: 'PIPELINE',
  STREAM: 'STREAM',
  SANITIZER: 'SANITIZER',
  PUPPETEER: 'PUPPETEER',
  FILESYSTEM: 'FILESYSTEM',
  NETWORK: 'NETWORK',
  DOWNLOAD: 'DOWNLOAD',
  UNKNOWN: 'UNKNOWN'
});

function supportsColor() {
  return Boolean(process.stdout.isTTY) && process.env.NO_COLOR !== '1';
}

function clip(value, maxLen = 240) {
  if (typeof value !== 'string') return value;
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}...`;
}

function formatError(error) {
  if (!(error instanceof Error)) return error;

  return {
    name: error.name,
    code: /** @type {NodeJS.ErrnoException} */ (error).code,
    message: clip(error.message || ''),
    stack: clip(error.stack || '', 600)
  };
}

function serializeMeta(meta = {}) {
  const entries = Object.entries(redactSecrets(meta)).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return '';

  return entries
    .map(([key, rawValue]) => {
      let value = rawValue;

      if (value instanceof Error) {
        value = formatError(value);
      }

      if (typeof value === 'string') {
        return `${key}=${JSON.stringify(clip(value))}`;
      }

      if (typeof value === 'number' || typeof value === 'boolean') {
        return `${key}=${value}`;
      }

      try {
        return `${key}=${JSON.stringify(value)}`;
      } catch (_) {
        return `${key}="[unserializable]"`;
      }
    })
    .join(' ');
}

/** @type {Array<[string, RegExp]>} */
const ERROR_PATTERNS = [
  ['QUOTA', /quota_exhausted|429|quota/], ['PIPELINE', /stage1_|stage2_|content_rejected|pipeline/],
  ['SECURITY', /cors/], ['VALIDATION', /validation|invalid|must be/], ['PUPPETEER', /puppeteer/],
  ['STREAM', /stream/], ['MODEL', /model|not available|not found/],
  ['NETWORK', /fetch|network|econn|etimedout/], ['FILESYSTEM', /enoent|eacces|file/]
];
function classifyError(error, fallback = ErrorCategory.UNKNOWN) {
  const raw = String(error?.name || '') + ' ' + String(error?.message || error || '');
  const match = ERROR_PATTERNS.find(([, pattern]) => pattern.test(raw.toLowerCase()));
  return match ? ErrorCategory[match[0]] : fallback;
}

function createLogger({ scope = 'APP', minLevel = process.env.LOG_LEVEL || DEFAULT_LEVEL } = {}) {
  const threshold = LEVEL_PRIORITY[minLevel] ?? LEVEL_PRIORITY[DEFAULT_LEVEL];
  const colorEnabled = supportsColor();

  function decorate(style, text) {
    if (!colorEnabled) return text;
    return `${style.color}${text}${COLORS.reset}`;
  }

  function write(level, category, message, meta = {}) {
    if ((LEVEL_PRIORITY[level] ?? LEVEL_PRIORITY.info) < threshold) {
      return;
    }

    const style = LEVEL_STYLE[level] || LEVEL_STYLE.info;
    const timestamp = new Date().toISOString();
    const levelToken = decorate(style, `${style.icon} ${style.label}`);
    const lineStart = redactText(`${timestamp} ${levelToken} [${scope}] [${category || 'GENERAL'}] ${message}`);
    const metaText = serializeMeta(meta);
    const finalLine = metaText ? `${lineStart} | ${metaText}` : lineStart;

    if (level === 'warn' || level === 'error' || level === 'fatal') {
      process.stderr.write(`${finalLine}\n`);
      return;
    }

    process.stdout.write(`${finalLine}\n`);
  }

  function child(childScope) {
    return createLogger({ scope: `${scope}:${childScope}`, minLevel });
  }

  function banner(lines, color = 'cyan') {
    const palette = COLORS[color] || '';
    const reset = colorEnabled ? COLORS.reset : '';
    const list = Array.isArray(lines) ? lines : String(lines).split('\n');
    for (const line of list) {
      const text = colorEnabled ? `${palette}${line}${reset}` : line;
      process.stdout.write(`${redactText(text)}\n`);
    }
  }

  return {
    child,
    banner,
    debug: (category, message, meta) => write('debug', category, message, meta),
    info: (category, message, meta) => write('info', category, message, meta),
    success: (category, message, meta) => write('success', category, message, meta),
    http: (category, message, meta) => write('http', category, message, meta),
    warn: (category, message, meta) => write('warn', category, message, meta),
    error: (category, message, meta) => write('error', category, message, meta),
    fatal: (category, message, meta) => write('fatal', category, message, meta)
  };
}

module.exports = {
  createLogger,
  classifyError,
  ErrorCategory
};
