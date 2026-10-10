(function registerErrorModal(global) {
    'use strict';

    /**
     * Creates the app's error-modal controller without owning its presentation.
     * @param {HTMLElement} container Modal container.
     * @returns {{ show: (onDismiss?: (() => void) | null) => void, hide: () => void, dismiss: () => void, clearOnDismiss: () => void }}
     */
    function createErrorModal(container) {
        let onDismiss = null;

        function show(callback) {
            onDismiss = callback || null;
            container.classList.remove('hidden');
        }

        function hide() {
            container.classList.add('is-closing');
            global.setTimeout(() => {
                container.classList.remove('is-closing');
                container.classList.add('hidden');
                onDismiss = null;
            }, 190);
        }

        function dismiss() {
            const callback = onDismiss;
            hide();
            if (callback) callback();
        }

        function clearOnDismiss() {
            onDismiss = null;
        }

        return Object.freeze({ show, hide, dismiss, clearOnDismiss });
    }

    /**
     * Register the refused-modal close action at the caller's original point.
     * @param {{refusedContainer: HTMLElement, chatScreen: HTMLElement}} deps
     */
    function createRefusedModalClose({ refusedContainer, chatScreen }) {
        const closeButton = document.getElementById('refused-modal-close-btn');
        if (closeButton) closeButton.addEventListener('click', () => {
            refusedContainer.classList.add('is-closing');
            global.setTimeout(() => {
                refusedContainer.classList.remove('is-closing');
                refusedContainer.classList.add('hidden');
                chatScreen.style.cssText = '';
                chatScreen.classList.remove('hidden');
            }, 190);
        });
    }

    const noticeQueue = [];
    let noticeOpen = false;
    let noticeClosing = false;
    let noticeBound = false;
    let noticeReturnFocus = null;

    function showNextNotice() {
        if (noticeOpen || noticeClosing || noticeQueue.length === 0) return;
        const container = document.getElementById('notice-modal');
        if (!container) return;
        const message = document.getElementById('notice-message');
        if (!message) return;
        noticeOpen = true;
        if (!noticeReturnFocus) noticeReturnFocus = document.activeElement;
        message.textContent = noticeQueue.shift();
        container.classList.remove('hidden');
        document.getElementById('notice-modal-ok')?.focus();
    }

    function dismissNotice() {
        if (!noticeOpen) return;
        noticeOpen = false;
        noticeClosing = true;
        const container = document.getElementById('notice-modal');
        container?.classList.add('is-closing');
        global.setTimeout(() => {
            container?.classList.remove('is-closing');
            container?.classList.add('hidden');
            noticeClosing = false;
            if (noticeQueue.length) showNextNotice();
            else {
                noticeReturnFocus?.focus?.();
                noticeReturnFocus = null;
            }
        }, 190);
    }

    function showNotice(message) {
        noticeQueue.push(String(message));
        if (!noticeBound) {
            const container = document.getElementById('notice-modal');
            if (!container) return;
            document.getElementById('notice-modal-close')?.addEventListener('click', dismissNotice);
            document.getElementById('notice-modal-ok')?.addEventListener('click', dismissNotice);
            container.querySelector('.app-modal-backdrop')?.addEventListener('click', dismissNotice);
            container.addEventListener('keydown', event => {
                if (event.key === 'Escape') dismissNotice();
            });
            noticeBound = true;
        }
        showNextNotice();
    }

    global.AedosModals = global.AedosModals || {};
    global.AedosModals.createErrorModal = createErrorModal;
    global.AedosModals.createRefusedModalClose = createRefusedModalClose;
    global.AedosModals.showNotice = showNotice;
})(window);
