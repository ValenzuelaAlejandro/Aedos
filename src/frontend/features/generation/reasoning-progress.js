(function registerReasoningProgress(global) {
    'use strict';

    /**
     * @typedef {Object} ReasoningProgressDependencies
     * @property {Window} window Existing thinking-panel and localization APIs.
     * @property {Document} document Existing conversation document.
     */

    /** Create the existing SSE reasoning-token presenter. @param {ReasoningProgressDependencies} deps */
    function createReasoningProgress({ window, document }) {
        return function appendReasoningProgress(parsed) {
            const allAiBodies = document.querySelectorAll('.chat-msg-ai .chat-ai-body');
            const aiBody = allAiBodies[allAiBodies.length - 1];
            if (aiBody && window.AedosThinking) {
                const stageKeys = {
                    stage1: 'chat_stage_analyze',
                    stage2: 'chat_stage_design',
                    stage3: 'chat_stage_compose',
                    flash: 'chat_stage_draft'
                };
                const stageKey = stageKeys[parsed.stage] || 'chat_stage_compose';
                const fallbackLabel = parsed.stage === 'stage1' ? 'Analyzing your request…'
                    : parsed.stage === 'stage2' ? 'Designing the visual direction…'
                        : parsed.stage === 'flash' ? 'Drafting your slides…' : 'Building your slides…';
                const label = window.__t ? window.__t(stageKey, fallbackLabel) : fallbackLabel;
                if (!window.AedosThinking.getPanel(aiBody)) {
                    window.AedosThinking.show(aiBody, {
                        label,
                        stage: parsed.stage || 'flash'
                    });
                } else {
                    window.AedosThinking.updateStatus(aiBody, label, parsed.stage || 'flash');
                }
                window.AedosThinking.appendReasoning(aiBody, parsed.reasoning);
            }
        };
    }

    global.AedosGeneration = global.AedosGeneration || {};
    global.AedosGeneration.createReasoningProgress = createReasoningProgress;
})(window);
