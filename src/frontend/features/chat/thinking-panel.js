/**
 * Chat thinking panel — Claude-style UX for the wait phase.
 *
 * Replaces the legacy 3-dot "chat-thinking" loader with a panel that:
 *   - shows elapsed time updating every second (label: "Thinking for 12s…")
 *   - shows a pulsing live-dot anchored to a gradient accent bar on the left
 *   - can be expanded to reveal the model's internal reasoning in real time
 *   - collapses to a compact "Thought for 4s" pill once the response begins
 *     streaming, mirroring Claude.ai's behaviour
 *   - auto-scrolls its inner body to the bottom as new reasoning arrives
 *   - shows a subtle "drafting" placeholder when the model isn't emitting
 *     reasoning tokens (it might not support it)
 *
 * The panel is reused across three call sites:
 *   1. Initial chat send  →  skeleton generation   (Stage 1 thinking)
 *   2. "Create Presentation" proceed flow  →  Pro pipeline pre-streaming
 *      (Stages 1–2 thinking)
 *   3. Pre-Stage-3 HTML generation  →  same panel, updated label
 *
 * Public API (attached to window.AedosThinking):
 *   - show(aiBody, { label, stage })
 *       Inserts (or reuses) the panel inside the given `.chat-ai-body`.
 *       Starts the timer immediately. Returns the panel root element.
 *   - appendReasoning(aiBody, text)
 *       Appends a chunk of reasoning text to the panel body. Auto-expands
 *       the panel the first time reasoning arrives, then leaves the user in
 *       control.
 *   - collapse(aiBody)
 *       Hides the body and switches the header label to "Thought for Ns".
 *       Use this right before content starts streaming so the user keeps
 *       the panel visible (as a history pill) but it stops animating.
 *   - hide(aiBody)
 *       Removes the panel from the DOM and stops the timer. Use on
 *       cancellation, errors, or when the response is complete.
 *   - hasReasoning(aiBody)
 *       Returns true if the model emitted at least one reasoning token.
 *       Useful for the caller to decide whether to show a "no reasoning
 *       available" hint.
 *   - getPanel(aiBody)
 *       Returns the current panel root element (or null).
 *
 * The implementation is intentionally dependency-free (no GSAP, no Motion)
 * so the panel renders instantly without waiting for the bundle.
 */
