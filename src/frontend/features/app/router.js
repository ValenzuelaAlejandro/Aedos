(function registerAedosAppRouter(global) {
    'use strict';

    /** @typedef {{generationState: Object}} RouterDependencies */

    /** Register application navigation and unload handlers at their former point. @param {RouterDependencies} deps */
    // eslint-disable-next-line max-lines-per-function -- All router handlers are registered in their original order.
    function createRouter({ generationState }) {
        // =========================================================
        // STATE ROUTER
        // =========================================================
        // eslint-disable-next-line max-lines-per-function, complexity -- Keep the existing comprehensive reset action intact.
        window.navigateToHome = function() {
            // Invalidate any queued slide messages/callbacks before tearing down
            // the current preview. This is the equivalent of unmount cleanup for
            // the vanilla iframe-based editor.
            generationState.activeGeneration = null;
            global._pendingTransitionFn = null;

            if (window.location.hash !== '#home') {
                window.history.replaceState(null, '', '#home');
            }

            const chatScreen = document.getElementById('chat-screen');
            if (chatScreen) {
                chatScreen.classList.remove('chat-mode');
                chatScreen.classList.remove('hidden');
                chatScreen.style.cssText = '';
            }

            const heroZone = document.getElementById('hero-zone');
            if (heroZone) heroZone.classList.remove('fade-out');

            const pills = document.getElementById('suggestion-pills-row');
            if (pills) { pills.style.transition = ''; pills.style.opacity = '1'; pills.style.pointerEvents = 'auto'; }
            const microcopy = document.querySelector('.app-microcopy');
            if (microcopy) { microcopy.style.transition = ''; microcopy.style.opacity = '1'; }
            const counter = document.querySelector('.chat-counter-row');
            if (counter) { counter.style.transition = ''; counter.style.opacity = '1'; }

            const convZone = document.getElementById('conversation-zone');
            if (convZone) {
                convZone.classList.add('hidden');
                convZone.classList.remove('visible');

                // 1. Move outline-container back to its original home inside #chat-ai-response .chat-ai-body and hide it
                const outlineContainer = document.getElementById('outline-container');
                const originalAiBody = document.querySelector('#chat-ai-response .chat-ai-body');
                if (outlineContainer && originalAiBody) {
                    outlineContainer.classList.add('hidden');
                    originalAiBody.appendChild(outlineContainer);
                }

                // 2. Remove any dynamically added follow-up bubbles, but keep the first two hardcoded ones safe
                const dynamicBubbles = convZone.querySelectorAll('.chat-msg:not(#chat-user-bubble):not(#chat-ai-response)');
                dynamicBubbles.forEach(b => b.remove());
                const dynamicErrors = convZone.querySelectorAll('.chat-error-message');
                dynamicErrors.forEach(e => e.remove());

                // 3. Clean up any historical outline summaries anywhere in the chat
                convZone.querySelectorAll('.historical-outline-summary').forEach(el => el.remove());

                // 4. Reset outline slides container and chips to pristine empty state
                const slidesContainer = document.getElementById('outline-slides-container');
                if (slidesContainer) slidesContainer.innerHTML = '';
                const chipsContainer = document.getElementById('outline-suggested-chips');
                if (chipsContainer) {
                    chipsContainer.innerHTML = '';
                    if (window._chipsRenderTimeout) clearTimeout(window._chipsRenderTimeout);
                }

                // 5. Clean up the first two hardcoded bubbles to their pristine starting state
                const firstUserText = document.getElementById('chat-user-text');
                if (firstUserText) firstUserText.textContent = '';

                const firstAiResponse = document.getElementById('chat-ai-response');
                if (firstAiResponse) {
                    // Restore default classes
                    firstAiResponse.className = 'chat-msg chat-msg-ai';

                    // Clean up any proceed, cancelled or error elements
                    firstAiResponse.querySelectorAll('.chat-proceed-message, .chat-cancelled-message, .chat-error-message').forEach(el => el.remove());

                    // Reset thinking dots
                    const thinking = firstAiResponse.querySelector('.chat-thinking');
                    if (thinking) {
                        thinking.className = 'chat-thinking hidden';
                    }

                    // Restore avatar opacity
                    const avatar = firstAiResponse.querySelector('.chat-ai-avatar');
                    if (avatar) {
                        avatar.style.opacity = '';
                        avatar.style.pointerEvents = '';
                        avatar.style.userSelect = '';
                    }
                }
            }

            // 6. Reset local attached files state and UI
            if (window._attachedFiles) {
                window._attachedFiles = [];
                const attachmentPreview = document.getElementById('attachment-preview-container');
                if (attachmentPreview) {
                    attachmentPreview.innerHTML = '';
                    attachmentPreview.classList.add('hidden');
                }
                const modeBtn = document.getElementById('btn-mode-dropdown');
                if (modeBtn) {
                    modeBtn.disabled = false;
                    modeBtn.style.opacity = '';
                    modeBtn.style.cursor = '';
                    if (modeBtn.parentElement) {
                        modeBtn.parentElement.removeAttribute('data-tooltip');
                    }
                }
            }

            if (window.outlineEditorState && window.AedosStores && window.AedosStores.outline) {
                window.AedosStores.outline.clearDraft();
            }

            const previewCont = document.getElementById('preview-container');
            if (previewCont) {
                previewCont.classList.add('hidden');
            }

            const temaInput = document.getElementById('w-tema');
            if (temaInput) temaInput.value = '';

            // Reset hero custom state and title text upon returning home
            generationState.heroCustomTextActive = false;
            const heroTextSpan = document.querySelector('.hero-title-text');
            if (heroTextSpan && heroTextSpan.getAttribute('data-original-text')) {
                heroTextSpan.textContent = heroTextSpan.getAttribute('data-original-text');
                heroTextSpan.parentElement.classList.remove('waiting-state');
            }
        };

        window.navigateToChat = function() {
            if (window.location.hash !== '#chat') {
                window.history.pushState(null, '', '#chat');
            }
            // Let existing chat initialization (outline.js) handle specific DOM changes
        };

        window.navigateToEditor = function() {
            if (window.location.hash !== '#editor') {
                window.history.pushState(null, '', '#editor');
            }
            // Specific changes handled organically by startFinalGeneration
        };

        // Handle browser back/forward button natively via Router
        // eslint-disable-next-line complexity -- Preserve the current unsaved-work confirmation and URL restoration flow.
        window.addEventListener('popstate', (e) => {
            const hash = window.location.hash;

            const previewCont = document.getElementById('preview-container');
            const outlineContainer = document.getElementById('outline-container');

            // Check if there is active progress that can be lost (generation OR manual editing)
            const outlineActive = !!generationState.skeletonController || (outlineContainer && !outlineContainer.classList.contains('hidden'));
            const editorActive = !!generationState.activeController || (previewCont && !previewCont.classList.contains('hidden'));

            if (outlineActive || editorActive) {
                const msg = window.__t ? window.__t('confirm_exit_draft', 'Are you sure you want to go back? Your progress will be lost.') : 'Are you sure you want to go back? Your progress will be lost.';
                if (confirm(msg)) {
                    if (outlineContainer) outlineContainer.classList.add('hidden');
                    if (previewCont) previewCont.classList.add('hidden');

                    if (generationState.activeController) { generationState.activeController.abort(); generationState.activeController = null; }
                    if (generationState.skeletonController) { generationState.skeletonController.abort(); generationState.skeletonController = null; }

                    // Reset hash to #home and reload to guarantee a clean URL
                    window.location.href = window.location.origin + window.location.pathname + '#home';
                } else {
                    // User cancelled, restore URL hash corresponding to their active state
                    // If the preview container is visible, they are in the editor (#editor)
                    // Otherwise they are in the outline editor or slide loading screen (#chat)
                    const editorVisible = previewCont && !previewCont.classList.contains('hidden');
                    if (editorVisible) {
                        window.history.replaceState(null, '', '#editor');
                    } else {
                        window.history.replaceState(null, '', '#chat');
                    }
                    return; // Stop processing popstate
                }
            }

            // Standard Router Fallback (if no active progress is at risk)
            if (hash === '' || hash === '#home') {
                window.navigateToHome();
            } else if (hash === '#chat') {
                // As per user requirement: if the user navigates back to the chat from the editor,
                // they should be returned to the menu to avoid getting stuck in the "creating slides" state.
                window.navigateToHome();
            }
        });

        // Always force redirect to #home on fresh reload or entry
        const initialHash = window.location.hash;
        if (initialHash !== '#home') {
            window.history.replaceState(null, '', '#home');
        }
        window.navigateToHome();

        // Click brand logo to go to #home with progress warning checks
        const topBrand = document.querySelector('.top-brand');
        if (topBrand) {
            topBrand.addEventListener('click', () => {
                const previewCont = document.getElementById('preview-container');
                const outlineContainer = document.getElementById('outline-container');
                const outlineActive = !!generationState.skeletonController || (outlineContainer && !outlineContainer.classList.contains('hidden'));
                const editorActive = !!generationState.activeController || (previewCont && !previewCont.classList.contains('hidden'));

                if (outlineActive || editorActive) {
                    const msg = window.__t ? window.__t('confirm_exit_draft', 'Are you sure you want to go back? Your progress will be lost.') : 'Are you sure you want to go back? Your progress will be lost.';
                    if (!confirm(msg)) {
                        return; // user cancelled, do not navigate
                    }

                    // If confirmed, reset states
                    if (outlineContainer) outlineContainer.classList.add('hidden');
                    if (previewCont) previewCont.classList.add('hidden');
                    if (generationState.activeController) { generationState.activeController.abort(); generationState.activeController = null; }
                    if (generationState.skeletonController) { generationState.skeletonController.abort(); generationState.skeletonController = null; }
                }

                // Cleanly reset UI and set hash to #home
                window.navigateToHome();
            });
        }

        // Warn on tab close if the user has active draft progress (generation OR manual editing)
        window.addEventListener('beforeunload', (e) => {
            const outlineContainer = document.getElementById('outline-container');
            const previewCont = document.getElementById('preview-container');

            const outlineActive = !!generationState.skeletonController || (outlineContainer && !outlineContainer.classList.contains('hidden'));
            const editorActive = !!generationState.activeController || (previewCont && !previewCont.classList.contains('hidden'));

            if (outlineActive || editorActive) {
                e.preventDefault();
                e.returnValue = ''; // Standard way to trigger native browser prompt
            }
        });
    }

    global.AedosAppRouter = global.AedosAppRouter || {};
    global.AedosAppRouter.createRouter = createRouter;
})(window);
