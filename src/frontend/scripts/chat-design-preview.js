(function registerChatDesignPreview(global) {
    'use strict';

    const requested = new URLSearchParams(global.location.search).get('design-preview') === 'chat';
    global.__AEDOS_CHAT_DESIGN_PREVIEW__ = false;
    if (!requested) return;

    // Hold generation clicks until the server confirms this is a dev session.
    function blockPendingGeneration(event) {
        const target = event.target instanceof Element
            ? event.target.closest('#btn-generate, #btn-outline-generate, [data-outline-generate], .suggested-chip')
            : null;
        if (!target) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }
    document.addEventListener('click', blockPendingGeneration, true);

    const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';
    const LOREM_PROMPT = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
    let isSimulating = false;
    let revision = 0;

    function buildSkeleton(topic) {
        revision += 1;
        return {
            topic: topic || LOREM_PROMPT,
            subtitle_context: LOREM,
            tone: 'academic',
            audience: 'general',
            density: 'medium',
            language: 'es',
            suggested_chips: ['Lorem ipsum dolor sit amet', 'Lorem ipsum consectetur adipiscing'],
            slides: [
                { title: 'Lorem ipsum dolor sit amet', role: 'opening', key_points: ['Lorem ipsum dolor sit amet, consectetur adipiscing elit.', 'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.'] },
                { title: 'Consectetur adipiscing elit', role: 'process', key_points: ['Ut enim ad minim veniam, quis nostrud exercitation ullamco.', 'Duis aute irure dolor in reprehenderit in voluptate velit esse.'] },
                { title: 'Sed do eiusmod tempor', role: 'process', key_points: ['Excepteur sint occaecat cupidatat non proident.', 'Sunt in culpa qui officia deserunt mollit anim id est laborum.'] },
                { title: 'Ut enim ad minim veniam', role: 'conclusion', key_points: ['Lorem ipsum dolor sit amet, consectetur adipiscing elit.', 'Nunc vitae justo eget arcu facilisis tincidunt.'] },
                { title: 'Duis aute irure dolor', role: 'conclusion', key_points: ['Sed ut perspiciatis unde omnis iste natus error.', 'At vero eos et accusamus et iusto odio dignissimos.'] },
            ],
            designPreviewRevision: revision,
        };
    }

    function wait(milliseconds) {
        return new Promise(resolve => global.setTimeout(resolve, milliseconds));
    }

    function loadPreviewStyles() {
        const styleLink = document.createElement('link');
        styleLink.rel = 'stylesheet';
        styleLink.href = 'styles/chat-design-preview.css?v=3';
        document.head.appendChild(styleLink);
    }

    function seedStartScreen() {
        const input = document.getElementById('w-tema');
        if (!input) return;
        input.value = LOREM_PROMPT;
        input.style.height = 'auto';
        input.style.height = `${input.scrollHeight}px`;
        const counter = document.getElementById('char-counter');
        if (counter) {
            counter.textContent = `${input.value.length}/600`;
            counter.classList.add('visible');
        }
        const suggestions = document.getElementById('suggestion-pills-row');
        suggestions?.classList.add('is-dismissed');
        suggestions?.setAttribute('aria-hidden', 'true');
        if (typeof global.validateGenerateButton === 'function') global.validateGenerateButton();
    }

    function latestAiBody() {
        const messages = document.querySelectorAll('.chat-msg-ai .chat-ai-body');
        return messages[messages.length - 1] || null;
    }

    async function simulateOutline(promptText) {
        if (isSimulating) return;
        isSimulating = true;
        const wasFollowUp = !!global.outlineEditorState?.skeleton;
        try {
            const input = document.getElementById('w-tema');
            if (input) input.value = promptText;
            global.showOutlineEditorLoading(5);

            const aiBody = latestAiBody();
            if (aiBody && global.AedosThinking) {
                global.AedosThinking.appendReasoning(aiBody, LOREM);
            }

            global.prepareOutlineStreaming('flash');
            const skeleton = buildSkeleton(wasFollowUp ? global.outlineEditorState.skeleton?.topic : promptText);
            for (let count = 1; count <= skeleton.slides.length; count += 1) {
                global.renderStreamingOutline({ ...skeleton, slides: skeleton.slides.slice(0, count) });
                await wait(190);
            }
            global.finalizeStreamingOutline(skeleton);
            document.querySelectorAll('.chat-thinking').forEach(element => element.classList.add('hidden'));
            if (aiBody && global.AedosThinking) {
                global.AedosThinking.collapse(aiBody, 'Lorem ipsum · 1 s');
            }
        } finally {
            isSimulating = false;
        }
    }

    function simulatePresentationCompletion() {
        if (isSimulating) return;
        const conversation = document.getElementById('conversation-zone');
        const sourceAvatar = document.querySelector('#chat-ai-response .chat-ai-avatar');
        if (!conversation) return;

        const message = document.createElement('div');
        message.className = 'chat-msg chat-msg-ai';
        message.dataset.designPreview = 'presentation-complete';
        const avatar = sourceAvatar?.cloneNode(true);
        if (avatar) message.appendChild(avatar);
        const body = document.createElement('div');
        body.className = 'chat-ai-body';
        const card = document.createElement('div');
        card.className = 'chat-design-preview-complete';
        const title = document.createElement('strong');
        title.textContent = 'Lorem ipsum dolor sit amet';
        const copy = document.createElement('p');
        copy.textContent = LOREM;
        const status = document.createElement('span');
        status.textContent = `Lorem ipsum · ${global.__t('design_preview_status')}`;
        card.append(title, copy, status);
        body.appendChild(card);
        message.appendChild(body);
        conversation.appendChild(message);
        document.getElementById('chat-screen')?.scrollTo({ top: conversation.scrollHeight, behavior: 'smooth' });
    }

    function interceptGeneration(event) {
        const target = event.target instanceof Element
            ? event.target.closest('#btn-generate, #btn-outline-generate, [data-outline-generate], .suggested-chip')
            : null;
        if (!target) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (isSimulating) return;

        if (target.matches('#btn-outline-generate, [data-outline-generate], .suggested-chip.chip-primary')) {
            simulatePresentationCompletion();
            return;
        }

        const input = document.getElementById('w-tema');
        const promptText = target.matches('.suggested-chip')
            ? LOREM_PROMPT
            : (input?.value.trim() || '');
        if (promptText) simulateOutline(promptText);
    }

    function initialize() {
        loadPreviewStyles();
        seedStartScreen();
        document.addEventListener('click', interceptGeneration, true);
        // Guard alternate entry points that can reach the paid generation flow.
        global.proceedWithCurrentOutline = simulatePresentationCompletion;
        global.startFinalGeneration = simulatePresentationCompletion;
    }

    async function enableInDevelopment() {
        try {
            const response = await global.fetch('/__dev__/chat-design-preview', { cache: 'no-store' });
            if (!response.ok || (await response.json()).enabled !== true) return;
            global.__AEDOS_CHAT_DESIGN_PREVIEW__ = true;
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', initialize, { once: true });
            } else {
                initialize();
            }
        } catch (_) { /* The preview stays disabled outside the development server. */ }
        finally {
            document.removeEventListener('click', blockPendingGeneration, true);
        }
    }

    enableInDevelopment();
})(window);
