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
                if (!window.AedosThinking.getPanel(aiBody)) {
                    const stageMap = {
                        stage1: 'Analyzing request…',
                        stage2: 'Designing visuals…',
                        stage3: 'Composing slides…',
                        flash: 'Drafting slides…'
                    };
                    const fallbackLabel = stageMap[parsed.stage] || 'Thinking…';
                    window.AedosThinking.show(aiBody, {
                        label: window.__t ? window.__t('chat_thinking', fallbackLabel) : fallbackLabel,
                        stage: parsed.stage || 'flash'
                    });
                }
                window.AedosThinking.appendReasoning(aiBody, parsed.reasoning);
            }
        };
    }

    global.AedosGeneration = global.AedosGeneration || {};
    global.AedosGeneration.createReasoningProgress = createReasoningProgress;
})(window);
