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

    global.AedosModals = global.AedosModals || {};
    global.AedosModals.createErrorModal = createErrorModal;
})(window);
