'use strict';

const SECRET_NAME = /(?:api.?key|token|authorization|password|secret|credential)/i;

function redactText(value, env = process.env) {
    let text = String(value);
    for (const [key, secret] of Object.entries(env)) {
        if (SECRET_NAME.test(key) && typeof secret === 'string' && secret.length >= 6) {
            text = text.split(secret).join('[REDACTED]');
        }
    }
    return text.replace(/([?&](?:key|token|api_key)=)[^&\s"']+/gi, '$1[REDACTED]')
        .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1[REDACTED]');
}

function redactSecrets(value, key = '') {
    if (SECRET_NAME.test(key) && !/(?:tokens|token_count|token_factor|token_limit|token_budget)$/i.test(key)) return '[REDACTED]';
    if (value instanceof Error) return { name: value.name, message: redactText(value.message), stack: redactText(value.stack || '') };
    if (typeof value === 'string') return redactText(value);
    if (Array.isArray(value)) return value.map(item => redactSecrets(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactSecrets(item, name)]));
    return value;
}

module.exports = { redactText, redactSecrets };
