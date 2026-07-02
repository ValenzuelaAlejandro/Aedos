// Outline Editor Logic

window.outlineEditorState = {
    skeleton: null,
    mode: 'flash',
    maxSlides: 15,
    isLoading: false,
    activeContainer: null
};

/**
 * Returns the innerHTML for a .chat-bubble-file-chip span.
 * Uses the same colorful document icons as the chatbox attachment area.
 */
function _fileBubbleChipHtml(file) {
    const displayName = file.name && file.name.length > 24
        ? file.name.substring(0, 21) + '...'
        : (file.name || 'file');

    let iconMarkup;
    if (file.type && file.type.startsWith('image/')) {
        // Image icon (outline style)
        iconMarkup = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;flex-shrink:0;opacity:0.75;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    } else if (file.type && file.type.includes('pdf') || (file.name && file.name.endsWith('.pdf'))) {
        // PDF — red flat icon matching renderAttachmentChips
        iconMarkup = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" style="margin-right:6px;flex-shrink:0;"><path d="M4 2h10l6 6v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#E2231A"/><path d="M14 2v6h6z" fill="#B0150F"/><text x="11" y="16.5" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="6.2" font-weight="900" text-anchor="middle" letter-spacing="-0.3px">PDF</text></svg>`;
    } else if (file.name && (file.name.endsWith('.docx') || file.name.endsWith('.doc'))) {
        // DOCX — blue flat icon matching renderAttachmentChips
        iconMarkup = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" style="margin-right:6px;flex-shrink:0;"><path d="M4 2h10l6 6v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#185ABD"/><path d="M14 2v6h6z" fill="#103F8A"/><text x="11" y="16.5" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="7.5" font-weight="900" text-anchor="middle">W</text></svg>`;
    } else {
        // Generic file icon
        iconMarkup = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;flex-shrink:0;opacity:0.75;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    }

    return `${iconMarkup}${escapeHtml(displayName)}`;
}

function scrollToBottom(force = false) {
    const chatScreen = document.getElementById('chat-screen');
    if (!chatScreen) return;

    const threshold = 180;
    const isAtBottom = (chatScreen.scrollHeight - chatScreen.scrollTop - chatScreen.clientHeight) <= threshold;

    if (force || isAtBottom) {
        chatScreen.scrollTo({
            top: chatScreen.scrollHeight,
            behavior: 'auto'
        });
    }
}

// #region debug-point A:outline-debug-report
function __outlineDebugReport(hypothesisId, msg, data) {
    fetch('http://127.0.0.1:7778/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sessionId: 'outline-bubble-dom',
            runId: 'pre-fix',
            hypothesisId,
            location: 'outline.js',
            msg: `[DEBUG] ${msg}`,
            data,
            ts: Date.now()
        })
    }).catch(() => {});
}
// #endregion

function getActiveOutlineContainer() {
    const activeContainer = window.outlineEditorState?.activeContainer;
    if (activeContainer && document.body.contains(activeContainer)) {
        return activeContainer;
    }

    return document.getElementById('outline-container');
}

function getOutlineDom(container = getActiveOutlineContainer()) {
    if (!container) {
        return {
            container: null,
            slidesContainer: null,
            chipsContainer: null,
            addSlideButton: null,
            generateButton: null
        };
    }

    return {
        container,
        slidesContainer: container.querySelector('[data-outline-slides]') || container.querySelector('#outline-slides-container'),
        chipsContainer: container.querySelector('[data-outline-chips]') || container.querySelector('#outline-suggested-chips'),
        addSlideButton: container.querySelector('[data-outline-add-slide]') || container.querySelector('#btn-outline-add-slide'),
        generateButton: container.querySelector('[data-outline-generate]') || container.querySelector('#btn-outline-generate')
    };
}

function clearOutlineDom(container = getActiveOutlineContainer()) {
    const outlineDom = getOutlineDom(container);
    if (outlineDom.slidesContainer) outlineDom.slidesContainer.innerHTML = '';
    if (outlineDom.chipsContainer) outlineDom.chipsContainer.innerHTML = '';
}

function mountActiveOutlineContainer(container) {
    const fallbackContainer = document.getElementById('outline-container');
    window.outlineEditorState.activeContainer = container && document.body.contains(container)
        ? container
        : fallbackContainer;
    // #region debug-point A:active-container-mounted
    __outlineDebugReport('A', 'mountActiveOutlineContainer resolved host', {
        requestedId: container?.id || null,
        requestedClass: container?.className || null,
        activeId: window.outlineEditorState.activeContainer?.id || null,
        activeClass: window.outlineEditorState.activeContainer?.className || null,
        activeParentClass: window.outlineEditorState.activeContainer?.parentElement?.className || null
    });
    // #endregion
    return getOutlineDom(window.outlineEditorState.activeContainer);
}

function handleOutlineGenerateRequest() {
    const activeGenerateButton = getOutlineDom().generateButton;
    if (activeGenerateButton && activeGenerateButton.disabled) return;

    const skel = window.outlineEditorState.skeleton;
    if (!skel) return;

    skel.topic = document.getElementById('outline-title-input').value;
    skel.tone = document.getElementById('outline-tone-select').value;
    skel.audience = document.getElementById('outline-audience-select').value;
    skel.density = document.getElementById('outline-density-select').value;

    const subtitleInput = document.getElementById('outline-subtitle-input');
    if (subtitleInput) skel.subtitle_context = subtitleInput.value.trim();

    if (!skel.slides || skel.slides.length === 0) {
        alert(window.__t ? window.__t('outline_empty_slides', 'Please add at least one slide before generating.') : 'Please add at least one slide before generating.');
        return;
    }

    skel.slides.forEach(slide => {
        if (slide.key_points) {
            slide.key_points = slide.key_points.filter(p => p && p.trim() !== '');
        }
    });

    if (activeGenerateButton) {
        activeGenerateButton.disabled = true;
        activeGenerateButton.classList.add('is-generating');
    }

    if (window.startFinalGeneration) {
        window.startFinalGeneration(skel);
    }
}

function bindOutlineBubbleActions(container) {
    const outlineDom = getOutlineDom(container);

    if (outlineDom.addSlideButton && !outlineDom.addSlideButton.dataset.boundOutlineAction) {
        outlineDom.addSlideButton.dataset.boundOutlineAction = 'true';
        outlineDom.addSlideButton.addEventListener('click', (e) => {
            e.preventDefault();
            addBlankSlide();
        });
    }

    if (outlineDom.generateButton && !outlineDom.generateButton.dataset.boundOutlineAction) {
        outlineDom.generateButton.dataset.boundOutlineAction = 'true';
        outlineDom.generateButton.addEventListener('click', handleOutlineGenerateRequest);
    }
}

function createFollowUpOutlineContainer() {
    const container = document.createElement('div');
    container.className = 'outline-container-local hidden';
    container.innerHTML = `
        <div class="seamless-outline-list" data-outline-slides></div>
        <div class="outline-suggested-chips" data-outline-chips></div>
        <div class="outline-bubble-footer">
            <button type="button" class="outline-btn-ghost" data-outline-add-slide>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                Add Section
            </button>
            <button type="button" class="outline-generate-btn" data-outline-generate>
                <span class="outline-generate-text" data-i18n="generate_outline_slides">Create Presentation</span>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
            </button>
        </div>
    `;

    bindOutlineBubbleActions(container);
    return container;
}

