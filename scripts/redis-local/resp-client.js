'use strict';

const net = require('node:net');

// eslint-disable-next-line complexity -- One recursive parser handles RESP reply types and incomplete buffers.
function parseReply(buffer, offset = 0) {
    if (offset >= buffer.length) return null;
    const type = String.fromCharCode(buffer[offset]);
    const end = buffer.indexOf('\r\n', offset + 1);
    if (end < 0) return null;
    const header = buffer.toString('utf8', offset + 1, end);
    const next = end + 2;
    if (type === '+' || type === '-') {
        return { value: type === '-' ? new Error(header) : header, error: type === '-', next };
    }
    if (type === ':') return { value: Number(header), next };
    if (type === '$') {
        const length = Number(header);
        if (length < 0) return { value: null, next };
        const finish = next + length;
        if (buffer.length < finish + 2) return null;
        return { value: buffer.toString('utf8', next, finish), next: finish + 2 };
    }
    if (type === '*') {
        const count = Number(header);
        if (count < 0) return { value: null, next };
        const values = [];
        let cursor = next;
        for (let index = 0; index < count; index += 1) {
            const item = parseReply(buffer, cursor);
            if (!item) return null;
            if (item.error) return item;
            values.push(item.value);
            cursor = item.next;
        }
        return { value: values, next: cursor };
    }
    throw new Error(`Unsupported Redis RESP reply type: ${type}`);
}

function encodeCommand(parts) {
    const encoded = parts.map((part) => {
        const value = Buffer.from(String(part));
        return Buffer.concat([Buffer.from(`$${value.length}\r\n`), value, Buffer.from('\r\n')]);
    });
    return Buffer.concat([Buffer.from(`*${encoded.length}\r\n`), ...encoded]);
}

class RespClient {
    constructor(socket) {
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        this.pending = [];
        socket.on('data', (chunk) => {
            this.buffer = Buffer.concat([this.buffer, chunk]);
            this.flushReplies();
        });
        socket.on('error', (error) => this.rejectPending(error));
        socket.on('close', () => this.rejectPending(new Error('Redis connection closed')));
    }

    static async connect({ host = '127.0.0.1', port, username = null, password = null, timeoutMs = 5000 }) {
        const socket = net.createConnection({ host, port });
        const client = new RespClient(socket);
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Redis connect timeout')), timeoutMs);
            socket.once('connect', () => { clearTimeout(timer); resolve(undefined); });
            socket.once('error', (error) => { clearTimeout(timer); reject(error); });
        });
        if (password) await client.command('AUTH', username || 'default', password);
        return client;
    }

    flushReplies() {
        while (this.pending.length) {
            const result = parseReply(this.buffer);
            if (!result) return;
            this.buffer = this.buffer.subarray(result.next);
            const pending = this.pending.shift();
            if (result.error) pending.reject(result.value);
            else pending.resolve(result.value);
        }
    }

    rejectPending(error) {
        for (const pending of this.pending.splice(0)) pending.reject(error);
    }

    command(...parts) {
        if (!this.socket.writable) return Promise.reject(new Error('Redis socket is not writable'));
        return new Promise((resolve, reject) => {
            this.pending.push({ resolve, reject });
            this.socket.write(encodeCommand(parts));
        });
    }

    get(key) { return this.command('GET', key); }

    set(key, value, options = {}) {
        const args = ['SET', key, value];
        if (options.ex) args.push('EX', String(options.ex));
        return this.command(...args);
    }

    eval(script, keys, args) {
        return this.command('EVAL', script, String(keys.length), ...keys, ...args);
    }

    close() { this.socket.end(); }
}

module.exports = { RespClient };
