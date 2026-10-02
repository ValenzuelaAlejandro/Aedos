/** @typedef {{ topic: string, subtitle_context: string, tone: string, audience: string, density: string, slides: Array<{title: string, role: string, key_points: string[]}> }} VisualSkeleton */

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (document.fonts?.ready) return document.fonts.ready;
}

function waitForFrames() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function showErrorModal() {
    document.getElementById('error-container')?.classList.remove('hidden');
}

function renderOutline() {
    const skeleton = {
        topic: 'Energía solar: del desierto a la ciudad',
        subtitle_context: 'Una propuesta clara para una audiencia general.',
        tone: 'academic',
        audience: 'general',
        density: 'medium',
        slides: [
            {
                title: 'La energía que llega del sol',
                role: 'opening',
                key_points: ['Radiación solar disponible', 'Conversión fotovoltaica'],
            },
            {
                title: 'De panel a red eléctrica',
                role: 'process',
                key_points: ['Generación distribuida', 'Almacenamiento y balance'],
            },
            {
                title: 'Ciudades con energía limpia',
                role: 'conclusion',
                key_points: ['Beneficios locales', 'Próximos pasos'],
            },
        ],
    };
    const conversation = document.getElementById('conversation-zone');
    conversation?.classList.remove('hidden');
    if (conversation) conversation.style.opacity = '1';
    if (conversation) conversation.style.transform = 'none';
    document.getElementById('chat-user-text').textContent = skeleton.topic;
    document.getElementById('chat-user-bubble')?.classList.remove('hidden');
    document.getElementById('chat-screen')?.classList.add('chat-mode');
    const appWindow = /** @type {any} */ (window);
    appWindow.prepareOutlineStreaming('flash');
    appWindow.renderStreamingOutline(skeleton);
    appWindow.finalizeStreamingOutline(skeleton);
}

function outlineIsVisible() {
    const container = document.getElementById('outline-container');
    const title = container?.querySelector('.outline-slide-title');
    const style = container && getComputedStyle(container);
    const rect = title?.getBoundingClientRect();
    return Boolean(
        container &&
            !container.classList.contains('hidden') &&
            title?.isConnected &&
            style?.visibility === 'visible' &&
            Number(style.opacity) > 0 &&
            rect?.width > 0 &&
            rect?.height > 0,
    );
}

function renderPreview() {
    const preview = document.getElementById('preview-container');
    const chat = document.getElementById('chat-screen');
    const frame = /** @type {HTMLIFrameElement|null} */ (
        document.getElementById('preview-iframe')
    );
    if (!preview || !frame) throw new Error('Presentation preview iframe is missing');
    chat?.classList.add('hidden');
    preview.classList.remove('hidden');
    const title = /** @type {HTMLInputElement|null} */ (
        document.getElementById('preview-topic-label')
    );
    if (title) title.value = 'Energía solar para ciudades resilientes';
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>
        *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0}
        body{display:flex;align-items:center;justify-content:center;background:#101826;font-family:Arial,sans-serif}
        section.s{width:1280px;height:720px;padding:104px 112px;background:#f8fafc;color:#14213d;display:flex;flex-direction:column;justify-content:center;gap:28px}
        h1{font-size:60px;line-height:1.05;margin:0;max-width:900px}p{font-size:28px;margin:0;color:#475569}
        .accent{width:112px;height:8px;border-radius:4px;background:#16a085}
    </style></head><body><section class="s"><div class="accent"></div><h1>Energía solar para ciudades resilientes</h1><p>Una transición limpia, distribuida y accesible.</p></section></body></html>`;
}

function previewIsVisible() {
    const frame = /** @type {HTMLIFrameElement|null} */ (
        document.getElementById('preview-iframe')
    );
    const rect = frame?.getBoundingClientRect();
    return Boolean(
        frame?.contentDocument?.querySelector('section.s') && rect?.width > 0 && rect?.height > 0,
    );
}

function inspectVisibleTarget({ selector, overlaySelector }) {
    function targetIsRendered(style, rect) {
        const hasVisibleStyle =
            style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
        const hasVisibleBounds =
            rect.width > 0 &&
            rect.height > 0 &&
            rect.right > 0 &&
            rect.bottom > 0 &&
            rect.left < innerWidth &&
            rect.top < innerHeight;
        return hasVisibleStyle && hasVisibleBounds;
    }

    function overlayIsCovering(style, rect) {
        const coversViewport =
            rect.left <= 0 &&
            rect.top <= 0 &&
            rect.right >= innerWidth &&
            rect.bottom >= innerHeight;
        return (
            style.display !== 'none' &&
            style.visibility === 'visible' &&
            Number(style.opacity) > 0 &&
            coversViewport &&
            style.backgroundColor !== 'rgba(0, 0, 0, 0)'
        );
    }

    const target = document.querySelector(selector);
    if (!target) throw new Error(`Mutation target not found: ${selector}`);
    const style = getComputedStyle(target);
    const rect = target.getBoundingClientRect();
    const rendered = targetIsRendered(style, rect);
    let overlay = null;
    if (overlaySelector) {
        const element = document.querySelector(overlaySelector);
        if (!element) throw new Error(`Expected covering layer missing: ${overlaySelector}`);
        const overlayStyle = getComputedStyle(element);
        const overlayRect = element.getBoundingClientRect();
        overlay = {
            covered: overlayIsCovering(overlayStyle, overlayRect),
            selector: overlaySelector,
            backgroundColor: overlayStyle.backgroundColor,
            rect: {
                x: overlayRect.x,
                y: overlayRect.y,
                width: overlayRect.width,
                height: overlayRect.height,
            },
        };
    }
    return {
        selector,
        rendered,
        covered: overlay?.covered || false,
        computed: {
            color: style.color,
            backgroundColor: style.backgroundColor,
            borderRadius: style.borderRadius,
            fontSize: style.fontSize,
            visibility: style.visibility,
            transform: style.transform,
        },
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        overlay,
    };
}

function applyStyleMutation({ selector, property, value, incrementPx }) {
    const target = document.querySelector(selector);
    const nextValue =
        incrementPx === undefined
            ? value
            : `${Number.parseFloat(getComputedStyle(target).fontSize) + incrementPx}px`;
    target.style.setProperty(property, nextValue, 'important');
}

module.exports = {
    applyTheme,
    waitForFrames,
    showErrorModal,
    renderOutline,
    outlineIsVisible,
    renderPreview,
    previewIsVisible,
    inspectVisibleTarget,
    applyStyleMutation,
};
