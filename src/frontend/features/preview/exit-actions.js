(function registerPreviewExitActions(global) {
    'use strict';

    /** @typedef {{ window: Window, document: Document, generationState: Object, confirm: Function, setTimeout: Function, Event: Function }} PreviewExitDependencies */
    /** Register the existing preview back/edit-topic controls. @param {PreviewExitDependencies} deps */
    function createPreviewExitActions(deps) {
        const { window, document, generationState, confirm, setTimeout, Event } = deps;
        // Preview actions (Edit / Regenerate / Back)
        const btnBackToChat = document.getElementById('btn-back-to-chat');
        if (btnBackToChat) {
            btnBackToChat.addEventListener('click', () => {
                const msg = window.__t ? window.__t('confirm_exit_draft', 'Are you sure you want to go back? Your progress will be lost.') : 'Are you sure you want to go back? Your progress will be lost.';
                if (!confirm(msg)) return;
    
                if (generationState.activeController) {
                    generationState.activeController.abort();
                    generationState.activeController = null;
                }
                
                window.navigateToHome();
                
                setTimeout(() => {
                    window.dispatchEvent(new Event('resize'));
                    const temaInput = document.getElementById('w-tema');
                    if (temaInput) temaInput.focus();
                }, 50);
            });
        }
    
        const btnEditTopic = document.getElementById('btn-edit-topic');
        if (btnEditTopic) {
            btnEditTopic.addEventListener('click', () => {
                const msg = window.__t ? window.__t('confirm_exit_draft', 'Are you sure you want to go back? Your progress will be lost.') : 'Are you sure you want to go back? Your progress will be lost.';
                if (!confirm(msg)) return;
    
                if (generationState.activeController) {
                    generationState.activeController.abort();
                    generationState.activeController = null;
                }
                
                window.navigateToHome();
                
                setTimeout(() => {
                    const temaInput = document.getElementById('w-tema');
                    if (temaInput) temaInput.focus();
                }, 50);
            });
        }
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createPreviewExitActions = createPreviewExitActions;
})(window);
