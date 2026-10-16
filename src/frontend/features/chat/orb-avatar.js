/* Canvas adapter for the MIT-licensed thinking-orbs geometry engine. */
(function registerAedosOrbs(global) {
    'use strict';

    const engineUrl = new URL('thinking-orbs-engine.js', document.currentScript.src).href;
    const engineReady = import(engineUrl);
    const reducedMotion = global.matchMedia('(prefers-reduced-motion: reduce)');
    const colorScheme = global.matchMedia('(prefers-color-scheme: dark)');
    let previewOrb = null;
    let previewOrbState = 'working';

    function isDark() {
        const theme = document.documentElement.dataset.theme;
        if (theme === 'dark') return true;
        if (theme === 'light') return false;
        return colorScheme.matches;
    }

    // eslint-disable-next-line max-lines-per-function -- Canvas lifecycle, animation state, observers, and cleanup share one controller closure.
    function mount(target, { state = 'working', size = 20, displaySize = size, paused = false } = {}) {
        if (!target) return null;
        if (target.__aedosOrb) {
            target.__aedosOrb.setState(state);
            target.__aedosOrb.setPaused(paused);
            target.__aedosOrb.setSize(size, displaySize);
            return target.__aedosOrb;
        }

        const previousContent = Array.from(target.childNodes);
        const canvas = document.createElement('canvas');
        canvas.className = 'aedos-thinking-orb';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.width = `${displaySize}px`;
        canvas.style.height = `${displaySize}px`;
        canvas.style.display = 'block';
        let renderSize = size;
        let renderDisplaySize = displaySize;
        let bitmapScale = 1;
        function resizeCanvas() {
            const maxBitmapSize = 1536;
            const cssSize = canvas.getBoundingClientRect().width || renderDisplaySize;
            const renderScale = Math.min(global.devicePixelRatio || 1, maxBitmapSize / cssSize);
            canvas.width = Math.max(1, Math.round(cssSize * renderScale));
            canvas.height = canvas.width;
            bitmapScale = canvas.width / renderSize;
            canvas.style.width = `${renderDisplaySize}px`;
            canvas.style.height = `${renderDisplaySize}px`;
        }
        resizeCanvas();
        target.replaceChildren(canvas);
        const sizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null;
        sizeObserver?.observe(canvas);
        global.addEventListener('resize', sync, { passive: true });

        let engine = null;
        let modeState = state;
        let isPaused = paused;
        let visible = true;
        let frameId = null;
        let destroyed = false;
        const ctx = canvas.getContext('2d');

        function paint(time) {
            if (!engine || !ctx || destroyed || !canvas.isConnected || !canvas.clientWidth || !canvas.clientHeight
                || !engine.STATE_TO_MODE[modeState] || !Number.isFinite(time)) return false;
            try {
                const { mode, speed, opts } = engine.resolvePreset(modeState, renderSize);
                if (typeof engine.MODE_DRAWS[mode] !== 'function') return false;
                ctx.setTransform(bitmapScale, 0, 0, bitmapScale, 0, 0);
                ctx.clearRect(0, 0, renderSize, renderSize);
                engine.MODE_DRAWS[mode](ctx, renderSize, time * speed, isDark(), opts);
                return true;
            } catch (_) {
                stop();
                return false;
            }
        }

        function stop() {
            if (frameId !== null) global.cancelAnimationFrame(frameId);
            frameId = null;
        }

        function tick() {
            frameId = null;
            if (destroyed || !canvas.isConnected) { stop(); return; }
            if (!paint(global.performance.now() / 1000)) return;
            if (!isPaused && visible && !reducedMotion.matches && !document.hidden) {
                frameId = global.requestAnimationFrame(tick);
            }
        }

        function sync() {
            stop();
            resizeCanvas();
            paint(isPaused || reducedMotion.matches ? 0.6 : global.performance.now() / 1000);
            if (engine && !destroyed && !isPaused && visible && !reducedMotion.matches && !document.hidden) {
                frameId = global.requestAnimationFrame(tick);
            }
        }

        const observer = typeof IntersectionObserver === 'function'
            ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); })
            : null;
        observer?.observe(canvas);
        const themeObserver = new MutationObserver(sync);
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        document.addEventListener('visibilitychange', sync);
        reducedMotion.addEventListener('change', sync);
        colorScheme.addEventListener('change', sync);

        const controller = {
            setState(nextState) { modeState = nextState; sync(); },
            setPaused(nextPaused) { isPaused = Boolean(nextPaused); sync(); },
            setSize(nextSize, nextDisplaySize = nextSize) {
                const numericSize = Number(nextSize);
                const numericDisplaySize = Number(nextDisplaySize);
                if (!Number.isFinite(numericSize) || numericSize <= 0
                    || !Number.isFinite(numericDisplaySize) || numericDisplaySize <= 0) return;
                renderSize = numericSize;
                renderDisplaySize = numericDisplaySize;
                resizeCanvas();
                sync();
            },
            destroy() {
                destroyed = true;
                stop();
                observer?.disconnect();
                themeObserver.disconnect();
                sizeObserver?.disconnect();
                global.removeEventListener('resize', sync);
                document.removeEventListener('visibilitychange', sync);
                reducedMotion.removeEventListener('change', sync);
                colorScheme.removeEventListener('change', sync);
                delete target.__aedosOrb;
            }
        };
        target.__aedosOrb = controller;
        engineReady.then((loaded) => { engine = loaded; sync(); }).catch(() => {
            controller.destroy();
            target.replaceChildren(...previousContent);
        });
        return controller;
    }

    // eslint-disable-next-line max-lines-per-function -- Preview rendering state, transitions, and observers are intentionally owned together.
    function mountPreview() {
        const host = document.querySelector('.preview-stream-orb');
        const container = document.getElementById('preview-container');
        const stage = host?.parentElement;
        if (!host || !container || !stage) return;

        // Keep the canvas and its buffer square inside the available slide.
        const canvas = document.createElement('canvas');
        canvas.className = 'aedos-thinking-orb';
        canvas.setAttribute('aria-hidden', 'true');
        host.replaceChildren(canvas);
        const ctx = canvas.getContext('2d');
        let engine = null;
        let width = 0;
        let height = 0;
        let frameId = null;
        let lastFrameAt = 0;
        let currentState = previewOrbState;
        let stateStartedAt = global.performance.now() / 1000;

        const isActive = () => container.classList.contains('is-generating')
            && container.classList.contains('is-awaiting-first-slide')
            && !container.classList.contains('hidden') && canvas.isConnected
            && canvas.clientWidth > 0 && canvas.clientHeight > 0
            && !document.hidden && !reducedMotion.matches;
        const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
        const toneFor = (white) => {
            const level = clamp(white ?? 0.5, 0, 1);
            return isDark()
                ? Math.round(140 + (1 - level) * 115)
                : Math.round(115 - level * 105);
        };
        const orbScale = () => Math.min(width, height) * 0.9 / 64;
        const mapX = (x) => width / 2 + (x - 32) * orbScale();
        const mapY = (y) => height * 0.46 + (y - 32) * orbScale();
        const sceneDensity = {
            rubik: { latRings: 14, lonDensity: 32 },
            globe: { latRings: 22, lonDensity: 56 },
            braid: { strandN: 55, ghostN: 45 },
            ribbon: { lanes: 5, segs: 60, ghostN: 35 },
            ring: { lanes: 5, segs: 60 },
            orbits: { orbitN: 14, ghostN: 35 },
            web: { nodeN: 30 },
            wave: { rings: 14, lonDensity: 32 }
        };

        function paintMode(state, time, opacity) {
            if (opacity <= 0 || !engine || !ctx || !host.contains(canvas) || !canvas.isConnected
                || !canvas.width || !canvas.height || !canvas.clientWidth || !canvas.clientHeight
                || container.classList.contains('hidden') || !container.classList.contains('is-awaiting-first-slide')
                || !Number.isFinite(time) || !engine.STATE_TO_MODE[state]) return;
            const { mode, speed, opts } = engine.resolvePreset(state, 64);
            if (typeof engine.MODE_FRAMES[mode] !== 'function') return;
            const frame = engine.MODE_FRAMES[mode](64, time * speed, { ...opts, ...sceneDensity[mode] });
            ctx.globalAlpha = opacity;
            for (const line of frame.lines) {
                const tone = toneFor(line.white);
                ctx.strokeStyle = `rgba(${tone}, ${tone}, ${tone}, ${clamp(0.08 + (line.a ?? 1) * 0.48, 0, 0.56)})`;
                ctx.lineWidth = clamp(line.w ?? 0.8, 0.5, 1.15);
                ctx.beginPath();
                ctx.moveTo(mapX(line.x1), mapY(line.y1));
                ctx.lineTo(mapX(line.x2), mapY(line.y2));
                ctx.stroke();
            }
            for (const dot of frame.dots) {
                const tone = toneFor(dot.white);
                ctx.fillStyle = `rgba(${tone}, ${tone}, ${tone}, ${clamp(0.12 + (dot.a ?? 1) * 0.7, 0, 0.82)})`;
                ctx.beginPath();
                ctx.arc(mapX(dot.x), mapY(dot.y), clamp(1.05 + dot.r * 0.72, 1.3, 2.8), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        }

        function paint(time = global.performance.now() / 1000) {
            if (!engine || !ctx || !width || !height || !host.contains(canvas) || !canvas.isConnected
                || !canvas.width || !canvas.height || !canvas.clientWidth || !canvas.clientHeight
                || container.classList.contains('hidden') || !container.classList.contains('is-generating')
                || !container.classList.contains('is-awaiting-first-slide') || document.hidden) return false;
            // Event/observer payloads are not animation timestamps.
            if (!Number.isFinite(time)) time = global.performance.now() / 1000;
            ctx.save();
            try {
                ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
                ctx.clearRect(0, 0, width, height);
                const centerX = width / 2;
                const centerY = height * 0.46;
                const radius = Math.min(width, height) * 0.36;
                const volume = ctx.createRadialGradient(
                    centerX - radius * 0.28, centerY - radius * 0.32, radius * 0.08,
                    centerX, centerY, radius
                );
                volume.addColorStop(0, isDark() ? 'rgba(150,155,175,0.13)' : 'rgba(65,70,90,0.12)');
                volume.addColorStop(0.55, isDark() ? 'rgba(95,100,120,0.07)' : 'rgba(70,75,95,0.05)');
                volume.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = volume;
                ctx.beginPath();
                ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
                ctx.fill();
                const sequences = {
                    searching: ['searching', 'breathing'],
                    weaving: ['weaving', 'connecting'],
                    composing: ['composing', 'breathing', 'weaving'],
                    working: ['searching', 'breathing']
                };
                const sequence = sequences[currentState] || [currentState];
                const clock = reducedMotion.matches ? stateStartedAt + 0.6 : time;
                const elapsed = Math.max(0, clock - stateStartedAt);
                const interval = 5.4;
                const index = Math.floor(elapsed / interval);
                const fade = clamp((elapsed % interval - 4.5) / 0.9, 0, 1);
                const blend = fade * fade * (3 - 2 * fade);
                paintMode(sequence[index % sequence.length], clock, 1 - blend);
                if (blend > 0) paintMode(sequence[(index + 1) % sequence.length], clock, blend);
                return true;
            } catch (_) {
                if (frameId !== null) global.cancelAnimationFrame(frameId);
                frameId = null;
                return false;
            } finally {
                ctx.restore();
            }
        }

        function tick(timestamp) {
            frameId = null;
            if (!isActive()) return;
            if (timestamp - lastFrameAt >= 33) {
                lastFrameAt = timestamp;
                if (!paint(timestamp / 1000)) return;
            }
            frameId = global.requestAnimationFrame(tick);
        }

        function sync() {
            if (frameId !== null) global.cancelAnimationFrame(frameId);
            frameId = null;
            // A class change can precede layout/ResizeObserver delivery. Size
            // the buffer before the first frame and restart after every resize.
            resize();
            if (isActive()) frameId = global.requestAnimationFrame(tick);
            else paint();
        }

        const resize = () => {
            width = 0; height = 0;
            if (stage.clientWidth <= 0 || stage.clientHeight <= 0) return;
            const layout = global.getComputedStyle(stage);
            const status = document.getElementById('preview-stream-status');
            const availableWidth = stage.clientWidth - parseFloat(layout.paddingLeft) - parseFloat(layout.paddingRight);
            const availableHeight = stage.clientHeight - parseFloat(layout.paddingTop) - parseFloat(layout.paddingBottom)
                - (status?.offsetHeight || 0) - (parseFloat(layout.rowGap) || 0);
            width = Math.max(0, Math.min(480, availableWidth, availableHeight));
            height = width;
            if (!width) return;
            host.style.width = `${width}px`;
            host.style.height = `${height}px`;
            const pixelRatio = Math.min(global.devicePixelRatio || 1, 1800 / width);
            canvas.width = Math.max(1, Math.round(width * pixelRatio));
            canvas.height = Math.max(1, Math.round(height * pixelRatio));
        };
        previewOrb = {
            setState(state) {
                if (currentState === state) return;
                currentState = state;
                stateStartedAt = global.performance.now() / 1000;
                paint();
            }
        };
        new MutationObserver(sync).observe(container, { attributes: true, attributeFilter: ['class'] });
        if (typeof ResizeObserver === 'function') {
            const layoutObserver = new ResizeObserver(sync);
            layoutObserver.observe(stage);
            const status = document.getElementById('preview-stream-status');
            if (status) layoutObserver.observe(status);
        }
        global.addEventListener('resize', sync, { passive: true });
        document.addEventListener('visibilitychange', sync);
        reducedMotion.addEventListener('change', sync);
        colorScheme.addEventListener('change', () => paint());
        new MutationObserver(() => paint()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        engineReady.then((loaded) => { engine = loaded; sync(); }).catch(() => host.replaceChildren());
        sync();
    }

    function mountChatAvatars() {
        document.querySelectorAll('#chat-screen .chat-ai-avatar').forEach((host) => {
            host.classList.add('is-orb-avatar');
            mount(host, { state: 'working', size: 64, displaySize: 40, paused: true });
        });
    }

    global.AedosOrbs = {
        mount,
        setPreviewState(stage) {
            const states = {
                content: 'searching', stage1: 'searching',
                design: 'weaving', stage2: 'weaving',
                compositing: 'composing', stage3: 'composing', flash: 'composing'
            };
            if (!states[stage]) return;
            previewOrbState = states[stage];
            previewOrb?.setState(previewOrbState);
        }
    };
    function initialize() {
        mountChatAvatars();
        mountPreview();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})(window);