(function () {
    'use strict';

    const STRINGS = {
        // The first word in the status text. Kept short and uppercase.
        thinking:  'Thinking',
        drafting:  'Drafting',
        designing: 'Designing',
        analyzing: 'Analyzing',
        composing: 'Composing',
        thoughtFor: (s) => `Thought for ${s}s`,
        // Shown when the body is expanded but the model hasn't emitted any
        // reasoning tokens. Tells the user the model may not support it
        // without making the panel feel broken.
        noReasoningHint: 'The model is not sharing its reasoning for this step.',
    };

    function formatSeconds(seconds) {
        if (seconds < 60) return String(seconds);
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    /**
     * Basic markdown parser for reasoning text.
     * Supports bold (**text**) and italic (*text* or _text_).
     */
    function formatMarkdown(text) {
        if (!text) return '';
        // Escape HTML to prevent XSS before applying markdown
        let escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        // Bold: **text**
        escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        // Italic: *text* or _text_
        escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');
        escaped = escaped.replace(/_(.*?)_/g, '<em>$1</em>');
        
        return escaped;
    }

    /**
     * Pick a short status word from the stage name. The full descriptive
     * label still appears in `data-status-label` (tooltip + accessibility).
     */
    function statusWordFor(stage, label) {
        if (stage === 'stage1') return STRINGS.analyzing;
        if (stage === 'stage2') return STRINGS.designing;
        if (stage === 'stage3' || stage === 'compositing') return STRINGS.composing;
        if (stage === 'flash') return STRINGS.drafting;
        // Default: use the first word of the label, or "Thinking" as fallback.
        if (label && typeof label === 'string') {
            const first = label.trim().split(/\s+/)[0];
            if (first) return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
        }
        return STRINGS.thinking;
    }

    function buildPanel() {
        const root = document.createElement('div');
        root.className = 'chat-thinking-panel is-active';
        root.setAttribute('role', 'status');
        root.setAttribute('aria-live', 'polite');
        root.setAttribute('aria-busy', 'true');

        root.innerHTML = `
            <button type="button" class="chat-thinking-header" aria-expanded="false">
                <span class="chat-thinking-status" aria-hidden="true">
                    <span class="chat-thinking-status-mark"></span>
                    <span class="chat-thinking-status-text">${STRINGS.thinking}</span>
                </span>
                <span class="chat-thinking-label"></span>
                <span class="chat-thinking-timer" data-role="timer">0s</span>
                <span class="chat-thinking-chevron" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </span>
            </button>
            <div class="chat-thinking-body" hidden>
                <div class="chat-thinking-content markdown-body" data-role="content"></div>
            </div>
        `;

        const headerBtn = root.querySelector('.chat-thinking-header');
        const body = root.querySelector('.chat-thinking-body');
        const labelEl = root.querySelector('.chat-thinking-label');
        const statusTextEl = root.querySelector('.chat-thinking-status-text');
        const timerEl = root.querySelector('.chat-thinking-timer');
        const contentEl = root.querySelector('.chat-thinking-content');

        // Track whether the user has manually toggled the panel. When true,
        // we stop auto-expanding/collapsing the body for them.
        headerBtn.addEventListener('click', () => {
            root.dataset.userToggled = '1';
            const expanded = headerBtn.getAttribute('aria-expanded') === 'true';
            const next = !expanded;
            headerBtn.setAttribute('aria-expanded', next ? 'true' : 'false');
            if (next) {
                body.removeAttribute('hidden');
                root.classList.add('is-expanded');
            } else {
                body.setAttribute('hidden', '');
                root.classList.remove('is-expanded');
            }
        });

        return { root, labelEl, statusTextEl, timerEl, contentEl, body, headerBtn };
    }

    function getState(aiBody) {
        return aiBody && aiBody.__aedosThinkingState ? aiBody.__aedosThinkingState : null;
    }

    function stopTimer(localState) {
        if (localState && localState.intervalId) {
            clearInterval(localState.intervalId);
            localState.intervalId = null;
        }
    }

    /**
     * Show the "no reasoning" hint inside the body. Idempotent.
     */
    function showNoReasoningHint(aiBody) {
        const localState = getState(aiBody);
        if (!localState) return;
        const { refs } = localState;
        if (refs.contentEl.querySelector('.chat-thinking-empty')) return;
        // Clear whatever was there (defensive) and inject the hint.
        refs.contentEl.textContent = '';
        const hint = document.createElement('div');
        hint.className = 'chat-thinking-empty';
        hint.textContent = STRINGS.noReasoningHint;
        refs.contentEl.appendChild(hint);
        refs.root.classList.add('has-content');
        // Make sure the body is visible so the user actually sees the hint.
        if (!refs.root.classList.contains('is-expanded') && !refs.root.dataset.userToggled) {
            refs.body.removeAttribute('hidden');
            refs.headerBtn.setAttribute('aria-expanded', 'true');
            refs.root.classList.add('is-expanded');
        }
    }

    /**
     * Insert (or replace) the thinking panel inside the given AI message body.
     * Each AI message body gets its own panel instance and its own local
     * runtime state stored directly on that `aiBody`, so overlapping requests
     * do not fight over a shared global singleton.
     */
    function show(aiBody, options = {}) {
        if (!aiBody) return null;

        // Reset any previous local timers for this specific AI bubble before
        // reusing its panel.
        const previousState = getState(aiBody);
        stopTimer(previousState);
        if (previousState && previousState.noReasoningTimer) {
            clearTimeout(previousState.noReasoningTimer);
            previousState.noReasoningTimer = null;
        }

        // Check if this specific body already has an associated panel.
        // We store the refs on the body itself to support multiple panels.
        let refs = aiBody.__aedosThinkingRefs || null;

        if (!refs) {
            refs = buildPanel();
            aiBody.__aedosThinkingRefs = refs;

            // If the body already has legacy chat-thinking dots, remove them
            const legacyDots = aiBody.querySelector('.chat-thinking');
            if (legacyDots) legacyDots.remove();

            // Also remove any existing proceed/progress messages to replace them with the thinking panel
            const proceedMessages = aiBody.querySelectorAll('.chat-proceed-message, .chat-error-message');
            proceedMessages.forEach(msg => msg.remove());

            // Insert at the top of the AI bubble.
            aiBody.insertBefore(refs.root, aiBody.firstChild);
        } else {
            refs.root.classList.remove('is-collapsed', 'is-hidden');
            refs.root.removeAttribute('hidden');
        }

        const fullLabel = options.label || 'Thinking…';
        refs.labelEl.textContent = fullLabel;
        refs.statusTextEl.textContent = statusWordFor(options.stage, fullLabel);
        refs.timerEl.textContent = '0s';
        refs.contentEl.textContent = '';
        refs.body.setAttribute('hidden', '');
        refs.headerBtn.setAttribute('aria-expanded', 'false');
        refs.root.classList.remove('is-expanded', 'is-collapsed', 'has-content');
        refs.root.classList.add('is-active');
        delete refs.root.dataset.userToggled;

        if (options.stage) refs.root.dataset.stage = options.stage;
        else delete refs.root.dataset.stage;

        const startTime = Date.now();
        const localState = {
            parent: aiBody,
            refs,
            startTime,
            fullReasoning: '',
            receivedReasoning: false,
            noReasoningTimer: null,
            intervalId: setInterval(() => {
                const currentState = getState(aiBody);
                if (!currentState || currentState !== localState || currentState.refs !== refs) return;
                const elapsed = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
                refs.timerEl.textContent = formatSeconds(elapsed);
            }, 1000)
        };
        aiBody.__aedosThinkingState = localState;

        // If the model never produces any reasoning tokens within ~3.5s, we
        // assume it doesn't support it and surface a subtle hint. This avoids
        // leaving the user staring at an empty body wondering what's broken.
        if (localState.noReasoningTimer) clearTimeout(localState.noReasoningTimer);
        localState.noReasoningTimer = setTimeout(() => {
            const currentState = getState(aiBody);
            if (currentState && currentState === localState && !currentState.receivedReasoning) {
                showNoReasoningHint(aiBody);
            }
        }, 3500);

        return refs.root;
    }

    function appendReasoning(aiBody, text) {
        const localState = getState(aiBody);
        if (!localState || !text) return;
        const { refs, startTime } = localState;

        // The first real token cancels the "no reasoning" hint timer and
        // clears any hint placeholder that may have been rendered.
        if (!localState.receivedReasoning) {
            localState.receivedReasoning = true;
            if (localState.noReasoningTimer) {
                clearTimeout(localState.noReasoningTimer);
                localState.noReasoningTimer = null;
            }
            const hint = refs.contentEl.querySelector('.chat-thinking-empty');
            if (hint) hint.remove();
        }

        /**
         * Robust reasoning update:
         * Some models (like Gemini 2.0 Flash Thinking) send the FULL accumulated 
         * reasoning string in every chunk, while others send only deltas.
         * We detect if the incoming text is a superset of what we already have.
         */
        if (text.length > localState.fullReasoning.length && text.startsWith(localState.fullReasoning)) {
            // It's the full string so far (cumulative)
            localState.fullReasoning = text;
        } else {
            // It's a delta, append it
            localState.fullReasoning += text;
        }

        // Apply basic markdown and update the DOM.
        // We use innerHTML for markdown support, but formatMarkdown escapes HTML first.
        refs.contentEl.innerHTML = formatMarkdown(localState.fullReasoning);

        // Auto-expand the panel the first time reasoning arrives, unless the
        // user has already interacted with it.
        if (!refs.root.classList.contains('is-expanded') && !refs.root.dataset.userToggled) {
            refs.body.removeAttribute('hidden');
            refs.headerBtn.setAttribute('aria-expanded', 'true');
            refs.root.classList.add('is-expanded', 'has-content');
        }

        // Keep the content scrolled to the bottom so the user sees new tokens.
        refs.body.scrollTop = refs.body.scrollHeight;

        // Update the label so the user sees the total thinking time as it
        // accumulates (e.g. "Thinking for 7s" instead of "Thinking…").
        const elapsed = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
        refs.labelEl.textContent = `${STRINGS.thinking} for ${elapsed}s`;
    }

    function collapse(aiBody) {
        const localState = getState(aiBody);
        if (!localState) return;
        const { refs, startTime, receivedReasoning } = localState;
        stopTimer(localState);
        if (localState.noReasoningTimer) {
            clearTimeout(localState.noReasoningTimer);
            localState.noReasoningTimer = null;
        }
        const elapsed = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
        // When reasoning was actually received, use "Thought for Ns". When
        // it wasn't, use a more neutral "Step completed" so we don't lie.
        if (receivedReasoning) {
            refs.labelEl.textContent = STRINGS.thoughtFor(elapsed);
        } else {
            refs.labelEl.textContent = `Step completed in ${elapsed}s`;
        }
        refs.timerEl.textContent = '';
        refs.root.classList.add('is-collapsed');
        refs.root.classList.remove('is-active', 'is-expanded');
        refs.headerBtn.setAttribute('aria-expanded', 'false');
        refs.body.setAttribute('hidden', '');
    }

    function hide(aiBody) {
        const localState = getState(aiBody);
        if (!localState) return;
        stopTimer(localState);
        if (localState.noReasoningTimer) {
            clearTimeout(localState.noReasoningTimer);
            localState.noReasoningTimer = null;
        }
        if (localState.refs && localState.refs.root && localState.refs.root.parentNode) {
            localState.refs.root.parentNode.removeChild(localState.refs.root);
        }
        // Clean up the reference on the parent body so a new panel can be
        // created later if needed.
        if (localState.parent && localState.parent.__aedosThinkingRefs) {
            delete localState.parent.__aedosThinkingRefs;
        }
        if (localState.parent && localState.parent.__aedosThinkingState) {
            delete localState.parent.__aedosThinkingState;
        }
    }

    function hasReasoning(aiBody) {
        const localState = getState(aiBody);
        return !!(localState && localState.receivedReasoning);
    }

    function getPanel(aiBody) {
        if (!aiBody) return null;
        const localState = getState(aiBody);
        if (localState && localState.refs && localState.refs.root) return localState.refs.root;
        return aiBody.__aedosThinkingRefs ? aiBody.__aedosThinkingRefs.root : null;
    }

    window.AedosThinking = {
        show,
        appendReasoning,
        collapse,
        hide,
        hasReasoning,
        getPanel,
    };
})();
