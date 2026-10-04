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

    global.AedosModals = global.AedosModals || {};
    global.AedosModals.createErrorModal = createErrorModal;
    global.AedosModals.createRefusedModalClose = createRefusedModalClose;
})(window);
