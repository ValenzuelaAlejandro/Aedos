(function registerStageProgress(global) {
    'use strict';

    /**
     * @typedef {Object} StageProgressDependencies
     * @property {Window} window Existing localization and animation APIs.
     * @property {HTMLElement} previewContainer Live preview root.
     * @property {HTMLButtonElement} generateBtn Existing send button.
     * @property {Function} pauseBtnMessages Existing button message timer control.
     * @property {Function} setPreviewStreamStatus Existing accessible status updater.
     * @property {Function} animateHeroTitle Existing hero title animation.
     */

    /** Create the existing SSE pipeline stage presenter. @param {StageProgressDependencies} deps */
    function createStageProgress(deps) {
        const { window, previewContainer, generateBtn, pauseBtnMessages, setPreviewStreamStatus, animateHeroTitle } = deps;

        return function showStageProgress(parsed) {
            pauseBtnMessages();
            let stageText;
            if (parsed.status === 'retrying') {
                const tpl = window.__t
                    ? window.__t('stage_retry', 'The AI stumbled — retrying ({attempt}/{maxAttempts})...')
                    : 'The AI stumbled — retrying ({attempt}/{maxAttempts})...';
                const attempt = Number.isFinite(parsed.attempt) ? parsed.attempt : '?';
                const maxAttempts = Number.isFinite(parsed.maxAttempts) ? parsed.maxAttempts : '?';
                stageText = tpl.replace('{attempt}', String(attempt)).replace('{maxAttempts}', String(maxAttempts));
            } else {
                const stageI18nKeys = {
                    content: 'stage_content',
                    design: 'stage_design',
                    compositing: 'stage_compositing'
                };
                const stageFallbacks = {
                    content: 'Analyzing content...',
                    design: 'Resolving design...',
                    compositing: 'Composing slides...'
                };
                const i18nKey = stageI18nKeys[parsed.stage];
                stageText = i18nKey
                    ? (window.__t ? window.__t(i18nKey, stageFallbacks[parsed.stage]) : stageFallbacks[parsed.stage])
                    : parsed.stage;
            }
            if (previewContainer && previewContainer.classList.contains('is-generating')) setPreviewStreamStatus(stageText);
            if (typeof animateHeroTitle === 'function') animateHeroTitle(stageText);
            const label = generateBtn.querySelector('.btn-generate-label');
            if (label) {
                if (window.gsap) {
                    window.gsap.to(label, {
                        opacity: 0,
                        y: -5,
                        duration: 0.2,
                        onComplete: () => {
                            label.textContent = stageText;
                            window.gsap.fromTo(label, { opacity: 0, y: 5 }, { opacity: 1, y: 0, duration: 0.25, ease: 'power2.out' });
                        }
                    });
                } else {
                    label.textContent = stageText;
                }
            }
        };
    }

    global.AedosGeneration = global.AedosGeneration || {};
    global.AedosGeneration.createStageProgress = createStageProgress;
})(window);
