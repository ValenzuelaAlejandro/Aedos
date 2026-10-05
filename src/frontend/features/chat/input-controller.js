/**
 * @typedef {Object} ChatInputDependencies
 * @property {HTMLTextAreaElement|null} temaInput
 * @property {HTMLButtonElement|null} btnGenerate
 * @property {HTMLElement|null} temaError
 * @property {Document} document
 * @property {Window} window
 * @property {Function} validateGenerateButton
 * @property {{ warmedUp: boolean }} state
 */

/**
 * Create the existing topic/file-driven generate-button validator.
 * @param {{btnGenerate: HTMLButtonElement|null, temaInput: HTMLTextAreaElement|null, generationState: Object, window: Window, getAnimateHeroTitle: Function}} deps
 * @returns {() => void}
 */
function createGenerateButtonValidator(deps) {
    const { btnGenerate, temaInput, generationState, window, getAnimateHeroTitle } = deps;
    return function validateGenerateButton() {
        if (btnGenerate && btnGenerate.classList.contains('is-generating')) {
            return;
        }

        const val = temaInput ? temaInput.value.trim() : '';
        const hasFiles = window._attachedFiles && window._attachedFiles.length > 0;
        const isActive = val.length >= 4 || hasFiles;

        if (btnGenerate) {
            btnGenerate.disabled = !isActive;
        }

        // Animate hero title dynamically based on active state and language
        if (isActive) {
            if (!generationState.heroCustomTextActive) {
                generationState.heroCustomTextActive = true;
                getAnimateHeroTitle()(window.__t('hero_active'));
            }
        } else {
            if (generationState.heroCustomTextActive) {
                generationState.heroCustomTextActive = false;
                getAnimateHeroTitle()(window.__t('hero_line_1'));
            }
        }
    };
}

/** Register the public prompt-chip helper without changing its legacy semantics.
 * @param {{window: Window, document: Document, Event: Function}} deps
 */
function registerFillInput(deps) {
    const { window, document, Event } = deps;
    window.fillInput = (keyOrText) => {
        const input = document.getElementById('w-tema');
        if (input) {
            // Use translation if key exists, otherwise use as literal
            const translated = (typeof window.__t === 'function')
                ? window.__t(keyOrText)
                : keyOrText;
            // Prompts can come from i18n strings with HTML entities (&apos;, &amp;, etc.).
            // Decode them before writing to textarea value.
            const entityDecoder = document.createElement('textarea');
            entityDecoder.innerHTML = translated;
            input.value = entityDecoder.value;
            input.focus();
            input.dispatchEvent(new Event('input'));
        }
    };
}

/**
 * Bind chat composer input, keyboard and cursor behavior in registration order.
 * @param {ChatInputDependencies} deps
 */
function createChatInputController(deps) {
    const { temaInput, btnGenerate, temaError, document, window, validateGenerateButton, state } = deps;
    state.warmedUp = false;

    temaInput.addEventListener('input', () => {
        const val = temaInput.value;

        // Warm up the backend if not already done
        if (!state.warmedUp && val.length > 0) {
            state.warmedUp = true;
            fetch('/health').catch(() => {
                // Silently fail, allow retry on next input if it failed
                state.warmedUp = false;
            });
        }

        // Scroll to top if user starts typing while scrolled down
        if (window.scrollY > 200) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // Auto-resize vertical expansion
        temaInput.style.height = 'auto';
        temaInput.style.height = temaInput.scrollHeight + 'px';

        // Update character count
        const charCounter = document.getElementById('char-counter');
        if (charCounter) {
            const len = val.length;
            charCounter.textContent = `${len}/600`;
            if (len > 0) {
                charCounter.classList.add('visible');
            } else {
                charCounter.classList.remove('visible');
            }

            if (len > 550) {
                charCounter.style.color = '#ff5b5b'; // Red when approaching 600
            } else {
                charCounter.style.color = 'var(--muted)';
            }
        }

        if (val.length > 0) {
            temaError.classList.remove('visible');
        }

        validateGenerateButton();
    });

    // Enter key to advance
    temaInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!btnGenerate.disabled) {
                btnGenerate.click();
            }
        }
    });

    // Hide hero cursor on focus to avoid double-cursor visual overload (without layout shift)
    if (temaInput) {
        const heroCursor = document.querySelector('.hero-cursor');
        if (heroCursor) {
            // Check immediately on startup in case of browser autofocus
            if (document.activeElement === temaInput) {
                heroCursor.style.visibility = 'hidden';
            }

            temaInput.addEventListener('focus', () => {
                heroCursor.style.visibility = 'hidden';
            });
            temaInput.addEventListener('blur', () => {
                heroCursor.style.visibility = 'visible';
            });
        }
    }
}

window.AedosChatInput = Object.freeze({ createChatInputController, createGenerateButtonValidator, registerFillInput });
