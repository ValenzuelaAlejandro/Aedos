(function registerAedosGenerationErrorPresenter(root) {
    const api = root.AedosGeneration || (root.AedosGeneration = {});

    /**
     * @typedef {Object} GenerationErrorPresenterDeps
     * @property {Window} window Browser globals used for localization and animation.
     * @property {Document} document Main application document.
     * @property {Object} uiLog UI logger.
     * @property {HTMLElement|null} errorMessage Error message node.
     * @property {HTMLElement} previewContainer Preview state container.
     * @property {HTMLElement} chatScreen Chat screen node.
     * @property {Function} showErrorModal Displays the error modal.
     * @property {Function} clearInterval Clears the legacy proceed-message timer.
     */

    /**
     * Create the generation-failure presentation routine.
     * @param {GenerationErrorPresenterDeps} deps Shared DOM and browser dependencies.
     * @returns {(error: Error, iframeDoc: Document, hasTransitioned: boolean) => void}
     */
    // eslint-disable-next-line max-lines-per-function -- This factory closes over the dependencies for one legacy handler.
    api.createErrorPresenter = function createErrorPresenter(deps) {
        const {
            window,
            document,
            uiLog,
            errorMessage,
            previewContainer,
            chatScreen,
            showErrorModal,
            clearInterval,
        } = deps;

        // eslint-disable-next-line max-lines-per-function, complexity -- Keep the legacy error branches and cleanup order together.
        return function presentGenerationError(error, iframeDoc, hasTransitioned) {
uiLog.error('GENERATION', 'Presentation generation failed', { error });

const errTitle = document.getElementById('t-error-title');
const errSubtitle = document.getElementById('t-error-subtitle');

// Default titles/subtitles
if (errTitle) errTitle.textContent = window.__t ? window.__t('error_title', "Something didn't go as planned") : "Something didn't go as planned";
if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('error_subtitle', "The AI service is temporarily unavailable. This is usually resolved quickly.") : "The AI service is temporarily unavailable. This is usually resolved quickly.";

const rawMsg = error.message || '';
const retryAfterMatch = rawMsg.match(/\|RETRY_AFTER=(\d+)/);
const retryAfterSec = retryAfterMatch ? parseInt(retryAfterMatch[1], 10) : null;
const msg = rawMsg.replace(/\|RETRY_AFTER=\d+/, '');

if (msg.includes('DAILY_LIMIT_EXCEEDED_FLASH') || msg.includes('DAILY_LIMIT_EXCEEDED_PRO') || msg.includes('DAILY_LIMIT_EXCEEDED_CHAT')) {
    if (errTitle) errTitle.textContent = window.__t ? window.__t('daily_limit_title', "You've reached today's limit") : "You've reached today's limit";
    if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('daily_limit_msg', "Free generations reset every 24 hours. Come back tomorrow or try again later.") : "Free generations reset every 24 hours. Come back tomorrow or try again later.";
} else if (msg.includes('COOLDOWN_ACTIVE')) {
    if (errTitle) errTitle.textContent = window.__t ? window.__t('cooldown_title', "Wait a moment") : "Wait a moment";
    if (errSubtitle) {
        if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
            const tpl = window.__t
                ? window.__t('cooldown_msg_with_seconds', "Please wait {sec}s before generating again.")
                : "Please wait {sec}s before generating again.";
            errSubtitle.textContent = tpl.replace('{sec}', String(retryAfterSec));
        } else {
            errSubtitle.textContent = window.__t ? window.__t('cooldown_msg', "Please wait at least one minute between generations.") : "Please wait at least one minute between generations.";
        }
    }
} else if (msg.includes('GLOBAL_DAILY_LIMIT_EXCEEDED')) {
    if (errTitle) errTitle.textContent = window.__t ? window.__t('global_daily_limit_title', "Today's global capacity was reached") : "Today's global capacity was reached";
    if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('global_daily_limit_msg', "The system reached its daily generation capacity. Please try again tomorrow.") : "The system reached its daily generation capacity. Please try again tomorrow.";
} else if (msg.includes('QUEUE_FULL')) {
    if (errTitle) errTitle.textContent = window.__t ? window.__t('queue_full_title', "Queue is full right now") : "Queue is full right now";
    if (errSubtitle) {
        if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
            const tpl = window.__t
                ? window.__t('queue_full_msg_with_seconds', "Too many simultaneous requests. Try again in {sec}s.")
                : "Too many simultaneous requests. Try again in {sec}s.";
            errSubtitle.textContent = tpl.replace('{sec}', String(retryAfterSec));
        } else {
            errSubtitle.textContent = window.__t ? window.__t('queue_full_msg', "Too many simultaneous requests. Try again in a few seconds.") : "Too many simultaneous requests. Try again in a few seconds.";
        }
    }
} else if (msg.includes('PRO_TEMPORARILY_PAUSED')) {
    if (errTitle) errTitle.textContent = window.__t ? window.__t('pro_paused_title', "Pro mode is temporarily paused") : "Pro mode is temporarily paused";
    if (errSubtitle) {
        if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
            const tpl = window.__t
                ? window.__t('pro_paused_msg_with_seconds', "High load detected. Retry Pro mode in {sec}s or switch to Flash mode.")
                : "High load detected. Retry Pro mode in {sec}s or switch to Flash mode.";
            errSubtitle.textContent = tpl.replace('{sec}', String(retryAfterSec));
        } else {
            errSubtitle.textContent = window.__t ? window.__t('pro_paused_msg', "High load detected. Please retry Pro mode shortly or switch to Flash mode.") : "High load detected. Please retry Pro mode shortly or switch to Flash mode.";
        }
    }
} else if (msg.includes('RATE_LIMIT_EXCEEDED')) {
    if (errTitle) errTitle.textContent = window.__t ? window.__t('rate_limit_title', "Slow down a bit") : "Slow down a bit";
    if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('rate_limit_msg', "Too many requests in a short time. Wait a few minutes and try again.") : "Too many requests in a short time. Wait a few minutes and try again.";
} else if (msg.includes('TOPIC_TOO_LONG')) {
    if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('topic_too_long', "The topic is too long. Keep it under 600 characters.") : "The topic is too long. Keep it under 600 characters.";
} else if (msg.includes('SKELETON_EMPTY')) {
    if (errTitle) errTitle.textContent = window.__t ? window.__t('outline_empty_title', "Outline is empty") : "Outline is empty";
    if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('outline_empty_msg', "Please add at least one slide to your outline before generating.") : "Please add at least one slide to your outline before generating.";
} else if (msg.includes('GENERATION_OUTPUT_TOO_LARGE')) {
    if (errTitle) errTitle.textContent = window.__t ? window.__t('generation_too_large_title', "The presentation is too large") : "The presentation is too large";
    if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('generation_too_large_msg', "Try fewer slides or a shorter description, then generate it again.") : "Try fewer slides or a shorter description, then generate it again.";
} else {
    // Try to extract "Please retry in X seconds" from Gemini standard errors
    let retryMsg = "";
                const retryMatch = msg.match(/retry in ([\d.]+)s/i);
    if (retryMatch) {
        const seconds = Math.ceil(parseFloat(retryMatch[1]));
        const timeStr = seconds >= 60
            ? `${Math.ceil(seconds / 60)} min`
            : `${seconds}s`;
        const retryTpl = window.__t ? window.__t(window.currentLang === 'es' ? 'retry_in_es' : 'retry_in_en', "<br><br><strong>Retry in: {time}</strong>") : "<br><br><strong>Retry in: {time}</strong>";
        retryMsg = retryTpl.replace('{time}', timeStr);
    }

    if (msg.includes('429') || msg.includes('503') || msg.toLowerCase().includes('exhausted') || msg.toLowerCase().includes('saturated')) {
        if (errTitle) errTitle.textContent = window.__t ? window.__t('overloaded_title', "High demand right now") : "High demand right now";
        if (errSubtitle) {
            errSubtitle.innerHTML = (window.__t ? window.__t('t-error-saturated', "The service is a bit overwhelmed at the moment. Usually clears up in a few minutes.") : "The service is a bit overwhelmed at the moment. Usually clears up in a few minutes.") + retryMsg;
        }
    }
}


errorMessage.textContent = msg;
previewContainer.classList.remove('is-generating', 'is-awaiting-first-slide', 'is-settling', 'is-editor-ready', 'reveal-sequence', 'reveal-minimap', 'reveal-tools');

// Clean up split outline layout and reset hero
document.body.classList.remove('split-outline-active');
const btnOutlineGenerate = document.getElementById('btn-outline-generate');
if (btnOutlineGenerate) {
    btnOutlineGenerate.classList.remove('is-generating');
}
const heroTextSpan = document.querySelector('.hero-title-text');
if (heroTextSpan && heroTextSpan.getAttribute('data-original-text')) {
    heroTextSpan.textContent = heroTextSpan.getAttribute('data-original-text');
    heroTextSpan.parentElement.classList.remove('waiting-state');
}
// Clean up infinite loader/spinner in the chat bubbles to prevent hanging states on rate-limits
if (window._proceedMsgInterval) {
    clearInterval(window._proceedMsgInterval);
    window._proceedMsgInterval = null;
}
const activeProceedMsg = document.querySelector('.chat-proceed-message');
if (activeProceedMsg) {
    activeProceedMsg.innerHTML = `<span style="color: var(--danger); font-size: 1.2rem; display: inline-block;">⚠</span> <span style="color: var(--danger); font-weight: 500;">${window.__t ? window.__t('generation_failed_chat', 'Generation failed') : 'Generation failed'}: ${msg}</span>`;
    if (window.gsap) {
        window.gsap.fromTo(activeProceedMsg, { opacity: 0 }, { opacity: 1, duration: 0.3 });
    }
}
// Clean up dynamic thinking loading state in the latest active AI bubble
const aiBubbles = document.querySelectorAll('.chat-msg-ai');
const latestAiBubble = aiBubbles[aiBubbles.length - 1];
if (latestAiBubble) {
    const thinking = latestAiBubble.querySelector('.chat-thinking');
    if (thinking) thinking.classList.add('hidden');
} else {
    const thinking = document.getElementById('chat-thinking');
    if (thinking) thinking.classList.add('hidden');
}

// Clean up any in-progress chat→preview transition
        if (!hasTransitioned) {
    chatScreen.style.cssText = '';
    chatScreen.classList.remove('hidden');
}
iframeDoc.close();
// Show error overlay on top of whatever is visible; dismiss → go to home
showErrorModal(() => {
    window.navigateToHome();
});
        };
    };
})(typeof window !== 'undefined' ? window : globalThis);