function showOutlineEditorLoading(slideCount = 8) {
    window.outlineEditorState.isLoading = true;

    // Purge any historical outline summaries, empty the slides list and clear chips instantly ONLY if starting a fresh generation (not a follow-up)
    const isFollowUp = !!window.outlineEditorState.skeleton;
    if (!isFollowUp) {
        document.querySelectorAll('.historical-outline-summary').forEach(el => el.remove());
        const globalOutline = document.getElementById('outline-container');
        mountActiveOutlineContainer(globalOutline);
        bindOutlineBubbleActions(globalOutline);
        const slidesContainer = getOutlineDom(globalOutline).slidesContainer;
        if (slidesContainer) slidesContainer.innerHTML = '';
        const chipsContainer = getOutlineDom(globalOutline).chipsContainer;
        if (chipsContainer) {
            chipsContainer.innerHTML = '';
            if (window._chipsRenderTimeout) clearTimeout(window._chipsRenderTimeout);
        }
    }

    // Block language dropdown and enable stop action on send button
    const btnGenerate = document.getElementById('btn-generate');
    const btnLang = document.getElementById('btn-lang-dropdown');
    if (btnGenerate) {
        btnGenerate.classList.add('is-generating');
        btnGenerate.disabled = false;
    }
    if (btnLang) btnLang.disabled = true;

    // 1. Capture the prompt text and attached files before clearing
    const inputEl = document.getElementById('w-tema');
    const promptText = inputEl?.value?.trim() || '';
    if (inputEl) inputEl.value = '';

    // Capture and clear attached files (mirrors clearing the text input)
    const capturedFiles = (window._attachedFiles && window._attachedFiles.length > 0)
        ? window._attachedFiles.slice()
        : [];
    if (capturedFiles.length > 0) {
        window._attachedFiles = [];
        const attachmentPreview = document.getElementById('attachment-preview-container');
        if (attachmentPreview) {
            attachmentPreview.innerHTML = '';
            attachmentPreview.classList.add('hidden');
        }
        // Note: mode button re-enable is handled by toggleGenerateLoading(false) at end of generation
    }

    // 2. Activate chat-mode on #chat-screen (aligns to top)
    const chatScreen = document.getElementById('chat-screen');
    if (chatScreen) chatScreen.classList.add('chat-mode');

    // 3. Fade out hero title
    const heroZone = document.getElementById('hero-zone');
    if (heroZone) heroZone.classList.add('fade-out');

    // 4. Fade out suggestion pills and microcopy
    const pills = document.getElementById('suggestion-pills-row');
    if (pills) { pills.style.transition = 'opacity 0.3s'; pills.style.opacity = '0'; pills.style.pointerEvents = 'none'; }
    const microcopy = document.querySelector('.app-microcopy');
    if (microcopy) { microcopy.style.transition = 'opacity 0.3s'; microcopy.style.opacity = '0'; }
    const counter = document.querySelector('.chat-counter-row');
    if (counter) { counter.style.transition = 'opacity 0.3s'; counter.style.opacity = '0'; }

    // 5. Show conversation zone with user bubble
    const convZone = document.getElementById('conversation-zone');
    if (convZone) {
        convZone.classList.remove('hidden');
        convZone.classList.add('visible');

        // Check if this is a follow-up (i.e. we already have an active skeleton)
        const isFollowUp = !!window.outlineEditorState.skeleton;

        if (isFollowUp) {
            // Append new user message bubble
            const userBubble = document.createElement('div');
            userBubble.className = 'chat-msg chat-msg-user';
            
            let bubbleContent = '';
            if (capturedFiles.length > 0) {
                const fileItemsHtml = capturedFiles
                    .map(f => `<div class="chat-bubble-file-item">${_fileBubbleChipHtml(f)}</div>`)
                    .join('');
                bubbleContent += `<div class="chat-bubble-files-container">${fileItemsHtml}</div>`;
            }
            if (promptText) {
                bubbleContent += `<span>${escapeHtml(promptText)}</span>`;
            }
            userBubble.innerHTML = bubbleContent;
            convZone.appendChild(userBubble);

            // GSAP premium entrance animation
            if (window.gsap) {
                window.gsap.fromTo(userBubble, { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
            }

            // Append new AI message bubble with active loader
            const aiBubble = document.createElement('div');
            aiBubble.className = 'chat-msg chat-msg-ai';
            aiBubble.innerHTML = `
                <div class="chat-ai-avatar">
                    <svg viewBox="0 0 1254 1254" width="20" height="20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path fill="currentColor" d="M714.86 225.25c-13.38 4.69-22.15 15.09-24.82 29.42-1.2 6.43 4.94 70.22 7.44 77.29 3.74 10.6 10.38 17.75 21.18 22.81 5.01 2.35 7.12 2.73 14.86 2.73 8.18 0 9.65-.31 15.7-3.29 7.74-3.81 13.8-10.06 17.67-18.21 2.43-5.12 2.6-6.39 2.46-18.5-.09-7.15-1.55-25.15-3.26-40-2.64-22.96-3.49-27.78-5.64-32.19-8.68-17.8-27.9-26.26-45.58-20.06zm167.43 50.14c-9.54 3.11-12.79 6.06-29.16 26.41-8.72 10.83-18.96 23.54-22.77 28.24-9.56 11.79-11.74 17.06-11.8 28.46-.04 7.7.33 9.81 2.59 14.62 5.9 12.59 16.74 19.97 30.36 20.68 15 .78 22.9-3.35 34.97-18.3 19.75-24.45 29.32-36.28 34.24-42.85 4.92-6.56 5.19-7.86 6.32-11.25 5.86-17.61-2.12-36.46-18.86-44.56-5.77-2.79-19.42-3.56-25.89-1.45zM325.21 358c-23.26 3.28-46.45 14.6-62.84 30.67-14.17 13.89-26 35.43-30.96 56.33-2.36 9.94-2.76 86.98-1.54 294 .87 146.99.93 150.71 2.96 159.65 9.19 40.57 36.58 71.92 74.83 85.66 19.98 7.18 31.87 7.26 93.17.65 134.14-14.47 394.19-43.41 413.68-46.03 35-4.7 69.51-31.06 84.57-64.58 8.47-18.87 9.98-30.96 9.91-79.38-.08-47.06-1.01-51.4-13.44-62.77-20.03-18.3-50.6-9.48-59.85 17.27-.61 1.77-1.28 18.76-1.62 41.03l-.57 38-3.11 6.5c-1.71 3.58-4.99 8.62-7.29 11.2-4.56 5.13-15.36 11.18-21.78 12.21-2.1.34-45.89 5.11-97.31 10.62-51.42 5.5-126.35 13.62-166.5 18.04s-89.43 9.81-109.5 11.98-45.05 4.9-55.5 6.05c-24.22 2.67-30.28 2.3-39.9-2.45-8.85-4.37-14.57-10.26-18.93-19.47l-3.16-6.68-.27-200c-.18-131.12.08-201.63.73-204.73 2.62-12.34 12.66-24.59 23.53-28.73 11.56-4.39 13.74-4.19 73.5 6.83 39.26 7.24 58.65 10.82 73.91 13.62 15.26 2.81 26.38 4.84 49.09 9 45.7 8.36 184.1 34.02 237.5 44.03 18.7 3.51 35.58 6.92 37.5 7.59 10.26 3.56 20.82 13.97 25.26 24.89 2.19 5.4 2.24 6.5 2.74 59.5l.5 54 3.15 6.65c4 8.44 9.76 14.2 18.2 18.2 5.93 2.81 7.63 3.15 15.67 3.15 8.17 0 9.65-.31 15.67-3.27 8.24-4.06 15.75-11.96 18.99-19.98l2.32-5.75-.05-58c-.05-51.49-.25-58.95-1.82-66.45-7.27-34.74-28.48-63.02-59.53-79.39-8.31-4.38-12.22-6.52-29.85-10.57s-49-10.02-112.24-22.08c-23.38-4.46-57.35-10.98-75.5-14.5-50.68-9.82-98.08-18.9-141.5-27.12-21.73-4.11-60.88-11.52-87-16.46-49.86-9.44-62.04-10.87-75.79-8.93zM991 394.66c-1.38.28-12.62 4.93-25 10.34s-24.19 10.52-26.26 11.37-6.17 3.82-9.13 6.61c-17.49 16.54-13.77 43.57 7.57 55.07 5.84 3.15 7.01 3.41 15.32 3.43 8.24.02 9.67-.29 17-3.62 4.4-2 16.55-7.38 26.99-11.96 21.24-9.3 25.56-12.56 30.42-22.9 3.77-8.01 3.74-21.04-.06-29.15-5.23-11.16-15.91-18.54-27.9-19.29-3.55-.22-7.58-.18-8.95.11zM569.58 541.42c-10.1 4.26-16.95 12.66-19.64 24.08-6.05 25.68-13.67 40.12-29.11 55.14-17.34 16.88-36.09 25.33-62.9 28.37-16.25 1.84-25.07 7.46-30.57 19.49-5.24 11.46-3.17 25.05 5.26 34.42 6.43 7.16 12.71 9.8 27.63 11.65 22.43 2.78 38.47 8.33 53.3 18.46 11.16 7.62 24.87 21.74 30.82 31.74 5.51 9.26 11.22 24.8 12.15 33.13 2.71 24.03 14.26 35.96 33.8 34.93 15.79-.83 26.77-11.17 29.61-27.9 7.27-42.77 35.31-68.79 78.43-72.79 16.92-1.57 25.92-7.02 31.47-19.06 5.68-12.33 3.73-25.13-5.34-34.92-6.5-7.02-11.42-9.38-24.13-11.56-20.74-3.56-37.87-12.27-53.21-27.04-18.72-18.02-28.34-38.34-33.19-70.07-2.79-18.24-14.23-29.42-30.93-30.22-6.3-.3-8.5.05-13.45 2.13z" fill-rule="evenodd" stroke="currentColor" stroke-linejoin="round" stroke-width=".8"/>
                        <path fill="currentColor" d="M229.66 462.24c-.36 6.19-.55 56.71-.44 112.26l.21 101 .53-112c.29-61.6.49-112.12.44-112.26s-.39 4.81-.75 11z" fill-rule="evenodd"/>
                        <path fill="currentColor" d="M714.86 225.25c-13.38 4.69-22.15 15.09-24.82 29.42-1.2 6.43 4.94 70.22 7.44 77.29 3.74 10.6 10.38 17.75 21.18 22.81 5.01 2.35 7.12 2.73 14.86 2.73 8.18 0 9.65-.31 15.7-3.29 7.74-3.81 13.8-10.06 17.67-18.21 2.43-5.12 2.6-6.39 2.46-18.5-.09-7.15-1.55-25.15-3.26-40-2.64-22.96-3.49-27.78-5.64-32.19-8.68-17.8-27.9-26.26-45.58-20.06zm167.43 50.14c-9.54 3.11-12.79 6.06-29.16 26.41-8.72 10.83-18.96 23.54-22.77 28.24-9.56 11.79-11.74 17.06-11.8 28.46-.04 7.7.33 9.81 2.59 14.62 5.9 12.59 16.74 19.97 30.36 20.68 15 .78 22.9-3.35 34.97-18.3 19.75-24.45 29.32-36.28 34.24-42.85 4.92-6.56 5.19-7.86 6.32-11.25 5.86-17.61-2.12-36.46-18.86-44.56-5.77-2.79-19.42-3.56-25.89-1.45zM325.21 358c-23.26 3.28-46.45 14.6-62.84 30.67-14.17 13.89-26 35.43-30.96 56.33-2.36 9.94-2.76 86.98-1.54 294 .87 146.99.93 150.71 2.96 159.65 9.19 40.57 36.58 71.92 74.83 85.66 19.98 7.18 31.87 7.26 93.17.65 134.14-14.47 394.19-43.41 413.68-46.03 35-4.7 69.51-31.06 84.57-64.58 8.47-18.87 9.98-30.96 9.91-79.38-.08-47.06-1.01-51.4-13.44-62.77-20.03-18.3-50.6-9.48-59.85 17.27-.61 1.77-1.28 18.76-1.62 41.03l-.57 38-3.11 6.5c-1.71 3.58-4.99 8.62-7.29 11.2-4.56 5.13-15.36 11.18-21.78 12.21-2.1.34-45.89 5.11-97.31 10.62-51.42 5.5-126.35 13.62-166.5 18.04s-89.43 9.81-109.5 11.98-45.05 4.9-55.5 6.05c-24.22 2.67-30.28 2.3-39.9-2.45-8.85-4.37-14.57-10.26-18.93-19.47l-3.16-6.68-.27-200c-.18-131.12.08-201.63.73-204.73 2.62-12.34 12.66-24.59 23.53-28.73 11.56-4.39 13.74-4.19 73.5 6.83 39.26 7.24 58.65 10.82 73.91 13.62 15.26 2.81 26.38 4.84 49.09 9 45.7 8.36 184.1 34.02 237.5 44.03 18.7 3.51 35.58 6.92 37.5 7.59 10.26 3.56 20.82 13.97 25.26 24.89 2.19 5.4 2.24 6.5 2.74 59.5l.5 54 3.15 6.65c4 8.44 9.76 14.2 18.2 18.2 5.93 2.81 7.63 3.15 15.67 3.15 8.17 0 9.65-.31 15.67-3.27 8.24-4.06 15.75-11.96 18.99-19.98l2.32-5.75-.05-58c-.05-51.49-.25-58.95-1.82-66.45-7.27-34.74-28.48-63.02-59.53-79.39-8.31-4.38-12.22-6.52-29.85-10.57s-49-10.02-112.24-22.08c-23.38-4.46-57.35-10.98-75.5-14.5-50.68-9.82-98.08-18.9-141.5-27.12-21.73-4.11-60.88-11.52-87-16.46-49.86-9.44-62.04-10.87-75.79-8.93zM991 394.66c-1.38.28-12.62 4.93-25 10.34s-24.19 10.52-26.26 11.37-6.17 3.82-9.13 6.61c-17.49 16.54-13.77 43.57 7.57 55.07 5.84 3.15 7.01 3.41 15.32 3.43 8.24.02 9.67-.29 17-3.62 4.4-2 16.55-7.38 26.99-11.96 21.24-9.3 25.56-12.56 30.42-22.9 3.77-8.01 3.74-21.04-.06-29.15-5.23-11.16-15.91-18.54-27.9-19.29-3.55-.22-7.58-.18-8.95.11zM569.58 541.42c-10.1 4.26-16.95 12.66-19.64 24.08-6.05 25.68-13.67 40.12-29.11 55.14-17.34 16.88-36.09 25.33-62.9 28.37-16.25 1.84-25.07 7.46-30.57 19.49-5.24 11.46-3.17 25.05 5.26 34.42 6.43 7.16 12.71 9.8 27.63 11.65 22.43 2.78 38.47 8.33 53.3 18.46 11.16 7.62 24.87 21.74 30.82 31.74 5.51 9.26 11.22 24.8 12.15 33.13 2.71 24.03 14.26 35.96 33.8 34.93 15.79-.84 26.75-11.06 29.62-27.91 7.27-42.75 35.32-68.78 78.42-72.77 16.92-1.57 25.92-7.02 31.47-19.06 5.68-12.33 3.73-25.13-5.34-34.92-6.5-7.02-11.42-9.38-24.13-11.56-20.74-3.56-37.87-12.27-53.21-27.04-18.72-18.02-28.34-38.34-33.19-70.07-2.79-18.24-14.23-29.42-30.93-30.22-6.3-.3-8.5.05-13.45 2.13z" fill-rule="evenodd" stroke="currentColor" stroke-linejoin="round" stroke-opacity=".5" stroke-width=".6"/>
                    </svg>
                </div>
                <div class="chat-ai-body">
                    <!-- Thinking panel is injected by the caller via
                         window.AedosThinking.show(aiBody, ...). The legacy
                         chat-thinking div stays here as a graceful
                         fallback for browsers that block the new module. -->
                    <div class="chat-thinking hidden"><span></span><span></span><span></span></div>
                </div>
            `;
            convZone.appendChild(aiBubble);

            if (window.gsap) {
                window.gsap.fromTo(aiBubble, { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out', delay: 0.1 });
            }

            // Attach the new Claude-style thinking panel right away so the
            // user sees the elapsed-time counter from the very first
            // millisecond. Reasoning tokens arriving later will auto-expand
            // it.
            if (window.AedosThinking) {
                const aiBody = aiBubble.querySelector('.chat-ai-body');
                if (aiBody) {
                    window.AedosThinking.show(aiBody, {
                        label: window.__t ? window.__t('chat_thinking', 'Thinking…') : 'Thinking…',
                        stage: 'stage1'
                    });
                }
            }

            // Archive and freeze the previous outline state into a gorgeous static summary
            const outlineContainer = getActiveOutlineContainer();
            if (outlineContainer) {
                const slidesContainer = getOutlineDom(outlineContainer).slidesContainer;
                if (slidesContainer && !outlineContainer.classList.contains('hidden')) {
                    // Create a static read-only snapshot
                    const staticSummary = document.createElement('div');
                    staticSummary.className = 'historical-outline-summary';

                    const slideItems = slidesContainer.querySelectorAll('.seamless-slide-item');
                    slideItems.forEach(item => {
                        const num = item.querySelector('.seamless-slide-number')?.textContent || '';
                        const title = item.querySelector('.outline-slide-title')?.value || '';
                        const points = Array.from(item.querySelectorAll('.outline-point-input')).map(input => input.value);

                        const slideEl = document.createElement('div');
                        slideEl.className = 'historical-slide-item';
                        slideEl.innerHTML = `
                            <div class="historical-slide-number">${escapeHtml(num)}</div>
                            <div class="historical-slide-title">${escapeHtml(title)}</div>
                            <div class="historical-points-list">
                                ${points.map(pt => `
                                    <div class="historical-point-item">
                                        <span class="historical-point-bullet">-</span>
                                        <span class="historical-point-text">${escapeHtml(pt)}</span>
                                    </div>
                                `).join('')}
                            </div>
                        `;
                        staticSummary.appendChild(slideEl);
                    });

                    // Replace the active editor container in the old AI bubble with the static read-only snapshot
                    const oldParent = outlineContainer.parentNode;
                    if (oldParent) {
                        oldParent.insertBefore(staticSummary, outlineContainer);

                        if (window.gsap) {
                            window.gsap.fromTo(staticSummary, { opacity: 0 }, { opacity: 0.5, duration: 0.3 });
                        }
                    }
                }

                // Retire the previous interactive host without reparenting the
                // same outline DOM subtree into the next bubble.
                clearOutlineDom(outlineContainer);
                if (outlineContainer.id === 'outline-container') {
                    outlineContainer.classList.add('hidden');
                } else {
                    outlineContainer.remove();
                }
            }

            const followUpOutlineContainer = createFollowUpOutlineContainer();
            aiBubble.querySelector('.chat-ai-body').appendChild(followUpOutlineContainer);
            mountActiveOutlineContainer(followUpOutlineContainer);
            // #region debug-point C:follow-up-bubble-host
            __outlineDebugReport('C', 'follow-up AI bubble received local outline host', {
                aiBubbleClass: aiBubble.className,
                aiBodyChildren: aiBubble.querySelector('.chat-ai-body')?.children?.length || 0,
                followUpHostClass: followUpOutlineContainer.className,
                followUpHostParentClass: followUpOutlineContainer.parentElement?.className || null,
                totalAiMessages: document.querySelectorAll('.chat-msg-ai').length
            });
            // #endregion
        } else {
            // First loading state: populate the static placeholders
            const firstUserBubble = document.getElementById('chat-user-bubble');
            const userTextEl = document.getElementById('chat-user-text');
            if (userTextEl) {
                userTextEl.textContent = promptText;
            }
            if (firstUserBubble && capturedFiles.length > 0) {
                // Remove any previously injected file chips
                firstUserBubble.querySelectorAll('.chat-bubble-files-container').forEach(el => el.remove());
                const filesContainer = document.createElement('div');
                filesContainer.className = 'chat-bubble-files-container';
                capturedFiles.forEach(f => {
                    const item = document.createElement('div');
                    item.className = 'chat-bubble-file-item';
                    item.innerHTML = _fileBubbleChipHtml(f);
                    filesContainer.appendChild(item);
                });
                // Insert the files BEFORE the text span so they stack above it outside the bubble
                firstUserBubble.insertBefore(filesContainer, userTextEl);
            }
            if (firstUserBubble && window.gsap) {
                window.gsap.fromTo(firstUserBubble, { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
            }
            const thinking = document.getElementById('chat-thinking');
            if (thinking) {
                thinking.classList.remove('hidden');
                if (window.gsap) {
                    const firstAiBubble = document.getElementById('chat-ai-response');
                    if (firstAiBubble) {
                        window.gsap.fromTo(firstAiBubble, { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out', delay: 0.1 });
                    }
                }
            }

            const globalOutline = document.getElementById('outline-container');
            if (globalOutline) {
                mountActiveOutlineContainer(globalOutline);
                bindOutlineBubbleActions(globalOutline);
            }
        }

        // Auto-scroll to bottom of conversation (force since new content is added)
        scrollToBottom(true);
    }

    // 6. Disable generate/add-slide while loading
    const outlineDom = getOutlineDom();
    const btnGen = outlineDom.generateButton;
    const btnAdd = outlineDom.addSlideButton;
    if (btnGen) btnGen.disabled = true;
    if (btnAdd) btnAdd.disabled = true;
}

function parsePartialSkeleton(text) {
    const slides = [];
    // Split using lookahead to preserve the opening bracket of each slide object
    const slideSegments = text.split(/(?=\{\s*"(?:index|role|title)")/);
    
    for (let i = 1; i < slideSegments.length; i++) {
        const seg = slideSegments[i];
        
        let title = '';
        const titleMatch = seg.match(/"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
        const typingTitleMatch = seg.match(/"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)$/);
        if (titleMatch) {
            title = titleMatch[1];
        } else if (typingTitleMatch) {
            title = typingTitleMatch[1];
        }
        
        const keyPoints = [];
        const pointsSegmentMatch = seg.match(/"key_points"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
        if (pointsSegmentMatch) {
            const pointsText = pointsSegmentMatch[1];
            const pointMatches = pointsText.match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g) || [];
            pointMatches.forEach(m => {
                keyPoints.push(m.slice(1, -1));
            });
            const typingPointMatch = pointsText.match(/,\s*"([^"\\]*(?:\\.[^"\\]*)*)$|^\s*"([^"\\]*(?:\\.[^"\\]*)*)$/);
            if (typingPointMatch) {
                const typingStr = typingPointMatch[1] || typingPointMatch[2];
                keyPoints.push(typingStr);
            }
        }
        
        slides.push({ title, key_points: keyPoints });
    }
    
    return { slides };
}
window.parsePartialSkeleton = parsePartialSkeleton;

window.prepareOutlineStreaming = function(mode) {
    window.outlineEditorState.isLoading = true;
    window.outlineEditorState.skeleton = null;
    window.outlineEditorState.mode = mode;
    window.outlineEditorState.maxSlides = mode === 'pro' ? 8 : 15;

    const activeOutlineDom = mountActiveOutlineContainer(getActiveOutlineContainer());
    const container = activeOutlineDom.slidesContainer;
    if (container) container.innerHTML = '';
    
    const btnGenerate = document.getElementById('btn-generate');
    const btnLang = document.getElementById('btn-lang-dropdown');
    if (btnGenerate) {
        btnGenerate.classList.add('is-generating');
        btnGenerate.disabled = false;
    }
    if (btnLang) btnLang.disabled = true;
    
    const pills = document.getElementById('suggestion-pills-row');
    if (pills) { pills.style.transition = 'opacity 0.3s'; pills.style.opacity = '0'; pills.style.pointerEvents = 'none'; }
    const microcopy = document.querySelector('.app-microcopy');
    if (microcopy) { microcopy.style.transition = 'opacity 0.3s'; microcopy.style.opacity = '0'; }
    const counter = document.querySelector('.chat-counter-row');
    if (counter) { counter.style.transition = 'opacity 0.3s'; counter.style.opacity = '0'; }

    const outlineContainer = activeOutlineDom.container;
    if (outlineContainer) outlineContainer.classList.remove('hidden');

    const chipsContainer = activeOutlineDom.chipsContainer;
    if (chipsContainer) {
        chipsContainer.innerHTML = '';
        if (window._chipsRenderTimeout) clearTimeout(window._chipsRenderTimeout);
    }
};

window.renderStreamingOutline = function(partialSkeleton) {
    const container = getOutlineDom().slidesContainer;
    if (!container) return;
    // #region debug-point D:stream-render-target
    __outlineDebugReport('D', 'renderStreamingOutline target resolved', {
        activeContainerId: getOutlineDom().container?.id || null,
        activeContainerClass: getOutlineDom().container?.className || null,
        slidesContainerId: container.id || null,
        slidesContainerDataset: container.getAttribute('data-outline-slides') || null,
        slidesParentClass: container.parentElement?.className || null,
        slideCount: partialSkeleton?.slides?.length || 0
    });
    // #endregion

    const slides = partialSkeleton.slides || [];
    const existingItems = container.querySelectorAll('.seamless-slide-item');
    
    slides.forEach((slide, index) => {
        let item = existingItems[index];
        if (!item) {
            item = document.createElement('div');
            item.className = 'seamless-slide-item';
            item.dataset.index = index;
            item.innerHTML = `
                <div class="seamless-slide-number">${index + 1}.</div>
                <textarea id="outline-slide-title-${index}" name="outline-slide-title-${index}" class="seamless-title-input outline-slide-title" placeholder="Slide Title" data-index="${index}" rows="1" aria-label="Slide Title" disabled></textarea>
                <div class="seamless-points-list" id="outline-points-${index}"></div>
            `;
            container.appendChild(item);
            
            if (window.gsap) {
                window.gsap.fromTo(item, { opacity: 0, x: -12 }, { opacity: 1, x: 0, duration: 0.4, ease: 'power2.out' });
            }
        }
        
        const titleTextarea = item.querySelector('.outline-slide-title');
        if (titleTextarea && titleTextarea.value !== (slide.title || '')) {
            titleTextarea.value = slide.title || '';
            titleTextarea.style.height = 'auto';
            titleTextarea.style.height = titleTextarea.scrollHeight + 'px';
        }
        
        const pointsList = item.querySelector('.seamless-points-list');
        if (pointsList) {
            const existingPoints = pointsList.querySelectorAll('.seamless-point-item');
            const keyPoints = slide.key_points || [];
            
            keyPoints.forEach((point, pIndex) => {
                let pItem = existingPoints[pIndex];
                if (!pItem) {
                    pItem = document.createElement('div');
                    pItem.className = 'seamless-point-item';
                    pItem.innerHTML = `
                        <span class="seamless-point-bullet">-</span>
                        <textarea id="outline-slide-${index}-point-${pIndex}" name="outline-slide-${index}-point-${pIndex}" class="seamless-point-input outline-point-input" data-sindex="${index}" data-pindex="${pIndex}" rows="1" aria-label="Bullet point" disabled></textarea>
                    `;
                    pointsList.appendChild(pItem);
                    
                    if (window.gsap) {
                        window.gsap.fromTo(pItem, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.3, ease: 'power2.out' });
                    }
                }
                
                const pTextarea = pItem.querySelector('.outline-point-input');
                if (pTextarea && pTextarea.value !== point) {
                    pTextarea.value = point;
                    pTextarea.style.height = 'auto';
                    pTextarea.style.height = pTextarea.scrollHeight + 'px';
                }
            });
            
            for (let i = keyPoints.length; i < existingPoints.length; i++) {
                existingPoints[i].remove();
            }
        }
    });
    
    for (let i = slides.length; i < existingItems.length; i++) {
        existingItems[i].remove();
    }
    
    scrollToBottom();
};

window.finalizeStreamingOutline = function(finalSkeleton) {
    window.outlineEditorState.skeleton = finalSkeleton;
    
    // Populate hidden config tags
    const titleInput = document.getElementById('outline-title-input');
    if (titleInput) { titleInput.value = finalSkeleton.topic || ''; titleInput.disabled = false; }
    const toneVal = finalSkeleton.tone || 'academic';
    const toneEl = document.getElementById('outline-tone-select');
    if (toneEl) { toneEl.value = toneVal; if (!toneEl.value) toneEl.value = 'academic'; }
    const audEl = document.getElementById('outline-audience-select');
    if (audEl) audEl.value = finalSkeleton.audience || 'general';
    const densEl = document.getElementById('outline-density-select');
    if (densEl) densEl.value = finalSkeleton.density || finalSkeleton.text_density || 'medium';
    const subEl = document.getElementById('outline-subtitle-input');
    if (subEl) subEl.value = finalSkeleton.subtitle_context || '';

    // Render standard slides to replace disabled textareas and bind all events (like draggable, inputs etc.)
    renderOutlineSlides();
    
    // Render Suggested Action Chips Row
    window.renderOutlineSuggestedChips(finalSkeleton);

    // Mark loading as false and enable controls
    window.outlineEditorState.isLoading = false;
    
    // Re-enable global buttons and remove is-generating class
    const btnGenerate = document.getElementById('btn-generate');
    if (btnGenerate) {
        btnGenerate.classList.remove('is-generating');
        btnGenerate.disabled = false;
    }
    const btnLang = document.getElementById('btn-lang-dropdown');
    if (btnLang) btnLang.disabled = false;
    
    const outlineDom = getOutlineDom();
    const btnGen = outlineDom.generateButton;
    const btnAdd = outlineDom.addSlideButton;
    if (btnGen) btnGen.disabled = false;
    if (btnAdd) btnAdd.disabled = false;
    
    if (typeof window.validateGenerateButton === 'function') {
        window.validateGenerateButton();
    }
};

window.renderOutlineSuggestedChips = function(skeletonData) {
    const chipsContainer = getOutlineDom().chipsContainer;
    if (!chipsContainer) return;
    chipsContainer.innerHTML = '';
    
    if (window._chipsRenderTimeout) clearTimeout(window._chipsRenderTimeout);

    let suggestedChips = [];
    const isEnglish = (skeletonData.language || 'es').toLowerCase().startsWith('en');

    const t = (key, fallback) => {
        if (typeof window !== 'undefined' && window.__t) {
            return window.__t(key);
        }
        return fallback;
    };

    if (skeletonData.suggested_chips && Array.isArray(skeletonData.suggested_chips) && skeletonData.suggested_chips.length > 0) {
        suggestedChips = skeletonData.suggested_chips.slice(0, 2).map(chipText => ({
            text: chipText,
            prompt: chipText
        }));

        suggestedChips.push({
            text: t('chip_fallback_generate_text', isEnglish ? 'Looks good! Create presentation' : 'Todo listo! Crear presentación'),
            primary: true,
            action: 'generate'
        });
    } else {
        suggestedChips = [
            {
                text: t('chip_fallback_add_slide_text', 'Añadir diapositiva relevante'),
                prompt: t('chip_fallback_add_slide_prompt', 'Sugiéreme y añade una nueva diapositiva relevante y lógica al esquema actual')
            },
            {
                text: t('chip_fallback_explain_text', 'Explicar con más detalle'),
                prompt: t('chip_fallback_explain_prompt', 'Haz que los puntos clave de las diapositivas sean más detallados, informativos y descriptivos')
            },
            {
                text: t('chip_fallback_generate_text', 'Todo listo! Crear presentación'),
                primary: true,
                action: 'generate'
            }
        ];
    }

    window._chipsRenderTimeout = setTimeout(() => {
        if (!document.body.contains(chipsContainer)) return;
        chipsContainer.innerHTML = '';
        
        suggestedChips.forEach((chip, cIdx) => {
            const btn = document.createElement('button');
            btn.className = `suggested-chip ${chip.primary ? 'chip-primary' : ''}`;
            btn.type = 'button';
            btn.innerHTML = chip.text;

            btn.addEventListener('click', () => {
                // Primary "Looks good! Create presentation" chip: skip the AI skeleton
                // analysis entirely and kick off the final generation straight from
                // the current outline. This avoids a wasted /generate-skeleton call.
                if (chip.action === 'generate') {
                    if (typeof window.proceedWithCurrentOutline === 'function') {
                        window.proceedWithCurrentOutline();
                    }
                    return;
                }

                const inputEl = document.getElementById('w-tema');
                const btnGenerateMain = document.getElementById('btn-generate');
                if (inputEl && btnGenerateMain) {
                    inputEl.value = chip.prompt || chip.text;
                    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                    btnGenerateMain.disabled = false;
                    btnGenerateMain.click();
                }
            });
            chipsContainer.appendChild(btn);

            if (window.gsap) {
                window.gsap.fromTo(btn, 
                    { opacity: 0, scale: 0.95, x: -15 }, 
                    { opacity: 1, scale: 1, x: 0, duration: 0.4, ease: 'power2.out', delay: cIdx * 0.08 }
                );
            }
        });
    }, 1000);
};

function initOutlineEditor(skeletonData, mode) {
    window.prepareOutlineStreaming(mode);
    window.finalizeStreamingOutline(skeletonData);
}

function renderOutlineSlides() {
    const container = getOutlineDom().slidesContainer;
    if (!container) return;
    container.innerHTML = '';

    const slides = window.outlineEditorState.skeleton.slides || [];

    slides.forEach((slide, index) => {
        const item = document.createElement('div');
        item.className = 'seamless-slide-item';
        item.dataset.index = index;

        item.innerHTML = `
            <div class="seamless-slide-number">${index + 1}.</div>
            <textarea id="outline-slide-title-${index}" name="outline-slide-title-${index}" class="seamless-title-input outline-slide-title" placeholder="Slide Title" data-index="${index}" rows="1" aria-label="Slide Title">${escapeHtml(slide.title || '')}</textarea>
            
            <div class="seamless-points-list" id="outline-points-${index}">
                ${(slide.key_points || []).map((point, pIndex) => `
                    <div class="seamless-point-item">
                        <span class="seamless-point-bullet">-</span>
                        <textarea id="outline-slide-${index}-point-${pIndex}" name="outline-slide-${index}-point-${pIndex}" class="seamless-point-input outline-point-input" data-sindex="${index}" data-pindex="${pIndex}" rows="1" aria-label="Bullet point">${escapeHtml(point)}</textarea>
                    </div>
                `).join('')}
            </div>
        `;

        container.appendChild(item);
    });

    bindOutlineEvents();
}

function bindOutlineEvents() {

    // Bug #21: Use debounce for textarea inputs to avoid reflow on every keystroke
    function debounce(fn, ms) {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
    }

    // Helper for auto-resizing textareas
    const autoResizeTextarea = (el) => {
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = (el.scrollHeight) + 'px';
    };

    // Add event listeners for inputs — use dataset.index to always read from live state
    document.querySelectorAll('.outline-slide-title').forEach(input => {
        autoResizeTextarea(input);
        input.addEventListener('input', debounce((e) => {
            autoResizeTextarea(e.target);
            const idx = parseInt(e.target.dataset.index, 10);
            const slides = window.outlineEditorState.skeleton.slides;
            if (slides[idx] !== undefined) slides[idx].title = e.target.value;
        }, 80));
    });
    document.querySelectorAll('.outline-slide-desc').forEach(input => {
        autoResizeTextarea(input);
        input.addEventListener('input', debounce((e) => {
            autoResizeTextarea(e.target);
            const idx = parseInt(e.target.dataset.index, 10);
            const slides = window.outlineEditorState.skeleton.slides;
            if (slides[idx] !== undefined) slides[idx].subtitle = e.target.value;
        }, 80));
    });
    document.querySelectorAll('.outline-slide-type-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.index, 10);
            const slides = window.outlineEditorState.skeleton.slides;
            if (slides[idx] !== undefined) slides[idx].role = e.target.value;
        });
    });

    // Initialize custom Slide Type dropdowns
    document.querySelectorAll('.slide-type-dropdown').forEach(container => {
        const trigger = container.querySelector('.custom-select-trigger');
        const menu = container.querySelector('.custom-select-menu');
        const hiddenSelect = container.querySelector('.outline-slide-type-select');
        const labelSpan = trigger.querySelector('.trigger-label');

        if (trigger && menu && hiddenSelect) {
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.slide-type-dropdown .custom-select-menu').forEach(otherMenu => {
                    if (otherMenu !== menu) {
                        otherMenu.classList.add('hidden');
                        otherMenu.parentElement.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
                    }
                });
                const isHidden = menu.classList.toggle('hidden');
                trigger.setAttribute('aria-expanded', !isHidden);
            });

            menu.querySelectorAll('.dropdown-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const val = item.getAttribute('data-value');
                    hiddenSelect.value = val;
                    labelSpan.textContent = item.textContent;

                    menu.querySelectorAll('.dropdown-item').forEach(btn => btn.classList.remove('active'));
                    item.classList.add('active');

                    hiddenSelect.dispatchEvent(new Event('change'));

                    menu.classList.add('hidden');
                    trigger.setAttribute('aria-expanded', 'false');
                });
            });
        }
    });
    document.querySelectorAll('.outline-point-input').forEach(input => {
        autoResizeTextarea(input);

        // Handle auto-add new point on Enter
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const sIdx = parseInt(e.target.dataset.sindex, 10);
                const pIdx = parseInt(e.target.dataset.pindex, 10);
                const slides = window.outlineEditorState.skeleton.slides;
                if (slides[sIdx] && slides[sIdx].key_points) {
                    slides[sIdx].key_points.splice(pIdx + 1, 0, "");
                    renderOutlineSlides();

                    // Focus the new input
                    setTimeout(() => {
                        const newInputs = document.querySelectorAll(`.outline-point-input[data-sindex="${sIdx}"]`);
                        if (newInputs[pIdx + 1]) {
                            newInputs[pIdx + 1].focus();
                        }
                    }, 10);
                }
            } else if (e.key === 'Backspace' && e.target.value === '') {
                e.preventDefault();
                const sIdx = parseInt(e.target.dataset.sindex, 10);
                const pIdx = parseInt(e.target.dataset.pindex, 10);
                const slides = window.outlineEditorState.skeleton.slides;
                if (slides[sIdx] && slides[sIdx].key_points && slides[sIdx].key_points.length > 1) {
                    slides[sIdx].key_points.splice(pIdx, 1);
                    renderOutlineSlides();

                    // Focus previous
                    setTimeout(() => {
                        const inputs = document.querySelectorAll(`.outline-point-input[data-sindex="${sIdx}"]`);
                        if (inputs[Math.max(0, pIdx - 1)]) {
                            const prevInput = inputs[Math.max(0, pIdx - 1)];
                            prevInput.focus();
                            prevInput.setSelectionRange(prevInput.value.length, prevInput.value.length);
                        }
                    }, 10);
                }
            }
        });

        input.addEventListener('input', debounce((e) => {
            autoResizeTextarea(e.target);
            const sIdx = parseInt(e.target.dataset.sindex, 10);
            const pIdx = parseInt(e.target.dataset.pindex, 10);
            const slides = window.outlineEditorState.skeleton.slides;
            if (slides[sIdx] && slides[sIdx].key_points) {
                slides[sIdx].key_points[pIdx] = e.target.value;
            }
        }, 80));
    });
    document.querySelectorAll('.outline-point-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const btnEl = e.target.closest('.outline-point-delete');
            const sIdx = parseInt(btnEl.dataset.sindex, 10);
            const pIdx = parseInt(btnEl.dataset.pindex, 10);
            const slides = window.outlineEditorState.skeleton.slides;
            if (slides[sIdx]) slides[sIdx].key_points.splice(pIdx, 1);
            renderOutlineSlides();
        });
    });
    document.querySelectorAll('.outline-slide-color-picker').forEach(picker => {
        picker.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.index, 10);
            const slides = window.outlineEditorState.skeleton.slides;
            if (slides[idx] !== undefined) slides[idx].bg_color = e.target.value;
            const card = e.target.closest('.outline-slide-card');
            const indicator = card && card.querySelector('.outline-slide-bg-indicator');
            if (indicator) indicator.style.backgroundColor = e.target.value;
        });
    });

    updateOutlineSlideCount();
}

