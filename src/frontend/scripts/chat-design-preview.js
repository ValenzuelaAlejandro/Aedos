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
    const TIMING = Object.freeze({ analyze: 1900, design: 1700, perSlide: 480, compose: 2200, streamedSlide: 1100 });
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
                global.AedosThinking.show(aiBody, {
                    label: global.__t('chat_stage_analyze', 'Analyzing your request…'),
                    stage: 'stage1'
                });
                await wait(TIMING.analyze);
                global.AedosThinking.appendReasoning(aiBody, LOREM);
                global.AedosThinking.updateStatus(aiBody,
                    global.__t('chat_stage_design', 'Designing the visual direction…'), 'stage2');
                await wait(TIMING.design);
            }

            global.prepareOutlineStreaming('flash');
            const skeleton = buildSkeleton(wasFollowUp ? global.outlineEditorState.skeleton?.topic : promptText);
            for (let count = 1; count <= skeleton.slides.length; count += 1) {
                global.renderStreamingOutline({ ...skeleton, slides: skeleton.slides.slice(0, count) });
                await wait(TIMING.perSlide);
            }
            global.finalizeStreamingOutline(skeleton);
            if (aiBody && global.AedosThinking) {
                global.AedosThinking.collapse(aiBody);
            }
        } finally {
            isSimulating = false;
        }
    }

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[char]);
    }

    function slideMarkup(slide, index, total) {
        const points = (slide.key_points || []).slice(0, 3)
            .map(point => `<li>${escapeHtml(point)}</li>`).join('');
        return `<section class="s preview-demo-slide" data-slide="${index + 1}">
            <div class="preview-demo-kicker">LOREM IPSUM <span>${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span></div>
            <div class="preview-demo-rule"></div>
            <div class="preview-demo-copy"><h1>${escapeHtml(slide.title)}</h1><ul>${points}</ul></div>
            <div class="preview-demo-footer"><span>AEDOS</span><span>DESIGN PREVIEW</span></div>
        </section>`;
    }

    function presentationMarkup(slides) {
        const opening = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>$(title)</title>
            <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111}
            body{font-family:Inter,'DM Sans',Arial,sans-serif;color:#f6f3ed}
            .preview-demo-slide{position:relative;box-sizing:border-box;width:1122px;height:631px;padding:56px 70px;
            background:linear-gradient(145deg,#171a21 0%,#0e1015 65%,#171026 100%);overflow:hidden}
            .preview-demo-slide:nth-of-type(even){background:linear-gradient(145deg,#14121e,#101820 70%,#101114)}
            .preview-demo-slide:before{content:'';position:absolute;right:-110px;top:-135px;width:520px;height:520px;
            border:1px solid rgba(164,140,242,.25);border-radius:50%;box-shadow:0 0 0 80px rgba(164,140,242,.025),0 0 0 165px rgba(164,140,242,.02)}
            .preview-demo-kicker,.preview-demo-footer{position:relative;display:flex;justify-content:space-between;
            color:#b8a6e6;font-size:13px;font-weight:700;letter-spacing:.16em}
            .preview-demo-rule{position:relative;margin-top:23px;height:1px;background:rgba(255,255,255,.18)}
            .preview-demo-copy{position:relative;margin-top:98px;max-width:820px}
            h1{margin:0 0 36px;font-size:62px;line-height:1.08;letter-spacing:-.055em;font-weight:750}
            ul{list-style:none;margin:0;padding:0;display:grid;gap:18px;max-width:740px}
            li{font-size:23px;line-height:1.35;color:#d8d7df}
            li:before{content:'—';color:#b8a6e6;margin-right:16px}
            .preview-demo-footer{position:absolute;bottom:48px;left:70px;right:70px;color:#858294;font-size:11px}</style>
            </head><body>`;
        return { opening: opening.replace('$(title)', escapeHtml(slides[0]?.title || LOREM_PROMPT)),
            sections: slides.map((slide, index) => slideMarkup(slide, index, slides.length)),
            closing: '</body></html>' };
    }

    function createLocalGenerationResponse(options) {
        let skeleton;
        try {
            const payload = options.body instanceof FormData
                ? JSON.parse(options.body.get('skeleton')) : JSON.parse(options.body);
            skeleton = payload.slides ? payload : payload.skeleton;
        } catch (_) { /* The preview can still display its static sample. */ }
        const slides = Array.isArray(skeleton?.slides) && skeleton.slides.length
            ? skeleton.slides : buildSkeleton(LOREM_PROMPT).slides;
        const html = presentationMarkup(slides);
        const fullHtml = html.opening + html.sections.join('') + html.closing;
        const signal = options.signal;
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                const emit = value => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
                try {
                    for (const [stage, delay] of [['content', TIMING.analyze], ['design', TIMING.design], ['compositing', TIMING.compose]]) {
                        if (signal?.aborted) { controller.close(); return; }
                        emit({ pipeline: true, stage });
                        await wait(delay);
                    }
                    if (signal?.aborted) { controller.close(); return; }
                    emit({ chunk: html.opening + html.sections[0] });
                    for (let index = 1; index < html.sections.length; index += 1) {
                        await wait(TIMING.streamedSlide);
                        if (signal?.aborted) { controller.close(); return; }
                        emit({ chunk: html.sections[index] });
                    }
                    await wait(TIMING.streamedSlide);
                    if (!signal?.aborted) emit({ chunk: html.closing, done: true, html: fullHtml });
                    controller.close();
                } catch (error) { controller.error(error); }
            }
        });
        return Promise.resolve(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
    }

    function simulatePresentationCompletion() {
        if (isSimulating) return;
        global.proceedWithCurrentOutline();
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
        seedStartScreen();
        document.addEventListener('click', interceptGeneration, true);
        const actualFetch = global.fetch.bind(global);
        const actualStartFinalGeneration = global.startFinalGeneration;
        const actualProceedWithCurrentOutline = global.proceedWithCurrentOutline;
        global.fetch = (resource, options) => {
            if (resource === '/generate') return createLocalGenerationResponse(options || {});
            return actualFetch(resource, options);
        };
        global.startFinalGeneration = skeleton => {
            if (isSimulating) return;
            isSimulating = true;
            return Promise.resolve().then(() => actualStartFinalGeneration(skeleton))
                .finally(() => { isSimulating = false; });
        };
        global.proceedWithCurrentOutline = () => actualProceedWithCurrentOutline();
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
