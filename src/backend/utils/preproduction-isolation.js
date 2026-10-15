'use strict';

const crypto = require('node:crypto');

function isolatedLabel(value) {
    return /^(staging|preprod|preproduction|isolated)-[a-z0-9-]+$/i.test(String(value || ''));
}

function validatePreproductionTarget(value) {
    const target = new URL(value);
    const host = target.hostname.toLowerCase();
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(host);
    const production = host === 'aedoslab.xyz' || host.endsWith('.aedoslab.xyz')
        || host === 'aedos.onrender.com' || host.endsWith('.aedos.onrender.com');
    const stagingHost = /(^|[.-])(staging|preprod|preproduction|isolated)([.-]|$)/i.test(host);
    if (production || (!local && (!stagingHost || target.protocol !== 'https:'))
        || !['http:', 'https:'].includes(target.protocol)
        || target.username || target.password || target.search || target.hash || target.pathname !== '/') {
        throw new Error('Refusing target: use an isolated staging/preprod HTTPS origin or loopback; production is blocked.');
    }
    return target;
}

function redisFingerprint(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.upstash.io')
        || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        throw new Error('Use the HTTPS REST origin of the isolated Upstash database.');
    }
    return crypto.createHash('sha256').update(url.origin).digest('hex');
}

function preproductionAttestation(env = process.env) {
    if (env.NODE_ENV !== 'preproduction' || !isolatedLabel(env.AEDOS_REDIS_TEST_LABEL)
        || env.AEDOS_REDIS_TEST_ACK !== 'ISOLATED_PREPRODUCTION_REDIS_ONLY') return null;
    try {
        return { schema: 'aedos-preproduction-v1', environment: 'preproduction',
            redisLabel: env.AEDOS_REDIS_TEST_LABEL, redisFingerprint: redisFingerprint(env.UPSTASH_REDIS_REST_URL) };
    } catch (_) { return null; }
}

module.exports = { isolatedLabel, validatePreproductionTarget, redisFingerprint, preproductionAttestation };
