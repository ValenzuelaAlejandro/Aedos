(function registerAedosConversation(global) {
    'use strict';

    const ID_KEY = 'aedos.conversation.id.v1';
    const ACTIVE_KEY = 'aedos.conversation.active.v1';
    let fallbackId = null;
    let fallbackActive = false;

    function storage() {
        try { return global.sessionStorage; } catch (_) { return null; }
    }
    function read(key) {
        try { return storage()?.getItem(key) || null; } catch (_) { return null; }
    }
    function write(key, value) {
        try { storage()?.setItem(key, value); } catch (_) { /* session storage can be disabled */ }
    }
    function remove(key) {
        try { storage()?.removeItem(key); } catch (_) { /* session storage can be disabled */ }
    }
    function createId() {
        if (global.crypto?.randomUUID) return global.crypto.randomUUID();
        const bytes = new Uint8Array(16);
        if (global.crypto?.getRandomValues) global.crypto.getRandomValues(bytes);
        else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    function getId() {
        let id = read(ID_KEY) || fallbackId;
        if (!id) {
            id = createId();
            fallbackId = id;
            write(ID_KEY, id);
        }
        return id;
    }
    function isActive() {
        return global.location?.hash === '#chat'
            && Boolean(global.document?.getElementById('chat-user-text')?.textContent?.trim()
                || global.document?.querySelector('#chat-user-bubble .chat-bubble-file-item'))
            && (read(ACTIVE_KEY) === '1' || fallbackActive);
    }
    function begin(locked = true) {
        fallbackActive = locked;
        if (locked) write(ACTIVE_KEY, '1');
        else remove(ACTIVE_KEY);
        global.document?.body?.classList.toggle('conversation-active', locked);
        global.dispatchEvent?.(new global.CustomEvent('aedos:conversation-lock-changed', { detail: { locked } }));
    }
    function startNew(goHome = true) {
        fallbackActive = false; fallbackId = null;
        remove(ID_KEY);
        remove(ACTIVE_KEY);
        global.document?.body?.classList.remove('conversation-active');
        global.dispatchEvent?.(new global.CustomEvent('aedos:conversation-lock-changed', { detail: { locked: false } }));
        if (goHome) global.navigateToHome?.();
    }

    global.AedosConversation = Object.freeze({ getId, isActive, begin, startNew });
    if (isActive()) global.document?.body?.classList.add('conversation-active');
})(window);
