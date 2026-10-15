'use strict';
const { redactText } = require('../../src/backend/utils/redact-secrets');
for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    stream.write = (chunk, ...args) => write(typeof chunk === 'string' || Buffer.isBuffer(chunk)
        ? redactText(chunk.toString()) : chunk, ...args);
}