window.stopOutlineGeneration = function () {
    // 1. Render all slides statically right away so the user doesn't lose what was streamed so far
    if (window.outlineEditorState && window.outlineEditorState.skeleton) {
        renderOutlineSlides();
        window.renderOutlineSuggestedChips(window.outlineEditorState.skeleton);
    }

    // 2. Mark loading as false and enable controls
    window.outlineEditorState.isLoading = false;

    // 3. Re-enable global buttons and remove is-generating class
    const btnGenerate = document.getElementById('btn-generate');
    if (btnGenerate) {
        btnGenerate.classList.remove('is-generating');
        btnGenerate.disabled = false;
    }
    const btnLang = document.getElementById('btn-lang-dropdown');
    if (btnLang) btnLang.disabled = false;

    const outlineDom = getOutlineDom();
    const btnGen = outlineDom.generateButton;
    const btnAdd = outlineDom.addSlideButton;
    if (btnGen) btnGen.disabled = false;
    if (btnAdd) btnAdd.disabled = false;

    if (typeof window.validateGenerateButton === 'function') {
        window.validateGenerateButton();
    }
};

function updateOutlineSlideCount() {
    const slides = window.outlineEditorState.skeleton.slides || [];
    const countEl = document.getElementById('outline-slide-count');
    if (countEl) countEl.textContent = `${slides.length} slides`;

    const addSlideBtn = getOutlineDom().addSlideButton;
    if (addSlideBtn) {
        if (slides.length >= window.outlineEditorState.maxSlides) {
            addSlideBtn.disabled = true;
            addSlideBtn.title = `Maximum limit of ${window.outlineEditorState.maxSlides} slides reached.`;
        } else {
            addSlideBtn.disabled = false;
            addSlideBtn.title = '';
        }
    }
}

