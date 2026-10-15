'use strict';

// Loaded before application dependencies in EVERY rehearsal child. No DNS names,
// redirects, TLS sockets or external TCP destinations can escape the fixture.
const net = require('node:net');
const loopback = host => ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(host);
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    const normalized = Array.isArray(args[0]) ? args[0] : args;
    const options = typeof normalized[0] === 'object' ? normalized[0] : { host: normalized[1] || 'localhost' };
    if (!options.path && !loopback(options.host || options.hostname || 'localhost')) {
        throw new Error('REHEARSAL_EXTERNAL_NETWORK_BLOCKED');
    }
    return originalConnect.apply(this, args);
};
const originalFetch = global.fetch;
global.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (loopback(url.hostname)) return originalFetch(input, { ...init, redirect: 'error' });
    const paths = {
        'generativelanguage.googleapis.com': '/gemini',
        'openrouter.ai': '/openrouter',
        'rehearsal.upstash.io': '/redis',
    };
    const route = paths[url.hostname];
    const fixture = process.env.AEDOS_REHEARSAL_TRANSPORT;
    if (!route || !fixture || !loopback(new URL(fixture).hostname)) {
        return Promise.reject(new Error('REHEARSAL_EXTERNAL_NETWORK_BLOCKED'));
    }
    const destination = new URL(route + (route === '/redis' ? url.pathname : ''), fixture);
    destination.search = url.search;
    return originalFetch(destination, { ...init, redirect: 'error' });
};
