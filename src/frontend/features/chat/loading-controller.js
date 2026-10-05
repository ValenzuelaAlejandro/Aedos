/**
 * @typedef {Object} ChatLoadingDependencies
 * @property {Object} state
 * @property {Document} document
 * @property {Window} window
 * @property {HTMLTextAreaElement|null} temaInput
 * @property {HTMLButtonElement|null} generateBtn
 * @property {HTMLButtonElement|null} modeBtn
 * @property {HTMLButtonElement|null} langBtn
 * @property {HTMLButtonElement|null} btnAttachFile
 * @property {Function} validateGenerateButton
 * @property {Function} stopTypewriter
 * @property {Function} getUpdateZoomDisplay
 */

/**
 * Own the existing generate-button loading messages and control lock behavior.
 * @param {ChatLoadingDependencies} deps
 */
// eslint-disable-next-line max-lines-per-function -- The timer lifecycle and state mutations are intentionally kept in their original shared closure.
function createChatLoadingController(deps) {
    const {
        state,
        document,
        window,
        temaInput,
        generateBtn,
        modeBtn,
        langBtn,
        btnAttachFile,
        validateGenerateButton,
        stopTypewriter,
        getUpdateZoomDisplay,
    } = deps;

    state.BTN_LOADING_KEYS_DESKTOP = [
        'gen_loading_1', 'gen_loading_2', 'gen_loading_3', 'gen_loading_4',
        'gen_loading_5', 'gen_loading_6', 'gen_loading_7', 'gen_loading_8',
        'gen_loading_9', 'gen_loading_final'
    ];
    state.activeBtnLoadingKeys = state.BTN_LOADING_KEYS_DESKTOP;
    state.btnMsgTimer = null;
    state.btnMsgIndex = 0;

    function _resolveBtnLoadingKeys() {
        if (window.MobileRuntime && typeof window.MobileRuntime.resolveLoadingKeys === 'function') {
            return window.MobileRuntime.resolveLoadingKeys(state.BTN_LOADING_KEYS_DESKTOP);
        }
        if (window.innerWidth <= 768) {
            return state.BTN_LOADING_KEYS_DESKTOP.map(key => key + '_mobile');
        }
        return state.BTN_LOADING_KEYS_DESKTOP;
    }

    function _scheduleNextBtnMsg() {
        if (state.btnMsgIndex >= state.activeBtnLoadingKeys.length - 1) return;
        state.btnMsgTimer = setTimeout(() => {
            state.btnMsgIndex++;
            const key = state.activeBtnLoadingKeys[state.btnMsgIndex];
            const fallbackKey = state.BTN_LOADING_KEYS_DESKTOP[state.btnMsgIndex] || 'gen_loading_final';
            const newText = window.__t(key, window.__t(fallbackKey));
            animateHeroTitle(newText);
            _scheduleNextBtnMsg();
        }, 3000); // Increased interval slightly to account for animations
    }

    function animateHeroTitle(newText) {
        const heroTextSpan = document.querySelector('.hero-title-text');
        const heroTitle = document.querySelector('.hero-title');
        if (!heroTextSpan || !heroTitle) return;
        const clean = newText.replace(/\.+$/, '').trimEnd();

        if (window._heroTypewriterTimer) {
            clearTimeout(window._heroTypewriterTimer);
            window._heroTypewriterTimer = null;
        }
        if (window.gsap) window.gsap.killTweensOf(heroTitle);

        // Fast fade out from right to left (moving left while fading)
        gsap.to(heroTitle, {
            x: -20,
            opacity: 0,
            duration: 0.45,
            ease: "power2.in",
            onComplete: () => {
                heroTextSpan.textContent = '';
                gsap.set(heroTitle, { x: 0, opacity: 1 });

                // Manual typewriter effect
                let i = 0;
                function typeChar() {
                    if (i < clean.length) {
                        heroTextSpan.textContent += clean.charAt(i);
                        i++;
                        window._heroTypewriterTimer = setTimeout(typeChar, 28);
                    }
                }
                typeChar();
            }
        });
    }

    state.heroResetTimer = null;
    function startBtnMessages() {
        if (state.heroResetTimer) { clearTimeout(state.heroResetTimer); state.heroResetTimer = null; }
        state.activeBtnLoadingKeys = _resolveBtnLoadingKeys();
        state.btnMsgIndex = 0;
        state.btnMsgTimer = null;
        const key = state.activeBtnLoadingKeys[0];
        const newText = window.__t(key, window.__t(state.BTN_LOADING_KEYS_DESKTOP[0]));
        animateHeroTitle(newText);
        _scheduleNextBtnMsg();
    }

    function pauseBtnMessages() {
        if (state.btnMsgTimer) { clearTimeout(state.btnMsgTimer); state.btnMsgTimer = null; }
    }

    function resumeBtnMessages() {
        if (!state.btnMsgTimer) _scheduleNextBtnMsg();
    }

    function stopBtnMessages() {
        pauseBtnMessages();
        state.btnMsgIndex = 0;
        if (state.heroResetTimer) clearTimeout(state.heroResetTimer);
        state.heroResetTimer = setTimeout(() => {
            animateHeroTitle(window.__t('hero_line_1', 'Got a spicy idea?'));
            state.heroResetTimer = null;
        }, 3000);
    }

    // eslint-disable-next-line complexity -- Preserve the legacy loading branches and control update order.
    function toggleGenerateLoading(isLoading) {
        const editorControls = [
            ...Array.from(document.querySelectorAll('.preview-unified-header button, .preview-unified-header select, .preview-unified-header input')),
            ...Array.from(document.querySelectorAll('#editor-tools-panel button, #editor-tools-panel select, #editor-tools-panel input, #editor-minimap button'))
        ];

        if (isLoading) {
            if (temaInput) temaInput.disabled = false;
            if (generateBtn) {
                generateBtn.classList.add('is-generating');
                generateBtn.disabled = false;
            }
            if (modeBtn) modeBtn.disabled = true;
            if (langBtn) langBtn.disabled = true;
            if (btnAttachFile) btnAttachFile.disabled = true;

            stopTypewriter();
            startBtnMessages();
            document.querySelectorAll('.suggestion-pill, .file-chip-remove').forEach(el => el.disabled = true);
            editorControls.forEach(ctrl => { if (ctrl) ctrl.disabled = true; });
        } else {
            document.querySelectorAll('.chat-thinking').forEach(el => el.classList.add('hidden'));
            if (temaInput) temaInput.disabled = false;
            if (generateBtn) generateBtn.classList.remove('is-generating');
            if (typeof validateGenerateButton === 'function') validateGenerateButton();
            if (!window._attachedFiles || window._attachedFiles.length === 0) {
                if (modeBtn) modeBtn.disabled = false;
            }
            if (langBtn) langBtn.disabled = false;
            if (btnAttachFile) btnAttachFile.disabled = false;
            if (state.typewriterCursor) state.typewriterCursor.style.display = '';
            stopBtnMessages();
            document.querySelectorAll('.suggestion-pill, .file-chip-remove').forEach(el => el.disabled = false);
            editorControls.forEach(ctrl => { if (ctrl) ctrl.disabled = false; });
            const updateZoomDisplay = getUpdateZoomDisplay();
            if (typeof updateZoomDisplay === 'function') updateZoomDisplay();
        }
    }

    return {
        animateHeroTitle,
        pauseBtnMessages,
        resumeBtnMessages,
        stopBtnMessages,
        toggleGenerateLoading,
    };
}

window.AedosChatLoading = Object.freeze({ createChatLoadingController });