function addBlankSlide() {
    const slides = window.outlineEditorState.skeleton.slides;
    if (slides.length >= window.outlineEditorState.maxSlides) return;

    slides.push({
        role: "concept",
        title: "",
        subtitle: "",
        key_points: []
    });
    renderOutlineSlides();

    // Bug #7/#20: scroll to bottom AFTER render, then animate the new card in
    const main = document.querySelector('.outline-main');
    requestAnimationFrame(() => {
        if (main) main.scrollTop = main.scrollHeight;
        // Animate the last card as newly added
        const cards = document.querySelectorAll('.outline-slide-card');
        const newCard = cards[cards.length - 1];
        if (newCard) {
            newCard.classList.add('is-new');
            requestAnimationFrame(() => newCard.classList.add('is-new-visible'));
            setTimeout(() => { newCard.classList.remove('is-new', 'is-new-visible'); }, 500);
        }
    });
}

async function addSlideWithAI() {
    const slides = window.outlineEditorState.skeleton.slides;
    if (slides.length >= window.outlineEditorState.maxSlides) return;

    const topic = document.getElementById('outline-title-input').value;

    const btn = document.getElementById('btn-add-slide-ai');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Generating...';
    btn.disabled = true;

    // Inject a loading skeleton card at the bottom
    const container = getOutlineDom().slidesContainer;
    if (!container) return;
    const loadingCard = document.createElement('div');
    loadingCard.className = 'outline-slide-card is-loading is-ai-loading is-new';
    loadingCard.innerHTML = `
        <div class="outline-slide-bg-indicator" style="background-color: #121212"></div>
        <div class="outline-slide-number skeleton-loading-pulse" style="color:transparent">-</div>
        <div class="outline-slide-content">
            <div class="outline-slide-header">
                <div class="outline-slide-title skeleton-loading-pulse"></div>
                <div class="outline-slide-type-select skeleton-loading-pulse" style="width: 80px; height: 1.5rem; border-radius: 6px;"></div>
            </div>
            <div class="outline-slide-desc skeleton-loading-pulse"></div>
            <div class="outline-points-list">
                <div class="outline-point-item">
                    <span class="outline-point-bullet skeleton-loading-pulse"></span>
                    <div class="outline-point-input skeleton-loading-pulse"></div>
                </div>
                <div class="outline-point-item">
                    <span class="outline-point-bullet skeleton-loading-pulse"></span>
                    <div class="outline-point-input skeleton-loading-pulse" style="width: 60%"></div>
                </div>
            </div>
        </div>
    `;
    container.appendChild(loadingCard);

    // Animate the skeleton in and scroll to bottom immediately
    requestAnimationFrame(() => {
        const main = document.querySelector('.outline-main');
        if (main) main.scrollTop = main.scrollHeight;
        loadingCard.classList.add('is-new-visible');
    });

    try {
        const response = await fetch('/generate-outline-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'slide',
                topic: topic,
                existingSlides: slides
            })
        });

        if (!response.ok) throw new Error('Generation failed');

        const data = await response.json();
        if (data.item) {
            slides.push(data.item);
            renderOutlineSlides();
            // Same enter animation as addBlankSlide
            const main = document.querySelector('.outline-main');
            requestAnimationFrame(() => {
                if (main) main.scrollTop = main.scrollHeight;
                const cards = document.querySelectorAll('.outline-slide-card');
                const newCard = cards[cards.length - 1];
                if (newCard) {
                    newCard.classList.add('is-new');
                    requestAnimationFrame(() => newCard.classList.add('is-new-visible'));
                    setTimeout(() => { newCard.classList.remove('is-new', 'is-new-visible'); }, 500);
                }
            });
        }
    } catch (e) {
        console.error(e);
        alert('Failed to generate slide. Please try again.');
    } finally {
        // Remove the loading skeleton card (renderOutlineSlides would overwrite it anyway, but this is safer for failures)
        if (loadingCard && loadingCard.parentNode) {
            loadingCard.parentNode.removeChild(loadingCard);
        }
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function addBlankPoint(slideIndex) {
    const slides = window.outlineEditorState.skeleton.slides;
    if (!slides[slideIndex].key_points) slides[slideIndex].key_points = [];
    slides[slideIndex].key_points.push("");

    // Bug #10: Instead of full re-render, only re-render the affected slide card's point list
    // so the user doesn't lose focus on other fields.
    const pointList = document.getElementById(`outline-points-${slideIndex}`);
    if (pointList) {
        const pIdx = slides[slideIndex].key_points.length - 1;
        const newItem = document.createElement('div');
        newItem.className = 'outline-point-item';
        newItem.innerHTML = `
            <span class="outline-point-bullet">●</span>
            <textarea id="outline-slide-${slideIndex}-point-${pIdx}" name="outline-slide-${slideIndex}-point-${pIdx}" class="outline-point-input" data-sindex="${slideIndex}" data-pindex="${pIdx}" rows="1" aria-label="Bullet point" style="height: auto; resize: none; overflow-y: hidden;"></textarea>
            <button type="button" class="outline-point-delete" data-sindex="${slideIndex}" data-pindex="${pIdx}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
        `;
        pointList.appendChild(newItem);

        // Wire up the new textarea
        const textarea = newItem.querySelector('.outline-point-input');
        const autoResize = (el) => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
        textarea.addEventListener('input', (e) => {
            autoResize(e.target);
            const sIdx = parseInt(e.target.dataset.sindex, 10);
            const pIx = parseInt(e.target.dataset.pindex, 10);
            const sl = window.outlineEditorState.skeleton.slides;
            if (sl[sIdx] && sl[sIdx].key_points) sl[sIdx].key_points[pIx] = e.target.value;
        });

        // Wire up the delete button
        const deleteBtn = newItem.querySelector('.outline-point-delete');
        deleteBtn.addEventListener('click', () => {
            const sIdx = parseInt(deleteBtn.dataset.sindex, 10);
            const pIx = parseInt(deleteBtn.dataset.pindex, 10);
            const sl = window.outlineEditorState.skeleton.slides;
            if (sl[sIdx]) sl[sIdx].key_points.splice(pIx, 1);
            renderOutlineSlides();
        });

        // Bug #10: Focus the new textarea so user can immediately type
        textarea.focus();
        // Animate in
        newItem.classList.add('is-new');
        requestAnimationFrame(() => newItem.classList.add('is-new-visible'));
        setTimeout(() => newItem.classList.remove('is-new', 'is-new-visible'), 400);
    } else {
        // Fallback: full re-render if DOM element not found
        renderOutlineSlides();
    }
}

function deleteSlide(index) {
    if (confirm('Are you sure you want to delete this slide?')) {
        window.outlineEditorState.skeleton.slides.splice(index, 1);
        renderOutlineSlides();
    }
}

function moveSlideUp(index) {
    if (index === 0) return;
    const slides = window.outlineEditorState.skeleton.slides;
    const temp = slides[index - 1];
    slides[index - 1] = slides[index];
    slides[index] = temp;
    // Bug #20: preserve scroll position after re-render
    const main = document.querySelector('.outline-main');
    const scrollTop = main ? main.scrollTop : 0;
    renderOutlineSlides();
    requestAnimationFrame(() => { if (main) main.scrollTop = scrollTop; });
}

function moveSlideDown(index) {
    const slides = window.outlineEditorState.skeleton.slides;
    if (index === slides.length - 1) return;
    const temp = slides[index + 1];
    slides[index + 1] = slides[index];
    slides[index] = temp;
    const main = document.querySelector('.outline-main');
    const scrollTop = main ? main.scrollTop : 0;
    renderOutlineSlides();
    requestAnimationFrame(() => { if (main) main.scrollTop = scrollTop; });
}

function resumeOutlineEditor() {
    if (!window.outlineEditorState.skeleton) {
        window.outlineEditorState.skeleton = { slides: [] };
    }

    // Ensure all editing UI elements are visible when resuming a real draft
    document.querySelector('.outline-sidebar')?.style.removeProperty('display');
    document.querySelector('.outline-main-header')?.style.removeProperty('display');
    document.getElementById('legacy-outline-title-input')?.style.removeProperty('display');
    document.querySelector('.outline-floating-footer')?.style.removeProperty('display');
    const emptyState = document.getElementById('outline-empty-state');
    if (emptyState) emptyState.classList.add('hidden');

    if (window.__applyTranslations) window.__applyTranslations();

    // Sync custom dropdown UI values when resuming
    if (typeof syncCustomDropdowns === 'function') syncCustomDropdowns();

    const outlineContainer = getActiveOutlineContainer();
    if (outlineContainer) outlineContainer.classList.remove('hidden');

    const backdrop = document.getElementById('outline-backdrop');
    if (backdrop) backdrop.classList.add('active');

    const edgeTab = document.getElementById('outline-edge-tab');
    if (edgeTab) {
        edgeTab.classList.add('is-open');
        const tabText = edgeTab.querySelector('span');
        if (tabText) tabText.textContent = window.__t ? window.__t('close_draft', 'Close draft') : 'Close draft';
    }

    const heroTextSpan = document.querySelector('.hero-title-text');
    if (heroTextSpan) {
        // Kill typewriter before overwriting hero text
        if (window._heroTypewriterTimer) {
            clearTimeout(window._heroTypewriterTimer);
            window._heroTypewriterTimer = null;
        }
        if (window._heroResetTimer) {
            clearTimeout(window._heroResetTimer);
            window._heroResetTimer = null;
        }
        if (window._btnMsgTimer) {
            clearTimeout(window._btnMsgTimer);
            window._btnMsgTimer = null;
        }
        const heroTitle = document.querySelector('.hero-title');
        if (window.gsap && heroTitle) {
            window.gsap.killTweensOf(heroTitle);
            window.gsap.set(heroTitle, { x: 0, opacity: 1 });
        }
        if (!heroTextSpan.getAttribute('data-original-text')) {
            heroTextSpan.setAttribute('data-original-text', heroTextSpan.textContent);
        }
        if (window.outlineEditorState.isLoading) {
            heroTextSpan.textContent = window.__t ? window.__t('generating_outline', 'Generating structure...') : 'Generating structure...';
        } else {
            heroTextSpan.textContent = window.__t ? window.__t('waiting_for_user', 'Waiting for your review...') : 'Waiting for your review...';
        }
        heroTextSpan.parentElement.classList.add('waiting-state');
    }
}

// Global functions
window.showOutlineEditorLoading = showOutlineEditorLoading;
window.initOutlineEditor = initOutlineEditor;
window.resumeOutlineEditor = resumeOutlineEditor;
window.addBlankPoint = addBlankPoint;
window.deleteSlide = deleteSlide;
window.moveSlideUp = moveSlideUp;
window.moveSlideDown = moveSlideDown;

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function syncCustomDropdowns() {
    ['tone', 'audience', 'density'].forEach(type => {
        const select = document.getElementById(`outline-${type}-select`);
        const trigger = document.getElementById(`btn-outline-${type}-dropdown`);
        if (select && trigger) {
            const val = select.value;
            const activeItem = document.querySelector(`#outline-${type}-dropdown-menu .dropdown-item[data-value="${val}"]`);
            const labelSpan = trigger.querySelector('.trigger-label');
            if (activeItem && labelSpan) {
                // Keep the exact data-i18n translation key to support dynamic translations
                if (activeItem.getAttribute('data-i18n')) {
                    labelSpan.setAttribute('data-i18n', activeItem.getAttribute('data-i18n'));
                } else {
                    labelSpan.removeAttribute('data-i18n');
                }
                labelSpan.textContent = activeItem.textContent;

                // Toggle active styling
                document.querySelectorAll(`#outline-${type}-dropdown-menu .dropdown-item`).forEach(btn => {
                    btn.classList.toggle('active', btn === activeItem);
                });
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Custom Sidebar Select Dropdowns
    ['tone', 'audience', 'density'].forEach(type => {
        const container = document.getElementById(`outline-${type}-dropdown-container`);
        if (!container) return;

        const trigger = document.getElementById(`btn-outline-${type}-dropdown`);
        const menu = document.getElementById(`outline-${type}-dropdown-menu`);
        const select = document.getElementById(`outline-${type}-select`);

        if (trigger && menu && select) {
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close other custom menus
                document.querySelectorAll('.outline-custom-dropdown .dropdown-menu').forEach(otherMenu => {
                    if (otherMenu !== menu) {
                        otherMenu.classList.add('hidden');
                        otherMenu.parentElement.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
                    }
                });

                const isHidden = menu.classList.toggle('hidden');
                trigger.setAttribute('aria-expanded', !isHidden);
            });

            menu.querySelectorAll('.dropdown-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const val = item.getAttribute('data-value');
                    select.value = val;

                    // Dispatch change event to notify skeleton builder
                    select.dispatchEvent(new Event('change'));

                    syncCustomDropdowns();
                    menu.classList.add('hidden');
                    trigger.setAttribute('aria-expanded', 'false');
                });
            });
        }
    });

    // Close custom dropdowns on document click
    document.addEventListener('click', () => {
        document.querySelectorAll('.outline-custom-dropdown .dropdown-menu').forEach(menu => {
            menu.classList.add('hidden');
            menu.parentElement.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
        });
    });

    bindOutlineBubbleActions(document.getElementById('outline-container'));

    // Back to Chat button
    const btnBack = document.getElementById('btn-outline-back');
    if (btnBack) {
        btnBack.addEventListener('click', () => {
            const msg = window.__t ? window.__t('confirm_exit_draft', 'Are you sure you want to go back? Your progress will be lost.') : 'Are you sure you want to go back? Your progress will be lost.';
            if (!confirm(msg)) return;

            // Fix #6: Abort any in-flight skeleton or generation fetch
            if (window._activeGenController) {
                window._activeGenController.abort();
                window._activeGenController = null;
            }

            // Hide container so beforeunload doesn't fire a duplicate warning
            const container = getActiveOutlineContainer();
            if (container) container.classList.add('hidden');

            // Cleanly return to the main menu with a pristine Home URL (no hashes)
            window.location.href = window.location.origin + window.location.pathname;
        });
    }

    // Backdrop click closes the drawer
    const backdrop = document.getElementById('outline-backdrop');
    if (backdrop && btnBack) {
        backdrop.addEventListener('click', () => {
            btnBack.click();
        });
    }

    // Edge tab opens/closes the drawer
    const edgeTab = document.getElementById('outline-edge-tab');
    if (edgeTab) {
        edgeTab.addEventListener('click', () => {
            if (edgeTab.classList.contains('is-open')) {
                const btnBack = document.getElementById('btn-outline-back');
                if (btnBack) btnBack.click();
            } else if (window.outlineEditorState.skeleton) {
                // There is a draft — resume it normally
                resumeOutlineEditor();
            } else {
                // No draft generated yet — open the panel showing ONLY the empty state
                const container = document.getElementById('outline-container');
                if (container) container.classList.remove('hidden');

                // Show empty state, hide all editing UI
                const emptyState = document.getElementById('outline-empty-state');
                if (emptyState) emptyState.classList.remove('hidden');
                document.querySelector('.outline-sidebar')?.style.setProperty('display', 'none');
                document.querySelector('.outline-main-header')?.style.setProperty('display', 'none');
                document.getElementById('legacy-outline-title-input')?.style.setProperty('display', 'none');
                document.querySelector('.outline-floating-footer')?.style.setProperty('display', 'none');

                edgeTab.classList.add('is-open');
                const tabText = edgeTab.querySelector('span');
                if (tabText) tabText.textContent = window.__t ? window.__t('close_draft', 'Close draft') : 'Close draft';

                // Apply translations so the empty state shows the correct language
                if (window.__applyTranslations) window.__applyTranslations();
            }
        });
    }
});
