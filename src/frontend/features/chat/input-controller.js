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

window.AedosChatInput = Object.freeze({ createChatInputController });
