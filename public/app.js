document.addEventListener('DOMContentLoaded', () => {
    // Prevent accidental browser navigation when dragging files over the page
    window.addEventListener('dragover', (e) => e.preventDefault(), false);
    window.addEventListener('drop', (e) => e.preventDefault(), false);

    // =========================================================
    // DOM ELEMENTS
    // =========================================================
    const chatScreen = document.getElementById('chat-screen');
    const previewContainer = document.getElementById('preview-container');
    const resultContainer = document.getElementById('result-container');
    const errorContainer = document.getElementById('error-container');
    const refusedContainer = document.getElementById('refused-container');
    const refusedMessage = document.getElementById('refused-message');

    const downloadBtn = document.getElementById('download-btn');
    const resultSubtitle = document.getElementById('result-subtitle');
    const resetBtn = document.getElementById('reset-btn');
    const backBtn = document.getElementById('back-btn');
    const errorMessage = document.getElementById('error-message');
    const temaError = document.getElementById('tema-error');
    const scrollySection = document.getElementById('scrolly-three');

    // Preview elements
    let previewIframe = document.getElementById('preview-iframe');
    const slideDots = document.getElementById('slide-dots');
    const slideLabel = document.getElementById('slide-label');
    const previewHeader = document.querySelector('.preview-unified-header');
    const finalizeBtn = document.getElementById('finalize-btn');
    const previewResetBtn = document.getElementById('preview-reset-btn');
    const progressBarEl = document.getElementById('loading-progress-bar');

    // State
    let currentSlide = 0;
    window.eidosCurrentSlide = 0; // Initialize globally for editor iframe sync
    let totalSlides = 0;
    let generatedHtml = '';
    let slideContainer = null; // The actual parent element of the slides (may be body or a wrapper)
    let currentTitle = 'Presentation';
    let _refreshSlotOverlays = null; // assigned in injectImageReplacementSystem
    let _overlayMap = new Map(); // slotEl -> { input, label }

    // Listen for messages from iframe during skeleton generation
    window.addEventListener('message', (e) => {
        if (!e.data) return;
        if (e.data.type === 'slideUpdate') {
            const count = e.data.count;
            totalSlides = count;
            if (slideLabel) {
                const tpl = window.__eidos_t("slide_label_tpl", "{current} / {total}");
                slideLabel.textContent = tpl.replace('{current}', count).replace('{total}', count);
            }
            currentSlide = count - 1;

            // Rebuild dots and minimap skeletons during generation
            if (typeof buildDots === 'function') buildDots();
            updateMinimapSkeleton(count);
        }
        if (e.data.type === 'titleUpdate') {
            const previewLabel = document.getElementById('preview-topic-label');
            if (previewLabel) {
                // Keep it short if it's too long
                let t = e.data.title.replace(/<[^>]+>/g, '').trim();
                if (t.length > 50) t = t.substring(0, 47) + '...';
                previewLabel.textContent = t;

            }
        }
    });

    // --- i18n is now handled globally by i18n.js ---


    // =========================================================
    // TYPEWRITER EFFECT
    // =========================================================
    const typewriterElChat = document.getElementById('chat-typewriter-text');
    const typewriterCursor = document.getElementById('chat-typewriter-cursor');
    const chatPlaceholderContainer = document.getElementById('chat-placeholder');
    const topicsEn = [
        "Human evolution, 6 slides, red with white, author: John Smith",
        "Quantum Computing, 10 slides, minimalist black and white",
        "Machine Learning Applications, 5 slides, green, tech style",
        "Space Exploration Timeline, 8 slides, dark theme, balanced",
        "Global Economic Trends, 5 slides, blue and yellow",
        "Sustainable City Planning, 10 slides, eco green, summarized"
    ];

    const topicsEs = [
        "Evolución de la Democracia, 8 slides, azul oscuro, resumido",
        "La Revolución Francesa, 12 slides, rojo y azul, detallado",
        "Impacto de Redes Sociales, 10 slides, violeta, autor: Jane Doe",
        "Historia del Arte Moderno, 12 slides, tonos pastel, profesor: H. Lee",
        "Inteligencia Artificial en Medicina, 8 slides, minimalista",
        "El Renacimiento Italiano, 7 slides, tonos sepia y dorado"
    ];

    const topics = window.currentLang === 'es' ? topicsEs : topicsEn;

    // Randomize topics so everyone gets a different experience
    for (let i = topics.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [topics[i], topics[j]] = [topics[j], topics[i]];
    }
    let typewriterRunning = false;
    let topicIndex = 0;
    let typeCharIndex = 0;
    let isDeleting = false;
    let typewriterTimeout = null;

    function typewriterStep() {
        if (!typewriterRunning) return;

        const text = topics[topicIndex];

        // Show cursor while typing/deleting
        if (typewriterCursor) typewriterCursor.style.opacity = '1';

        if (isDeleting) {
            // Delete character
            typeCharIndex--;
            updateText(text.slice(0, typeCharIndex));

            if (typeCharIndex === 0) {
                isDeleting = false;
                topicIndex = (topicIndex + 1) % topics.length;
                typewriterTimeout = setTimeout(typewriterStep, 400); // Wait before next topic
            } else {
                typewriterTimeout = setTimeout(typewriterStep, 25); // Deletion speed
            }
        } else {
            // Type character
            typeCharIndex++;
            updateText(text.slice(0, typeCharIndex));

            if (typeCharIndex === text.length) {
                // Done typing topic, pause and blink cursor
                isDeleting = true;

                // Blink cursor trick before deleting
                if (typewriterCursor) typewriterCursor.style.opacity = '0';
                setTimeout(() => { if (typewriterRunning && typewriterCursor) typewriterCursor.style.opacity = '1'; }, 500);
                setTimeout(() => { if (typewriterRunning && typewriterCursor) typewriterCursor.style.opacity = '0'; }, 1000);
                setTimeout(() => { if (typewriterRunning && typewriterCursor) typewriterCursor.style.opacity = '1'; }, 1500);

                // Wait 2 seconds total before deleting
                typewriterTimeout = setTimeout(typewriterStep, 2000);
            } else {
                typewriterTimeout = setTimeout(typewriterStep, 55 + Math.random() * 35); // Typing speed
            }
        }
    }

    function updateText(content) {
        if (typewriterElChat) typewriterElChat.textContent = content;
    }

    function startTypewriter() {
        if (typewriterRunning) return; // Prevent multiple instances
        typewriterRunning = true;
        isDeleting = false;
        topicIndex = 0;
        typeCharIndex = 0;
        updateText('');
        clearTimeout(typewriterTimeout);
        typewriterStep();
    }

    function stopTypewriter() {
        typewriterRunning = false;
        clearTimeout(typewriterTimeout);
    }

    // Start typewriter after a brief delay
    setTimeout(() => {
        if (chatPlaceholderContainer && document.getElementById('w-tema').value.trim() === '') {
            startTypewriter();
        }
    }, 1000);

    // Handle browser back/forward button
    window.addEventListener('popstate', (e) => {
        const state = e.state;
        if (!state) return;
    });

    // Clear error on typing and validate length
    const temaInput = document.getElementById('w-tema');
    const btnGenerate = document.getElementById('btn-generate');

    temaInput.addEventListener('input', () => {
        const val = temaInput.value;

        // NEW: Scroll to top if user starts typing while scrolled down (e.g. in the scrolly section)
        if (window.scrollY > 200) {
            if (typeof gsap !== 'undefined') {
                gsap.to(window, { scrollTo: 0, duration: 0.8, ease: "power2.out" });
            } else {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        }

        // Auto-resize vertical expansion
        temaInput.style.height = 'auto';
        temaInput.style.height = temaInput.scrollHeight + 'px';

        // Update character count
        const charCounter = document.getElementById('char-counter');
        if (charCounter) {
            const len = val.length;
            charCounter.textContent = `${len}/600`;
            if (len > 0) {
                charCounter.classList.add('visible');
            } else {
                charCounter.classList.remove('visible');
            }

            if (len > 550) {
                charCounter.style.color = '#ff5b5b'; // Red when approaching 600
            } else {
                charCounter.style.color = 'var(--muted)';
            }
        }

        if (val.length > 0) {
            temaError.classList.remove('visible');
            if (chatPlaceholderContainer) chatPlaceholderContainer.style.display = 'none';
            stopTypewriter(); // user is typing, stop anim
        } else {
            if (chatPlaceholderContainer) chatPlaceholderContainer.style.display = '';
            if (!typewriterRunning) startTypewriter(); // restart anim if empty
        }

        btnGenerate.disabled = val.trim().length < 4;
    });

    // Enter key to advance
    temaInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!btnGenerate.disabled) {
                btnGenerate.click();
            }
        }
    });



    // =========================================================
    // 5. GENERATE BUTTON
    // =========================================================
    const generateBtn = document.getElementById('btn-generate');
    const btnDebugCanva = document.getElementById('btn-debug-canva');
    const sendIcon = document.getElementById('btn-icon-send');
    const loaderIcon = document.getElementById('btn-icon-loader');

    function toggleGenerateLoading(isLoading) {
        const editorControls = [
            ...Array.from(document.querySelectorAll('.preview-unified-header button, .preview-unified-header select, .preview-unified-header input')),
            ...Array.from(document.querySelectorAll('#editor-tools-panel button, #editor-tools-panel select, #editor-tools-panel input, #editor-minimap button'))
        ];

        if (isLoading) {
            temaInput.disabled = true;
            generateBtn.disabled = true;
            if (btnDebugCanva) btnDebugCanva.disabled = true;
            if (sendIcon) sendIcon.classList.add('hidden');
            if (loaderIcon) loaderIcon.classList.remove('hidden');
            stopTypewriter();

            // Disable editor buttons/controls during generation
            editorControls.forEach(ctrl => { if (ctrl) ctrl.disabled = true; });
        } else {
            temaInput.disabled = false;
            generateBtn.disabled = temaInput.value.trim().length < 4;
            if (btnDebugCanva) btnDebugCanva.disabled = false;
            if (sendIcon) sendIcon.classList.remove('hidden');
            if (loaderIcon) loaderIcon.classList.add('hidden');
            if (typewriterCursor) typewriterCursor.style.display = '';

            // Enable editor buttons/controls after generation (or error)
            editorControls.forEach(ctrl => { if (ctrl) ctrl.disabled = false; });

            if (temaInput.value.trim() && chatPlaceholderContainer) {
                chatPlaceholderContainer.style.display = 'none';
            }

            if (temaInput.value.trim() === '' && !typewriterRunning) {
                startTypewriter();
            }
        }
    }

    async function handleGenerate(regenerateTema = null) {
        generatedHtml = ''; // Reset state for a fresh start
        currentSlide = 0;
        totalSlides = 0;
        const tema = regenerateTema || temaInput.value.trim();
        if (!tema) {
            temaError.classList.add('visible');
            temaInput.focus();
            return;
        }
        temaError.classList.remove('visible');

        // Everything the AI needs comes from the raw chat text.
        // The prompt handles extraction of: slide count, metadata, style, colors, language, etc.
        const requestData = {
            tema: tema
        };

        toggleGenerateLoading(true);

        const liquid = document.getElementById('liquid-transition');
        if (liquid) {
            document.body.classList.add('no-scroll'); // Problem 1: Prevent scrollbars
            liquid.classList.remove('hidden', 'empty-out');
            liquid.classList.add('active', 'fill-up');
            // Wait for water to fill
            await new Promise(r => setTimeout(r, 1000));
        }


        // Freeze Lenis so it doesn't fight scroll state on return
        if (window._eidosScrollytelling) window._eidosScrollytelling.pauseForPreview();
        window.removeEventListener('resize', scaleIframe); // evita acumulación

        // Hide chatScreen when loading
        chatScreen.classList.add('hidden');
        if (scrollySection) scrollySection.classList.add('hidden');
        previewHeader.classList.remove('slide-down');
        previewContainer.classList.remove('hidden');

        // Scale iframe immediately so the skeleton doesn't overflow/look zoomed in
        scaleIframe();
        window.addEventListener('resize', scaleIframe);

        // Reset the iframe completely by injecting a fresh DOM node
        const rawIframe = previewIframe.cloneNode();
        previewIframe.parentNode.replaceChild(rawIframe, previewIframe);
        previewIframe = rawIframe;

        // Clear Minimap and Dots
        const minimapList = document.getElementById('minimap-list');
        if (minimapList) {
            minimapList.innerHTML = '';
            minimapList.style.transform = 'none'; // Reset scrolling
        }
        if (slideDots) slideDots.innerHTML = '';

        const iframeDoc = previewIframe.contentDocument || previewIframe.contentWindow.document;
        iframeDoc.open();
        const loadingMsg = window.__eidos_t ? window.__eidos_t('loading-text', "Loading presentation structure...") : "Loading presentation structure...";
        const G_FONTS = `
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap" rel="stylesheet">`;
        const loadingHtml = `

        ${G_FONTS}
        <style class="skeleton-injector">
            body { background: #121212; margin: 0; padding: 0; font-family: sans-serif; }
            .loader-overlay {
                position: fixed; inset: 0; z-index: 99999; background: #121212; 
                display: flex; flex-direction: column; align-items: center; justify-content: center; color: #e0e0e0;
            }
            .loader-spinner {
                width: 48px; height: 48px; border: 4px solid rgba(255,255,255,0.1); border-left-color: #f0f0f0;
                border-radius: 50%; animation: ld-spin 1s linear infinite; margin-bottom: 20px;
            }
            @keyframes ld-spin { 100% { transform: rotate(360deg); } }
            .loader-text {
                font-size: 1.2rem; letter-spacing: 0.5px; opacity: 0.8; animation: ld-pulse 2s ease-in-out infinite;
                font-weight: 500;
            }
            @keyframes ld-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
        </style>
        <div id="temp-skeleton" class="loader-overlay">
            <div class="loader-spinner"></div>
            <div class="loader-text">${loadingMsg}</div>
        </div>
        <link rel="stylesheet" href="editor.css?v=3">
        <script src="editor.js?v=3"></script>
        `;

        // Wait for the AI's first chunk with a loading screen
        iframeDoc.write('<!DOCTYPE html>' + loadingHtml);

        // Immediately update preview label
        const previewLabel = document.getElementById('preview-topic-label');
        if (previewLabel) {
            if (previewLabel.tagName === 'INPUT') previewLabel.value = tema;
            else previewLabel.textContent = tema;
        }


        slideLabel.textContent = "1 / 1";
        updateMinimapSkeleton(1);

        if (liquid) {
            liquid.classList.replace('fill-up', 'empty-out');
            setTimeout(() => {
                liquid.classList.remove('empty-out', 'active');
                document.body.classList.remove('no-scroll');
            }, 5000); // Wait for the wave to actually leave the screen
        }



        try {
            const response = await fetch('/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const serverErr = errorData.error || `Server error: ${response.status}`;
                throw new Error(serverErr);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";
            let firstWrite = true;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                let lines = buffer.split('\n\n');
                buffer = lines.pop();

                for (let line of lines) {
                    if (line.trim() === '') continue;
                    if (line.startsWith('data: ')) {
                        let dataStr = line.substring(6);
                        if (dataStr.trim() === '[DONE]') continue;
                        let parsed;
                        try { parsed = JSON.parse(dataStr); } catch (e) { continue; }

                        if (parsed.chunk) {
                            if (firstWrite) {
                                iframeDoc.open();
                                firstWrite = false;
                                const skelStyle = `
                                <style class="skeleton-injector">
                                    html.skeleton-active {
                                        --skel-bg: rgba(255,255,255,0.06) !important;
                                        --skel-hi: rgba(255,255,255,0.12) !important;
                                        overflow-x: auto !important;
                                        overflow-y: hidden !important;
                                        scroll-behavior: smooth !important;
                                    }
                                    html.skeleton-active body {
                                        display: flex !important;
                                        flex-direction: row !important;
                                        width: max-content !important;
                                        height: 100vh !important;
                                        margin: 0 !important;
                                        padding: 0 !important;
                                    }
                                    html.skeleton-active section.s, html.skeleton-active section[class*="slide"] {
                                        flex: 0 0 100vw !important;
                                        width: 100vw !important;
                                        height: 100vh !important;
                                        overflow: hidden !important;
                                        box-sizing: border-box !important;
                                        margin: 0 !important;
                                    }
                                    html.skeleton-active ::-webkit-scrollbar { display: none !important; }
                                    html.skeleton-active h1, html.skeleton-active h2, html.skeleton-active h3, 
                                    html.skeleton-active p, html.skeleton-active li, html.skeleton-active span, 
                                    html.skeleton-active b, html.skeleton-active strong, html.skeleton-active em, 
                                    html.skeleton-active i {
                                        color: transparent !important;
                                        background: linear-gradient(90deg, var(--skel-bg) 25%, var(--skel-hi) 50%, var(--skel-bg) 75%) !important;
                                        background-size: 200% 100% !important;
                                        animation: sk-shimmer 1.5s infinite linear !important;
                                        border-radius: 4px !important;
                                        border-color: transparent !important;
                                        text-shadow: none !important;
                                        box-shadow: none !important;
                                    }
                                    html.skeleton-active [data-image-slot] > div {
                                        background: linear-gradient(90deg, var(--skel-bg) 25%, var(--skel-hi) 50%, var(--skel-bg) 75%) !important;
                                        background-size: 200% 100% !important;
                                        animation: sk-shimmer 1.5s infinite linear !important;
                                    }
                                    html.skeleton-active img, html.skeleton-active svg {
                                        opacity: 0 !important;
                                    }
                                    @keyframes sk-shimmer {
                                        0% { background-position: 200% 0; }
                                        100% { background-position: -200% 0; }
                                    }
                                </style>
                                ${G_FONTS}
                                ${loadingHtml}
                                <script class="skeleton-injector">
                                    document.documentElement.classList.add('skeleton-active');
                                    let skelLastCount = 0;
                                    let sentTitle = false;
                                    const skelObs = new MutationObserver(() => {
                                        if (!document.documentElement.classList.contains('skeleton-active')) return;
                                        if (!sentTitle) {
                                            const h1 = document.querySelector('h1');
                                            if (h1 && h1.textContent.trim().length > 3) {
                                                sentTitle = true;
                                                window.parent.postMessage({ type: 'titleUpdate', title: h1.textContent.trim() }, '*');
                                            } else {
                                                const titleTag = document.querySelector('title');
                                                if (titleTag && titleTag.textContent.trim() && titleTag.textContent.trim() !== 'Document') {
                                                    sentTitle = true;
                                                    window.parent.postMessage({ type: 'titleUpdate', title: titleTag.textContent.trim() }, '*');
                                                }
                                            }
                                        }
                                        let slides = document.querySelectorAll('section.s');
                                        if (slides.length === 0) slides = document.querySelectorAll('section[class*="slide"]');
                                        if (slides.length === 0) slides = document.querySelectorAll('body > section');
                                        if (slides.length > 0) {
                                            const tempSkel = document.getElementById('temp-skeleton');
                                            if (tempSkel) tempSkel.remove();
                                        }
                                        if (slides.length > 0 && slides.length > skelLastCount) {
                                            skelLastCount = slides.length;
                                            window.parent.postMessage({ type: 'slideUpdate', count: skelLastCount }, '*');
                                            setTimeout(() => {
                                                if(slides[slides.length-1]) {
                                                    slides[slides.length-1].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
                                                }
                                            }, 100);
                                        }
                                    });
                                    skelObs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
                                </script>
                                `;
                                parsed.chunk = skelStyle + parsed.chunk;
                            }
                            iframeDoc.write(parsed.chunk);
                        }
                        if (parsed.refused) {
                            chatScreen.classList.add('hidden');
                            refusedMessage.textContent = parsed.message || (window.__eidos_t ? window.__eidos_t('refused_msg', "This topic cannot be generated.") : "This topic cannot be generated.");
                            refusedContainer.classList.remove('hidden');
                            previewContainer.classList.add('hidden');
                            iframeDoc.close();
                            toggleGenerateLoading(false);
                            return;
                        }
                        if (parsed.error) {
                            throw new Error(parsed.error);
                        }
                        if (parsed.done) {
                            generatedHtml = parsed.html;
                            let displayTitle = tema;
                            const configMatch = generatedHtml.match(/<!--\s*CONFIG\s*([\s\S]*?)\s*-->/i);
                            if (configMatch) {
                                try {
                                    const configObj = JSON.parse(configMatch[1]);
                                    if (configObj.Clean_Topic) displayTitle = configObj.Clean_Topic;
                                } catch (e) { }
                            }
                            if (displayTitle === tema) {
                                const titleMatch = generatedHtml.match(/<title>\s*(.*?)\s*<\/title>/i);
                                if (titleMatch && titleMatch[1]) {
                                    displayTitle = titleMatch[1];
                                } else {
                                    const h1Match = generatedHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
                                    if (h1Match && h1Match[1]) {
                                        displayTitle = h1Match[1].replace(/<[^>]+>/g, '').trim();
                                    }
                                }
                            }
                            if (previewLabel) {
                                if (previewLabel.tagName === 'INPUT') previewLabel.value = displayTitle;
                                else previewLabel.textContent = displayTitle;
                            }
                            currentTitle = displayTitle;
                        }
                    }
                }
            }

            // End of while(true)
            if (buffer.trim()) {
                const remainingLines = buffer.split('\n');
                for (let rLine of remainingLines) {
                    if (rLine.startsWith('data: ')) {
                        const dataStr = rLine.substring(6);
                        try {
                            const parsed = JSON.parse(dataStr);
                            if (parsed.chunk) iframeDoc.write(parsed.chunk);
                            if (parsed.done && parsed.html) generatedHtml = parsed.html;
                        } catch (e) { }
                    }
                }
            }

            if (!generatedHtml || generatedHtml.trim().length < 50) {
                throw new Error("Sorry, could not generate the presentation correctly.");
            }

            iframeDoc.close();

            // --- FLICKER GATE: Fade out shortly before final reload ---
            const stage = document.getElementById('preview-stage');
            if (stage) stage.classList.add('flicker-mask');
            const minimapPanel = document.getElementById('editor-minimap');
            if (minimapPanel) minimapPanel.classList.add('flicker-mask');

            // Wait a tiny bit for the fade to start
            await new Promise(r => setTimeout(r, 100));

            // Re-clone at the end to match Debug mode's working behavior and ensure editor.js runs in a clean window
            const rawIframe = previewIframe.cloneNode();
            previewIframe.parentNode.replaceChild(rawIframe, previewIframe);
            previewIframe = rawIframe;

            initPreview(generatedHtml, () => {
                // Restore visibility only after setup is truly complete
                setTimeout(() => {
                    if (stage) stage.classList.remove('flicker-mask');
                    if (minimapPanel) minimapPanel.classList.remove('flicker-mask');
                }, 100);
            });

        } catch (error) {
            console.error(error);

            const errSubtitle = document.getElementById('t-error-subtitle');

            // Try to extract "Please retry in X seconds"
            let retryMsg = "";
            const retryMatch = error.message.match(/retry in ([\d\.]+s)/i);
            if (retryMatch) {
                const retryTpl = window.__eidos_t(window.currentLang === 'es' ? 'retry_in_es' : 'retry_in_en', "<br><br><strong>Retry in: {time}</strong>");
                retryMsg = retryTpl.replace('{time}', retryMatch[1]);
            }

            if (error.message.includes('429') || error.message.includes('503') || error.message.toLowerCase().includes('exhausted') || error.message.toLowerCase().includes('saturated')) {
                if (errSubtitle) {
                    errSubtitle.innerHTML = (window.__eidos_t ? window.__eidos_t('t-error-saturated', "The service is currently overloaded due to high demand. Please try again in a few minutes.") : "The service is currently overloaded due to high demand. Please try again in a few minutes.") + retryMsg;
                }
            } else {
                if (errSubtitle) {
                    errSubtitle.textContent = window.__eidos_t('error_subtitle', "The AI service is temporarily unavailable. This is usually resolved quickly.");
                }
            }

            errorMessage.textContent = error.message;
            errorContainer.classList.remove('hidden');
            previewContainer.classList.add('hidden');
            iframeDoc.close();
        } finally {
            toggleGenerateLoading(false);
        }
    }

    generateBtn.addEventListener('click', () => handleGenerate(null));

    if (btnDebugCanva) {
        btnDebugCanva.addEventListener('click', async () => {
            // Lenis nunca se paraba en debug — esto era otra fuente del problema
            if (window._eidosScrollytelling) window._eidosScrollytelling.pauseForPreview();
            try {
                toggleGenerateLoading(true);
                const res = await fetch('/debug-last');
                if (!res.ok) throw new Error('No last generated file found');
                let html = await res.text();

                let displayTitle = "Debug Mode";
                const configMatch = html.match(/<!--\s*CONFIG\s*([\s\S]*?)\s*-->/i);
                if (configMatch) {
                    try {
                        const configObj = JSON.parse(configMatch[1]);
                        if (configObj.Clean_Topic) displayTitle = configObj.Clean_Topic;
                    } catch (e) { }
                }

                if (html.includes('</body>')) {
                    html = html.replace('</body>', '<link rel="stylesheet" href="editor.css?v=3"><script src="editor.js?v=3"></script></body>');
                } else {
                    html += '<link rel="stylesheet" href="editor.css?v=3"><script src="editor.js?v=3"></script>';
                }

                generatedHtml = html;
                currentTitle = displayTitle;
                const previewLabel = document.getElementById('preview-topic-label');
                if (previewLabel) {
                    if (previewLabel.tagName === 'INPUT') previewLabel.value = currentTitle;
                    else previewLabel.textContent = currentTitle;
                }

                if (slideDots) slideDots.innerHTML = '';
                slideLabel.textContent = "1 / 1";

                chatScreen.classList.add('hidden');
                if (scrollySection) scrollySection.classList.add('hidden');
                previewHeader.classList.remove('slide-down');
                previewContainer.classList.remove('hidden');

                if (typeof scaleIframe === 'function') {
                    scaleIframe();
                    window.removeEventListener('resize', scaleIframe);
                    window.addEventListener('resize', scaleIframe);
                }

                const rawIframe = previewIframe.cloneNode();
                previewIframe.parentNode.replaceChild(rawIframe, previewIframe);
                previewIframe = rawIframe;

                const iframeDoc = previewIframe.contentDocument || previewIframe.contentWindow.document;
                iframeDoc.open();
                iframeDoc.write('<!DOCTYPE html>' + generatedHtml);
                iframeDoc.close();

                currentSlide = 0;
                initPreview(generatedHtml);
            } catch (err) {
                console.error(err);
                alert('No previous HTML found to debug. Please generate once.');
            } finally {
                toggleGenerateLoading(false);
            }
        });
    }

    // Preview actions (Edit / Regenerate / Back)
    const btnBackToChat = document.getElementById('btn-back-to-chat');
    if (btnBackToChat) {
        btnBackToChat.addEventListener('click', () => {
            previewContainer.classList.add('hidden');
            window.removeEventListener('resize', scaleIframe);
            chatScreen.classList.remove('hidden');
            if (scrollySection) scrollySection.classList.remove('hidden');
            window.dispatchEvent(new Event('resize'));
            if (window._eidosScrollytelling) window._eidosScrollytelling.resetScrollTriggers();
            temaInput.focus();
        });
    }

    const btnEditTopic = document.getElementById('btn-edit-topic');

    if (btnEditTopic) {
        btnEditTopic.addEventListener('click', () => {
            previewContainer.classList.add('hidden');
            chatScreen.classList.remove('hidden');
            temaInput.focus();
        });
    }

    const btnRegenerate = document.getElementById('btn-regenerate');
    if (btnRegenerate) {
        btnRegenerate.addEventListener('click', () => {
            // Problem 5: Don't hide preview or show chat, just trigger generation
            handleGenerate(temaInput.value.trim());
        });
    }


    // =========================================================
    // 6. PREVIEW SYSTEM
    // =========================================================

    function initPreview(html, callback) {
        let setupDone = false;

        // Set onload BEFORE writing so we don't miss the event
        previewIframe.onload = () => {
            console.log('initPreview: iframe onload event fired');
            setTimeout(doSetup, 50);
        };

        if (html) {
            // Anti-flicker: Prevent scrollbars and margins during initial parse
            const antiFlicker = `<style id="eidos-anti-flicker">
                html, body { 
                    overflow: hidden !important; 
                    margin: 0 !important; 
                    padding: 0 !important; 
                    background: transparent !important; 
                }
            </style>`;
            if (!html.includes('eidos-anti-flicker')) {
                html = antiFlicker + html;
            }

            // Ensure editor scripts are always present
            if (!html.includes('editor.js')) {
                if (html.includes('</body>')) {
                    html = html.replace('</body>', '<link rel="stylesheet" href="editor.css?v=3"><script src="editor.js?v=3"></script></body>');
                } else {
                    html += '<link rel="stylesheet" href="editor.css?v=3"><script src="editor.js?v=3"></script>';
                }
            }
            // Ensure fonts are present
            if (!html.includes('family=Archivo+Black')) {
                const G_FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap" rel="stylesheet"><style>section.s > *, .card, .flex-row, .grid-2, .grid-3, h1, h2, h3, p, .tag, .img-slot { position: relative; z-index: 1; }</style>`;
                if (html.includes('<head>')) {
                    html = html.replace('<head>', '<head>' + G_FONTS);
                } else {
                    html = G_FONTS + html;
                }
            }

            const doc = previewIframe.contentDocument || previewIframe.contentWindow.document;
            doc.open();
            doc.write('<!DOCTYPE html>' + html);
            doc.close();
            console.log('initPreview: updated iframe with final HTML');
        }

        const doSetup = () => {
            if (setupDone) return;
            setupDone = true;
            setupPreviewInteractions();
            if (typeof callback === 'function') callback();
        };

        // Try to detect if already loaded (sync srcdoc or manual write)
        const doc = previewIframe.contentDocument;
        if (doc && doc.readyState === 'complete' && findSlides(doc).length > 0) {
            setTimeout(doSetup, 50);
        }

        // Fallback: poll until slides appear in the DOM (handles slow CDN or missed onload)
        let attempts = 0;
        const poll = () => {
            if (setupDone) return;
            attempts++;
            const doc = previewIframe.contentDocument;
            if (doc && doc.body) {
                const found = findSlides(doc);
                if (found.length >= 1) {
                    doSetup();
                    return;
                }
            }
            if (attempts < 40) {
                setTimeout(poll, 250); // retry every 250ms, up to 10s
            } else {
                console.warn('findSlides: gave up polling, using fallback');
                doSetup(); // give up, use whatever we found
            }
        };
        setTimeout(poll, 300);
    }

    function findSlides(doc) {
        if (!doc || !doc.body) return [];

        // Strategy 1: section.s (the expected format from our prompt)
        let slides = doc.querySelectorAll('section.s');
        if (slides.length >= 1) return Array.from(slides);

        // Strategy 2: sections with class containing "slide"
        slides = doc.querySelectorAll('section[class*="slide"]');
        if (slides.length >= 1) return Array.from(slides);

        // Strategy 3: leaf sections (sections that don't contain other sections)
        const allSections = Array.from(doc.querySelectorAll('section'));
        const leafSections = allSections.filter(s => !s.querySelector('section'));
        if (leafSections.length >= 1) return leafSections;
        if (allSections.length >= 1) return allSections;

        // Strategy 4: divs with slide-like classes
        let divSlides = doc.querySelectorAll('div.s, div.slide, div[class*="slide"]');
        if (divSlides.length >= 1) return Array.from(divSlides);

        // Strategy 5: direct body children (excluding script/style/link/meta AND editor UI)
        const bodyKids = Array.from(doc.body.children).filter(el => {
            const tag = el.tagName;
            const isTool = el.classList.contains('eidos-selection-box') ||
                el.classList.contains('eidos-toolbar') ||
                el.classList.contains('eidos-guide') ||
                el.classList.contains('eidos-color-picker');
            return !['SCRIPT', 'STYLE', 'LINK', 'META'].includes(tag) && !isTool;
        });
        if (bodyKids.length >= 1) {
            // If there's only one kid and it contains slides, prefer its children (Strategy 6-like)
            if (bodyKids.length === 1) {
                const inner = Array.from(bodyKids[0].children).filter(el =>
                    !['SCRIPT', 'STYLE', 'LINK'].includes(el.tagName)
                );
                if (inner.length >= 1) return inner;
            }
            return bodyKids;
        }

        return Array.from(slides); // fallback to whatever last matched
    }

    function setupPreviewInteractions(targetIndex = 0) {
        const iframeDoc = previewIframe.contentDocument || previewIframe.contentWindow.document;
        if (!iframeDoc || !iframeDoc.body) return;

        // ── INJECT GOOGLE FONTS INTO LIVE PREVIEW IFRAME ──
        // The AI-generated HTML only imports the theme fonts (e.g. Syne + DM Sans via @import).
        // Font picker options like Playfair Display, Bebas Neue, etc. are NOT loaded in this document,
        // so changing font-family has no visual effect even though the inline style is applied correctly.
        // Fix: explicitly create <link> elements in the iframe's <head>.
        if (iframeDoc.head && !iframeDoc.head.querySelector('link[data-eidos-fonts]')) {
            const preconnect1 = iframeDoc.createElement('link');
            preconnect1.rel = 'preconnect';
            preconnect1.href = 'https://fonts.googleapis.com';
            iframeDoc.head.appendChild(preconnect1);

            const preconnect2 = iframeDoc.createElement('link');
            preconnect2.rel = 'preconnect';
            preconnect2.href = 'https://fonts.gstatic.com';
            preconnect2.crossOrigin = 'anonymous';
            iframeDoc.head.appendChild(preconnect2);

            const fontLink = iframeDoc.createElement('link');
            fontLink.rel = 'stylesheet';
            fontLink.dataset.eidosFonts = '1';
            fontLink.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap';
            iframeDoc.head.appendChild(fontLink);
            console.log('[Eidoslab] Google Fonts injected into live preview iframe');
        }

        const slides = findSlides(iframeDoc);
        totalSlides = slides.length || 1;
        // buildDots() was redundant here as it's called after restoration anyway

        // Attach global nav listeners only once to avoid memory leaks and CPU peaks
        if (!iframeDoc._eidosListenersAttached) {
            iframeDoc.addEventListener('wheel', handleSlideWheelNav, { passive: true });
            iframeDoc.addEventListener('touchstart', handleTouchStart, { passive: true });
            iframeDoc.addEventListener('touchend', handleTouchEnd, { passive: true });
            iframeDoc._eidosListenersAttached = true;
        }


        // Determine the container that holds the slides (could be body or a wrapper like <main>)
        slideContainer = (slides.length > 0) ? slides[0].parentElement : iframeDoc.body;

        // ── CRITICAL: Lock slide dimensions to absolute CSS pixels ──
        // (1122px x 631px) ensuring cross-os consistency regardless of host DPI.
        const naturalSlideW = 1122;

        // Fix each slide to the captured pixel width AND height
        slides.forEach(s => {
            s.style.flex = `0 0 1122px`;
            s.style.width = `1122px`;
            s.style.height = '631px';
            s.style.overflow = 'hidden';
            s.style.position = 'relative';
            s.style.boxSizing = 'border-box';
        });

        // If we are restoring state, we handle overlay re-keying in the 'eidos-state-restored' event listener
        // instead of doing a full destructive clear and rebuild here.
        if (!iframeDoc._eidosRestoringState) {
            injectImageReplacementSystem(iframeDoc);
        }

        // Apply horizontal carousel layout to the real slide container
        slideContainer.style.display = 'flex';
        slideContainer.style.flexDirection = 'row';
        slideContainer.style.width = 'max-content';
        slideContainer.style.height = '100%';
        slideContainer.style.margin = '0';
        slideContainer.style.padding = '0';

        // Problem 9: Restore the "rewind" effect. 
        // We capture how far the skeleton went and start the final render from there.
        const startSlide = currentSlide;
        if (startSlide > 0) {
            slideContainer.style.transform = `translateX(-${startSlide * naturalSlideW}px)`;
            // Force reflow BEFORE applying transition so the browser sees the start position
            void slideContainer.offsetWidth;
        }

        slideContainer.style.transition = 'transform 1.2s cubic-bezier(0.25, 1, 0.5, 1)';

        // Match minimap rewind speed
        const ml = document.getElementById('minimap-list');
        if (ml) ml.style.transition = 'transform 1.2s cubic-bezier(0.25, 1, 0.5, 1)';

        // Important: we don't reset currentSlide to 0 until scrollToSlide(targetIndex) runs
        scrollToSlide(targetIndex);

        // After the rewind is done, return to a faster, more responsive speed for editing
        setTimeout(() => {
            if (slideContainer) {
                slideContainer.style.transition = 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)';
            }
            if (ml) {
                ml.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
            }
        }, 1300);

        // Update overlays when carrousel transition ends
        slideContainer.removeEventListener('transitionend', _refreshSlotOverlays);
        slideContainer.addEventListener('transitionend', () => {
            if (_refreshSlotOverlays) _refreshSlotOverlays();
        });

        // Store for scrollToSlide to use without re-measuring
        previewIframe._slideWidthPx = naturalSlideW;

        // Ensure no scrollbars ever show up in the preview window
        iframeDoc.documentElement.style.overflow = 'hidden';
        iframeDoc.body.style.overflow = 'hidden';
        iframeDoc.body.style.margin = '0';
        iframeDoc.body.style.padding = '0';

        scrollToSlide(targetIndex);
        updateSlideCounter();
        scaleIframe();
        window.addEventListener('resize', scaleIframe);

        // Remove the skeleton-active class safely AFTER applying final layouts to avoid scrollbars
        iframeDoc.documentElement.classList.remove('skeleton-active');
        previewHeader.classList.add('slide-down');

        // Force reset scroll positions left over by 'scrollIntoView' during the skeleton stream!
        // This was making the absolute transform value fight with the document's scroll offset.
        if (previewIframe.contentWindow) previewIframe.contentWindow.scrollTo(0, 0);
        if (iframeDoc.documentElement) iframeDoc.documentElement.scrollLeft = 0;
        if (iframeDoc.body) iframeDoc.body.scrollLeft = 0;

        // Init React-like declarative UI binding for Editor Panels
        if (typeof window.initEditorUI === 'function') {
            window.initEditorUI(previewIframe);
        }

        // Fix #4/#5/#6: After Ctrl+Z, restoreState replaces body.innerHTML, creating NEW
        // DOM nodes. Parent labels are still valid but _overlayMap keys point to DEAD nodes.
        // Strategy: re-key the map by matching data-image-slot IDs (stable across restores).
        // This avoids duplicate listeners and the full rebuild/teardown cost.
        const iframeWinRef = previewIframe.contentWindow;
        if (iframeWinRef) {
            iframeWinRef.addEventListener('eidos-state-restored', (ev) => {
                const needsRebuild = ev.detail ? ev.detail.needsOverlayRebuild : true;
                if (!needsRebuild) return;
                const iDoc = previewIframe.contentDocument;
                if (!iDoc) return;
                
                // CRITICAL: Cache width early for scrollToSlide calculations
                previewIframe._slideWidthPx = 1122; 

                // --- OPTIMIZATION: Non-destructive overlay re-keying ---
                // 1. Map existing overlays by their slot ID (string attribute - survives innerHTML replace)
                const byId = new Map();
                _overlayMap.forEach((entry, slotEl) => {
                    const id = slotEl.dataset && slotEl.dataset.imageSlot;
                    if (id !== undefined) {
                        byId.set(String(id), entry);
                        if (entry.label) entry.label.style.display = 'none'; // Hide until repositioned
                    } else {
                        // Truly dead or no-id slot: clean up
                        if (entry.label) entry.label.remove();
                        if (entry.input) entry.input.remove();
                    }
                });

                // 2. Clear current map (we will refill it with the NEW DOM nodes)
                _overlayMap.clear();

                // 3. Match new DOM nodes with existing labels/ref objects
                iDoc.querySelectorAll('[data-image-slot]').forEach(newSlot => {
                    const id = String(newSlot.dataset.imageSlot);
                    const entry = byId.get(id);
                    if (entry) {
                        // RE-KEY: update the mutable ref to point to the NEW DOM node
                        entry.slotRef.current = newSlot;
                        _overlayMap.set(newSlot, entry);
                    } else {
                        // Truly new slot (e.g. from copy-paste or redo)
                        _buildOverlayForSlot(newSlot); 
                    }
                    
                    // REBUILD internal visual message (only if missing)
                    _ensureInternalOverlay(newSlot, iDoc);
                });

                // REBUILD iframe-internal visible overlays and re-bind listeners
                // REDUCED timeout: 150ms was too slow, causing visual lag
                clearTimeout(window._restoreBatchT);
                window._restoreBatchT = setTimeout(() => {
                    iDoc._eidosRestoringState = true;
                    setupPreviewInteractions(currentSlide);
                    iDoc._eidosRestoringState = false;
                    
                    // Final refresh of overlay positions
                    if (window._refreshSlotOverlays) window._refreshSlotOverlays();
                }, 40);

                // --- REFRESH SLIDE SYSTEM ---
                const slides = findSlides(iDoc);
                totalSlides = slides.length || 1;
                buildDots();
                
                // Re-find and re-init the slide container (it might be a new DOM node after innerHTML replace)
                slideContainer = (slides.length > 0) ? slides[0].parentElement : iDoc.body;
                
                // Re-apply critical styles to new slide nodes
                slides.forEach(s => {
                    s.style.flex = `0 0 1122px`;
                    s.style.width = `1122px`;
                    s.style.height = '631px';
                    s.style.overflow = 'hidden';
                    s.style.position = 'relative';
                    s.style.boxSizing = 'border-box';
                });

                if (slideContainer) {
                    slideContainer.style.display = 'flex';
                    slideContainer.style.flexDirection = 'row';
                    slideContainer.style.width = 'max-content';
                    slideContainer.style.height = '100%';
                    slideContainer.style.margin = '0';
                    slideContainer.style.padding = '0';
                    slideContainer.style.transition = 'none'; // Instant jump for sync
                    
                    if (currentSlide >= totalSlides) currentSlide = totalSlides - 1;
                    if (currentSlide < 0) currentSlide = 0;
                    
                    // Don't restore slide position from entry. User doesn't want to move.
                    scrollToSlide(currentSlide);
                    
                    // Restore transition after reflow
                    setTimeout(() => {
                        if (slideContainer) slideContainer.style.transition = 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)';
                    }, 50);
                }

                updateSlideCounter();

                // Reposition labels to the new slot positions
                if (_refreshSlotOverlays) {
                    setTimeout(_refreshSlotOverlays, 100);
                    setTimeout(_refreshSlotOverlays, 400);
                }
            });
        }

        // Warn user before leaving with unsaved work (bug #7)
        window.onbeforeunload = (e) => {
            e.preventDefault();
            e.returnValue = '';
            return '';
        };

        // Fix #8: Recalculate iframe scale when the right tools panel changes width
        const toolsPanel = document.getElementById('editor-tools-panel');
        if (toolsPanel && window.ResizeObserver) {
            const panelResizeObs = new ResizeObserver(() => {
                requestAnimationFrame(() => scaleIframe());
            });
            panelResizeObs.observe(toolsPanel);
        }
    }

    window.regenerateDotsCount = function () {
        const iframeDoc = previewIframe.contentDocument || previewIframe.contentWindow.document;
        if (!iframeDoc) return;
        const slides = findSlides(iframeDoc);
        totalSlides = slides.length || 1;

        // Refresh slideContainer reference (it might have been replaced during Undo/Redo)
        slideContainer = (slides.length > 0) ? slides[0].parentElement : iframeDoc.body;

        if (slideContainer) {
            slideContainer.style.cssText += '; display:flex !important; flex-direction:row !important; width:max-content !important; height:100%; transition:transform 0.6s cubic-bezier(0.25,1,0.5,1); margin:0; padding:0;';
        }



        // Ensure new slides have the correct layout/scaling
        slides.forEach(s => {
            s.style.flex = `0 0 1122px`;
            s.style.width = `1122px`;
            s.style.height = '631px';
            s.style.overflow = 'hidden';
            s.style.position = 'relative';
            s.style.boxSizing = 'border-box';
        });

        buildDots();

        // Ensure currentSlide is within bounds before syncing classes
        if (currentSlide >= totalSlides) {
            currentSlide = totalSlides - 1;
        }
        if (currentSlide < 0) currentSlide = 0;

        // Force 'active' class to match currentSlide JS state
        slides.forEach((s, idx) => {
            if (idx === currentSlide) s.classList.add('active');
            else s.classList.remove('active');
        });

        scrollToSlide(currentSlide);
        updateSlideCounter();



        // Refresh overlays because new slides might have slots
        if (_refreshSlotOverlays) setTimeout(_refreshSlotOverlays, 50);
    };


    function scaleIframe() {
        // Measure from a static parent that doesn't collapse with scale to prevent loop
        const stage = document.querySelector('.preview-stage');
        const wrapper = document.querySelector('.preview-wrapper');
        const select = document.getElementById('canvas-zoom-select');

        if (!wrapper || !stage || !previewIframe) return;

        const iframeNativeWidth = 1122;
        const iframeNativeHeight = 631;

        let scale = 1;
        const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);

        if (isFullscreen) {
            // Use full window dimensions without padding
            const availableWidth = window.innerWidth;
            const availableHeight = window.innerHeight;
            const MathScaleX = availableWidth / iframeNativeWidth;
            const MathScaleY = availableHeight / iframeNativeHeight;
            scale = Math.min(MathScaleX, MathScaleY);
            // Allow scaling up past 100% in presentation mode
        } else if (select && select.value !== 'fit') {
            scale = parseFloat(select.value) || 1;
        } else {
            // Auto fit inside stage (it has 32px padding on all sides, but stage.clientWidth includes padding,
            // so we subtract 64px to ensure it perfectly fits inside the inner rect).
            const stageRect = stage.getBoundingClientRect();
            const availableWidth = stageRect.width - 64;
            const availableHeight = stageRect.height - 64;
            const MathScaleX = availableWidth / iframeNativeWidth;
            const MathScaleY = availableHeight / iframeNativeHeight;
            scale = Math.min(MathScaleX, MathScaleY);
            if (scale > 1) scale = 1; // Don't scale up past 100% by default
        }

        previewIframe.style.transform = `scale(${scale})`;
        wrapper.style.height = `${iframeNativeHeight * scale}px`;
        wrapper.style.width = `${iframeNativeWidth * scale}px`;

        // Inject scale into iframe for the visual editor's coordinate math
        try {
            const iframeWin = previewIframe.contentWindow;
            if (iframeWin) iframeWin._eidosIframeScale = scale;
        } catch (e) { }

        // Keep slot overlays aligned after scale change
        if (_refreshSlotOverlays) _refreshSlotOverlays();
    }

    let _buildOverlayForSlot = () => { }; // forward.. declaration, assigned inside injectImageReplacementSystem

    function injectImageReplacementSystem(doc, isRestoringFlow = false) {
        const style = doc.createElement('style');
        style.className = 'preview-injected-style';
        style.textContent = `
            html {
                overflow: hidden !important;
                margin: 0; padding: 0;
                width: 100%; height: 100%;
            }
            body {
                margin: 0; padding: 0;
                overflow: hidden;
            }
            /* Fix #3: prevent long text from breaking slide layout */
            section.s {
                position: relative !important;
                overflow: hidden;
            }
            section.s h1, section.s h2, section.s h3, section.s h4,
            section.s p, section.s span, section.s li, section.s blockquote {
                word-break: break-word;
                overflow-wrap: break-word;
                max-width: 100%;
                /* Removed overflow:hidden to prevent clipping of large fonts */
            }
            [data-image-slot] {
                cursor: pointer;
                transition: outline 0.2s ease;
            }
            [data-image-slot]::after {
                content: '';
                position: absolute;
                inset: 0;
                z-index: 5;
                background: linear-gradient(
                    115deg,
                    transparent 30%,
                    rgba(255, 255, 255, 0.08) 45%,
                    rgba(255, 255, 255, 0.15) 50%,
                    rgba(255, 255, 255, 0.08) 55%,
                    transparent 70%
                );
                background-size: 250% 100%;
                animation: slotGleam 20s ease-in-out infinite;
                pointer-events: none;
                border-radius: inherit;
            }
            [data-image-slot].has-custom-image::after {
                display: none;
            }
            @keyframes slotGleam {
                0%, 100% { background-position: 200% 0; }
                50% { background-position: -200% 0; }
            }
            [data-image-slot]:hover,
            [data-image-slot].is-hovered {
                outline: 2px dashed rgba(255,255,255,0.3);
                outline-offset: -2px;
            }
            .img-replace-overlay {
                position: absolute;
                inset: 0;
                z-index: 20;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 8px;
                background: rgba(0,0,0,0.3);
                opacity: 0.7;
                transition: all 0.25s ease;
                pointer-events: none;
                padding: 1rem;
                text-align: center;
            }
            /* Hide the large overlay when image is present, show only on hover then? */
            /* Or maybe just hide it completely if image is set, since we have the topbar replace btn */
            [data-image-slot].has-custom-image .img-replace-overlay {
                display: none !important;
            }

            [data-image-slot]:hover .img-replace-overlay,
            [data-image-slot].is-hovered .img-replace-overlay {
                opacity: 1;
                background: rgba(0,0,0,0.5);
            }
            .img-replace-overlay svg {
                width: 24px; height: 24px;
                stroke: white; fill: none; stroke-width: 1.5;
                opacity: 0.8;
            }
            .img-replace-overlay span {
                color: white; font-size: 13px;
                font-family: 'DM Sans', sans-serif;
                font-weight: 500;
                max-width: 140px;
                line-height: 1.3;
                text-shadow: 0 2px 4px rgba(0,0,0,0.3);
            }
            [data-image-slot].drag-over {
                outline: 3px solid var(--presentation-accent, #6366f1) !important;
                outline-offset: -3px;
            }
            body.eidos-locked .img-replace-overlay {
                display: none !important;
            }
            body.eidos-locked [data-image-slot]:hover,
            body.eidos-locked [data-image-slot].is-hovered {
                outline: none !important;
            }
        `;
        doc.head.appendChild(style);

        // ── Persistent parent-side label overlays ─────────────────────────────
        // WHY THIS APPROACH:
        //   • Clicks inside an iframe go to the iframe's document — NOT to the
        //     <iframe> element in the parent. So pointerdown on the iframe element
        //     never fires for inner-iframe clicks.
        //   • postMessage from iframe → parent is async → loses user activation →
        //     _picker.click() gets blocked by the browser.
        //   • SOLUTION: Place real <label>+<input type=file> elements in the PARENT
        //     document, permanently positioned over each slot's visual area.
        //     A click on the label (parent DOM) directly opens the picker — no
        //     focus handshake, no async, works on first click on desktop & mobile.

        // PERFORMANCE: If we are in a restore flow, we keep the existing DOM overlays
        // and just re-position them. The re-keying is handled before this call.
        if (!isRestoringFlow && !doc._eidosRestoringState) {
            // Remove any overlays from a previous session entirely
            document.querySelectorAll('._slot-overlay-label').forEach(el => el.remove());
            document.querySelectorAll('._slot-overlay-input').forEach(el => el.remove());
            _overlayMap.clear();
        }


        _buildOverlayForSlot = function (slotEl, existingInput = null) {
            if (_overlayMap.has(slotEl)) return; // already built

            // Mutable ref so re-keying after Ctrl+Z just updates .current
            // instead of recreating all event listeners
            const slotRef = { current: slotEl };
            const slotIdCode = slotEl.dataset.imageSlot ? slotEl.dataset.imageSlot.replace(/[^a-z0-9]/gi, '') : Math.random().toString(36).substr(2, 9);
            const inputId = `eidos-img-input-${slotIdCode}`;

            const input = existingInput || document.createElement('input');
            if (!existingInput) {
                input.className = 'preview-file-input';
                input.type = 'file';
                input.id = inputId;
                input.accept = 'image/*';
                input.setAttribute('aria-label', 'Upload image');
                input.style.cssText = 'position:fixed;top:-999px;left:-999px;opacity:0;width:1px;height:1px;pointer-events:none;';
                document.body.appendChild(input);

                input.addEventListener('change', (e) => {
                    if (e.target.files && e.target.files.length > 0) {
                        const iframeWin = previewIframe.contentWindow;
                        if (iframeWin && iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                        replaceSlotImage(slotRef.current, e.target.files[0]);
                    }
                    input.value = ''; // Clear the input so the same file can be selected again
                });
            }

            const label = document.createElement('label');
            label.htmlFor = inputId;
            label.className = '_slot-overlay-label';
            label.style.cssText = 'position:fixed;display:none;z-index:100000;cursor:pointer;background:transparent;pointer-events:none;';
            label.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                input.click();
            });

            // Hover sync via live ref
            label.addEventListener('mouseenter', () => slotRef.current.classList.add('is-hovered'));
            label.addEventListener('mouseleave', () => slotRef.current.classList.remove('is-hovered'));

            label.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                slotRef.current.classList.add('drag-over');
                label.style.outline = '2px dashed rgba(255,255,255,0.5)';
                label.style.outlineOffset = '-3px';
            });
            label.addEventListener('dragleave', (e) => {
                e.preventDefault();
                slotRef.current.classList.remove('drag-over');
                label.style.outline = '';
            });
            label.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                slotRef.current.classList.remove('drag-over');
                label.style.outline = '';
                _overlayMap.forEach(({ label: l }) => { l.style.pointerEvents = 'none'; });

                const files = e.dataTransfer.files;
                if (files && files.length > 0 && files[0].type.startsWith('image/')) {
                    const iframeWin = previewIframe.contentWindow;
                    if (iframeWin && iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                    replaceSlotImage(slotRef.current, files[0]);
                    return;
                }
                const imageUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
                if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
                    const iframeWin = previewIframe.contentWindow;
                    if (iframeWin && iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                    replaceSlotWithUrl(slotRef.current, imageUrl);
                }
            });

            document.body.appendChild(label);

            _overlayMap.set(slotEl, { input, label, slotRef });
        }

        function _ensureInternalOverlay(slot, doc) {
            let overlay = slot.querySelector('.img-replace-overlay');
            if (!overlay) {
                overlay = doc.createElement('div');
                overlay.className = 'img-replace-overlay';
                slot.appendChild(overlay);
                
                overlay.innerHTML = `
                    <div class="overlay-content" style="display:flex; flex-direction:column; align-items:center; gap:8px;">
                        <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                        <span>${window.__eidos_t('click_drop')}</span>
                    </div>
                `;
            }
        }
        window._ensureInternalOverlay = _ensureInternalOverlay; // Expose as global helper

        // Build overlays for ALL slots in the document
        const allSlots = doc.querySelectorAll('[data-image-slot]');
        allSlots.forEach(s => _buildOverlayForSlot(s));

        // Double-click on a slot opens the file picker.
        // We expose this as a global function so the editor can call it directly.
        window._eidosTriggerImagePicker = (slot) => {
            // Block if in fullscreen (presentation mode)
            if (document.fullscreenElement || document.webkitFullscreenElement) return;
            
            const entry = _overlayMap.get(slot);
            if (entry) entry.input.click();
        };

        if (doc._eidosDblClickListener) doc.removeEventListener('dblclick', doc._eidosDblClickListener);
        doc._eidosDblClickListener = (e) => {
            // Block if in fullscreen (presentation mode)
            if (document.fullscreenElement || document.webkitFullscreenElement) return;

            const slot = e.target.closest('[data-image-slot]');
            if (!slot) return;
            e.preventDefault();
            e.stopPropagation();
            window._eidosTriggerImagePicker(slot);
        };
        doc.addEventListener('dblclick', doc._eidosDblClickListener);


        // Remove old custom event listener to avoid confusion
        // Remove old custom event listener to avoid confusion
        if (doc._eidosTriggerListener) doc.removeEventListener('eidos-trigger-image-picker', doc._eidosTriggerListener);
        doc._eidosTriggerListener = (e) => {
            if (e.detail && e.detail.element) window._eidosTriggerImagePicker(e.detail.element);
        };
        doc.addEventListener('eidos-trigger-image-picker', doc._eidosTriggerListener);




        // Enable labels only while a file is being dragged. Reset on drop/dragleave.
        window.addEventListener('dragenter', () => {
            if (typeof pruneDeadSlotOverlays === 'function') pruneDeadSlotOverlays();
            _overlayMap.forEach(({ label }) => { label.style.pointerEvents = 'auto'; });
        });
        window.addEventListener('dragleave', (e) => {
            // Only reset when leaving the window entirely
            if (e.relatedTarget == null) {
                _overlayMap.forEach(({ label }) => { label.style.pointerEvents = 'none'; });
            }
        });
        window.addEventListener('drop', () => {
            _overlayMap.forEach(({ label }) => { label.style.pointerEvents = 'none'; });
        });

        window.addEventListener('eidos-drop-complete', () => {
            _overlayMap.forEach(({ label }) => { label.style.pointerEvents = 'none'; });
        });

        function pruneDeadSlotOverlays() {
            const iDoc = previewIframe.contentDocument;
            _overlayMap.forEach((entry, slotEl) => {
                if (!iDoc || !iDoc.contains(slotEl)) {
                    entry.label.remove();
                    entry.input.remove();
                    _overlayMap.delete(slotEl);
                }
            });
        }
        window._pruneDeadSlotOverlays = pruneDeadSlotOverlays; // Expose for internal use


        // Position overlays for the slots on the CURRENT slide, hide others
        function _positionOverlays() {
            const iDoc = previewIframe.contentDocument;
            if (!iDoc || !iDoc.defaultView) return;
            const matrix = new DOMMatrix(getComputedStyle(previewIframe).transform);
            const scale = matrix.a || 1;
            const fr = previewIframe.getBoundingClientRect();

            // iDoc.defaultView.innerWidth is the "native" viewport width of the iframe
            const viewW = iDoc.defaultView.innerWidth;
            const viewH = iDoc.defaultView.innerHeight;

            _overlayMap.forEach(({ label }, slotEl) => {
                const r = slotEl.getBoundingClientRect(); // iframe-internal coords

                // Resilience: Check if slot is actually visible in the iframe viewport
                // We allow a small buffer for precision
                const isVisible = r.width > 0 && r.height > 0 &&
                    r.left < viewW - 1 &&
                    r.right > 1 &&
                    r.top < viewH - 1 &&
                    r.bottom > 1;

                if (!isVisible) {
                    label.style.display = 'none';
                    return;
                }

                // Show and position
                label.style.display = 'block';
                label.style.left = (fr.left + r.left * scale) + 'px';
                label.style.top = (fr.top + r.top * scale) + 'px';
                label.style.width = (r.width * scale) + 'px';
                label.style.height = (r.height * scale) + 'px';
            });
        }

        // Expose so scrollToSlide and scaleIframe can call it
        _refreshSlotOverlays = _positionOverlays;
        window._refreshSlotOverlays = _positionOverlays;
        window._buildOverlayForSlot = _buildOverlayForSlot;

        // Message handler is no longer needed since overlays handle everything directly
        if (window._slotMsgHandler) {
            window.removeEventListener('message', window._slotMsgHandler);
            window._slotMsgHandler = null;
        }
        // ──────────────────────────────────────────────────────────────────────


        const slots = doc.querySelectorAll('[data-image-slot], .img-slot');
        slots.forEach(slot => {
            const slotId = slot.dataset.imageSlot;

            // Ensure it has data-image-slot for consistency if it's an .img-slot
            if (!slot.dataset.imageSlot) {
                slot.dataset.imageSlot = 'gen-' + Math.random().toString(36).substr(2, 9);
            }

            // Hide decorative shapes (circles/blobs) — keep gradient overlays
            Array.from(slot.children).forEach(child => {
                const s = child.style;
                if (s.width && s.width !== '100%' && s.height && s.height !== '100%' && s.borderRadius === '50%') {
                    child.style.display = 'none';
                }
            });

            // For full-bleed slots (cover slides): the slot is a background layer.
            // Siblings render ON TOP (z-index:2) and have pointer-events:none so
            // the parent-side label overlay still shows above everything and
            // the user can always click/tap to pick an image.
            const computedPos = doc.defaultView.getComputedStyle(slot).position;
            const isFullBleed = computedPos === 'absolute' &&
                slot.parentElement && slot.parentElement.tagName === 'SECTION';
            if (isFullBleed) {
                Array.from(slot.parentElement.children).forEach(child => {
                    if (child !== slot) {
                        child.style.zIndex = '2'; // text renders above background image
                    }
                });
                slot.style.zIndex = '0';
            }
            // Note: pointer-events on siblings are left as-is — the parent label
            // overlay (z-index:200) handles all click routing.

            // "Click or drop image" tooltip
            _ensureInternalOverlay(slot, doc);

            // Drag & drop (works directly, no scaling issue)
            slot.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                slot.classList.add('drag-over');
            });
            slot.addEventListener('dragleave', (e) => {
                e.preventDefault();
                slot.classList.remove('drag-over');
            });
            slot.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                slot.classList.remove('drag-over');

                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0];
                    if (file.type.startsWith('image/')) {
                        replaceSlotImage(slot, file);
                        return;
                    }
                }
                const imageUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
                if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
                    replaceSlotWithUrl(slot, imageUrl);
                }
            });
        });

        // Prevent browser default drag-and-drop navigation inside the iframe.
        // Without this, dropping a file anywhere on the iframe navigates it to the file URL.
        doc.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
        doc.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Handle dropping images onto the slide (NOT onto a slot)
            const slot = e.target.closest('[data-image-slot]');
            if (slot) return; // handled by slot listener

            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                if (file.type.startsWith('image/')) {
                    // Position it where dropped
                    const rect = doc.documentElement.getBoundingClientRect();
                    const x = e.clientX;
                    const y = e.clientY;
                    
                    // Trigger a custom event to the parent to handle adding a new image at these coords
                    window.parent.dispatchEvent(new CustomEvent('eidos-add-image-at', {
                        detail: { 
                            file: file,
                            x: x, 
                            y: y 
                        }
                    }));
                }
            }
        });

        // Initial positioning after all slots are set up
        // (done after multiple delays to account for carousel transition, font loading, etc.)
        setTimeout(_positionOverlays, 100);
        setTimeout(_positionOverlays, 500);
        setTimeout(_positionOverlays, 1500);
    }


    function replaceSlotImage(slot, file) {
        const reader = new FileReader();
        reader.onload = (e) => applyImageToSlot(slot, e.target.result);
        reader.readAsDataURL(file);
    }

    function replaceSlotWithUrl(slot, url) {
        applyImageToSlot(slot, url);
    }

    function applyImageToSlot(slot, imageDataOrUrl) {
        // Hide all gradient/decorative child divs — they're just placeholders
        const decorativeDivs = Array.from(slot.querySelectorAll(':scope > div')).filter(c =>
            !c.classList.contains('img-replace-overlay') && c.tagName !== 'INPUT'
        );
        decorativeDivs.forEach(d => d.style.display = 'none');

        // Apply image directly on the slot container
        slot.style.backgroundImage = `url('${imageDataOrUrl}')`;
        slot.style.backgroundSize = 'cover';
        slot.style.backgroundPosition = 'center';

        slot.classList.add('has-custom-image');

        // z-index and pointer-events for full-bleed slots are set once in
        // injectImageReplacementSystem and never need to change on image apply.
        // Siblings stay at z-index:2 / pointer-events:none permanently so text
        // is always visible and clicks always reach the slot for re-picking.
    }

    // =========================================================
    // 8. SLIDE NAVIGATION
    // =========================================================
    function scrollToSlide(index) {
        const iframeDoc = previewIframe.contentDocument || previewIframe.contentWindow.document;
        if (!iframeDoc || !iframeDoc.body) return;

        const slides = findSlides(iframeDoc);
        const container = slideContainer || iframeDoc.body;
        if (slides[index]) {
            const iframeWin = previewIframe.contentWindow;
            const slideWidthPx = previewIframe._slideWidthPx
                || (iframeWin && iframeWin.innerWidth > 0 ? iframeWin.innerWidth : 0)
                || 1122; // Hard fallback for high-fidelity consistency
            container.style.transform = `translateX(-${index * slideWidthPx}px)`;
            slides.forEach(s => s.classList.remove('active'));
            slides[index].classList.add('active');
            currentSlide = index;
            window.eidosCurrentSlide = index; // Expose globally for the editor iframe
            updateSlideCounter();
            // Reposition overlays for the new active slide
            if (_refreshSlotOverlays) setTimeout(_refreshSlotOverlays, 50);
        }
    }
    
    // Global navigation helpers for editor and other modules
    let _lastNavScroll = 0;
    const NAV_COOLDOWN = 350; // ms to Wait between slide transitions to prevent skipping

    function tryNavigate(targetIndex) {
        if (Date.now() - _lastNavScroll < NAV_COOLDOWN) return false;
        if (targetIndex < 0 || targetIndex >= totalSlides) return false;
        
        _lastNavScroll = Date.now();
        scrollToSlide(targetIndex);
        return true;
    }

    window.eidosScrollToSlide = scrollToSlide;
    window.eidosPrevSlide = () => tryNavigate(currentSlide - 1);
    window.eidosNextSlide = () => tryNavigate(currentSlide + 1);
    window.eidosGetCurrentSlide = () => currentSlide;
    window.eidosGetTotalSlides = () => totalSlides;

    function buildDots() {
        slideDots.innerHTML = '';
        for (let i = 0; i < totalSlides; i++) {
            const dot = document.createElement('button');
            dot.className = 'slide-dot' + (i === 0 ? ' active' : '');
            dot.setAttribute('aria-label', `Slide ${i + 1}`);
            dot.addEventListener('click', () => scrollToSlide(i));
            slideDots.appendChild(dot);
        }
    }

    function updateSlideCounter() {
        const dots = slideDots.querySelectorAll('.slide-dot');
        dots.forEach((d, i) => {
            d.classList.toggle('active', i === currentSlide);
        });
        const tpl = window.__eidos_t("slide_label_tpl", "Slide {current} of {total}");
        slideLabel.textContent = tpl.replace('{current}', currentSlide + 1).replace('{total}', totalSlides);
    }

    function updateMinimapSkeleton(count) {
        const minimapList = document.getElementById('minimap-list');
        if (!minimapList) return;

        let currentCount = minimapList.querySelectorAll('.minimap-item').length;
        if (currentCount === count) return;

        if (count < currentCount || currentCount === 0) {
            minimapList.innerHTML = '';
            currentCount = 0;
        }

        for (let i = currentCount; i < count; i++) {
            const item = document.createElement('div');
            item.className = 'minimap-item skeleton' + (i === count - 1 ? ' active' : '');

            const thumb = document.createElement('div');
            thumb.className = 'minimap-thumb-skeleton';

            const num = document.createElement('div');
            num.className = 'minimap-item-number';
            num.textContent = i + 1;

            item.appendChild(thumb);
            item.appendChild(num);
            minimapList.appendChild(item);
        }

        const items = minimapList.querySelectorAll('.minimap-item');
        items.forEach((it, idx) => {
            it.classList.toggle('active', idx === count - 1);
        });

        const minimapContainer = document.getElementById('editor-minimap');
        if (minimapContainer && items.length > 0) {
            const panelHeight = minimapContainer.clientHeight;
            const activeIdx = count - 1;

            // Fixed ITEM_HEIGHT matching layout space: 94.25 (item+border) + 6 (margin) = 100.25
            const ITEM_HEIGHT = 100.25;

            // Centering logic with 20px extra compensation for the list's padding-top
            const offset = (panelHeight / 2) - (activeIdx * ITEM_HEIGHT) - (ITEM_HEIGHT / 2) - 20;

            // Fast transition during streaming to match preview
            minimapList.style.transition = 'transform 0.8s cubic-bezier(0.25, 1, 0.5, 1)';
            minimapList.style.transform = `translateY(${offset}px)`;
        }
    }



    // Keyboard arrow navigation for slides
    function handleSlideKeyboardNav(e) {
        if (previewContainer.classList.contains('hidden')) return;
        // Don't capture arrows when user is typing in an input/textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

        // Skip if editor has a selected element
        try {
            const iframe = document.getElementById('preview-iframe');
            const iframeWin = iframe.contentWindow;
            if (iframeWin && iframeWin.eidosGetSelection && iframeWin.eidosGetSelection()) {
                // If an element is selected, let the editor handle arrows (moving elements)
                return;
            }
        } catch (err) { }

        if (e.key === 'ArrowLeft') {
            if (tryNavigate(currentSlide - 1)) e.preventDefault();
        } else if (e.key === 'ArrowRight') {
            if (tryNavigate(currentSlide + 1)) e.preventDefault();
        }
    }
    // Global keyboard shortcut forwarding to the editor iframe
    // This ensures Ctrl+C, Ctrl+V, and Ctrl+D work even if focus is on parent UI (header, minimap)
    function handleGlobalShortcuts(e) {
        if (previewContainer.classList.contains('hidden')) return;
        
        // Skip if user is typing in a real input/textarea in the parent
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        // Skip if in fullscreen (presentation mode)
        if (document.fullscreenElement || document.webkitFullscreenElement) return;

        if (e.ctrlKey || e.metaKey) {
            const key = e.key.toLowerCase();
            if (key === 'c' || key === 'v' || key === 'd' || key === 'x' || key === 'z' || key === 'y') {
                try {
                    const iframe = document.getElementById('preview-iframe');
                    const iframeWin = iframe.contentWindow;
                    
                    // Check if an element is selected in the editor
                    if (iframeWin && iframeWin.eidosGetSelection && iframeWin.eidosGetSelection()) {
                        // Forward the event to the iframe
                        const event = new KeyboardEvent('keydown', {
                            key: e.key,
                            ctrlKey: e.ctrlKey,
                            metaKey: e.metaKey,
                            shiftKey: e.shiftKey,
                            altKey: e.altKey,
                            bubbles: true
                        });
                        iframeWin.dispatchEvent(event);
                        
                        // Prevent the default parent action (like Ctrl+D bookmarking or Ctrl+C copying empty parent)
                        e.preventDefault();
                    }
                } catch (err) {
                    console.error("Error forwarding shortcut to iframe:", err);
                }
            }
        }
    }
    document.addEventListener('keydown', handleGlobalShortcuts, true); // useCapture to intercept before others

    document.addEventListener('keydown', handleSlideKeyboardNav);

    // Mouse wheel navigation for slides
    let wheelCooldown = false;
    function handleSlideWheelNav(e) {
        if (previewContainer.classList.contains('hidden')) return;
        if (wheelCooldown) return;

        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            if (e.deltaY > 0) {
                tryNavigate(currentSlide + 1);
            } else if (e.deltaY < 0) {
                tryNavigate(currentSlide - 1);
            }
        } else {
            if (e.deltaX > 0) {
                tryNavigate(currentSlide + 1);
            } else if (e.deltaX < 0) {
                tryNavigate(currentSlide - 1);
            }
        }
    }
    document.addEventListener('wheel', handleSlideWheelNav, { passive: true });

    // Mobile Swipe Support
    let touchStartX = 0;
    let touchEndX = 0;

    function handleTouchStart(e) {
        touchStartX = e.changedTouches[0].screenX;
    }

    function handleTouchEnd(e) {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }

    function handleSwipe() {
        const threshold = 50;
        if (touchEndX < touchStartX - threshold) {
            // Swipe Left -> Next
            if (currentSlide < totalSlides - 1) scrollToSlide(currentSlide + 1);
        } else if (touchEndX > touchStartX + threshold) {
            // Swipe Right -> Prev
            if (currentSlide > 0) scrollToSlide(currentSlide - 1);
        }
    }

    // =========================================================
    // 9. FINALIZE — Download PDF
    // =========================================================
    finalizeBtn.addEventListener('click', async () => {
        finalizeBtn.disabled = true;
        finalizeBtn.classList.add('loading');

        const progressFill = finalizeBtn.querySelector('.btn-progress-fill');
        if (progressFill) progressFill.style.width = '0%';

        let progress = 0;
        const progressInterval = setInterval(() => {
            progress += (90 - progress) * 0.1;
            if (progressFill) progressFill.style.width = `${progress}%`;
        }, 300);

        try {
            const iframeDoc = previewIframe.contentDocument || previewIframe.contentWindow.document;
            const clone = iframeDoc.documentElement.cloneNode(true);

            const injectedStyles = clone.querySelectorAll('.preview-injected-style');
            injectedStyles.forEach(s => s.remove());

            const skeletonInjectors = clone.querySelectorAll('.skeleton-injector');
            skeletonInjectors.forEach(s => s.remove());

            const tempSkel = clone.querySelector('#temp-skeleton');
            if (tempSkel) tempSkel.remove();

            const overlays = clone.querySelectorAll('.img-replace-overlay');
            overlays.forEach(o => o.remove());

            const fileInputs = clone.querySelectorAll('.preview-file-input');
            fileInputs.forEach(f => f.remove());

            const slides = clone.querySelectorAll('section');
            slides.forEach(s => {
                s.classList.remove('active');
                // Remove inline carousel styles added by preview
                s.style.flex = '';
                s.style.width = '';
                s.style.height = '';
                s.style.overflow = '';
                s.style.position = '';
                s.style.boxSizing = '';
            });

            // Clean up all ancestor containers that might have carousel styles
            const cloneBody = clone.querySelector('body');
            if (cloneBody) {
                cloneBody.style.transform = '';
                cloneBody.style.display = '';
                cloneBody.style.flexDirection = '';
                cloneBody.style.transition = '';
                cloneBody.style.width = '';
                cloneBody.style.margin = '';
                cloneBody.style.padding = '';
                cloneBody.style.overflow = '';
            }

            // Also clean up any wrapper element (e.g. <main>) between body and sections
            if (slides.length > 0) {
                const wrapper = slides[0].parentElement;
                if (wrapper && wrapper !== cloneBody) {
                    wrapper.style.transform = '';
                    wrapper.style.display = '';
                    wrapper.style.flexDirection = '';
                    wrapper.style.transition = '';
                    wrapper.style.width = '';
                    wrapper.style.margin = '';
                    wrapper.style.padding = '';
                }
            }

            const finalHtml = '<!DOCTYPE html>' + clone.outerHTML;

            const response = await fetch('/finalize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ html: finalHtml, title: currentTitle })
            });

            const data = await response.json();

            if (response.ok && data.pdfUrl) {
                if (progressFill) progressFill.style.width = '100%';

                const link = document.createElement('a');
                link.href = data.pdfUrl;
                link.setAttribute('download', '');
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } else {
                throw new Error(data.error || 'Error generating PDF');
            }

        } catch (error) {
            previewContainer.classList.add('hidden');
            errorMessage.textContent = error.message;
            errorContainer.classList.remove('hidden');
        } finally {
            clearInterval(progressInterval);
            setTimeout(() => {
                finalizeBtn.disabled = false;
                finalizeBtn.classList.remove('loading');
                if (progressFill) progressFill.style.width = '0%';
            }, 500);
        }
    });

    // =========================================================
    // 10. RESET
    // =========================================================
    function resetUI() {
        // Show chat again
        if (resultContainer) resultContainer.classList.add('hidden');
        if (errorContainer) errorContainer.classList.add('hidden');
        if (refusedContainer) refusedContainer.classList.add('hidden');
        if (previewContainer) previewContainer.classList.add('hidden');
        if (chatScreen) chatScreen.classList.remove('hidden');
        if (scrollySection) {
            scrollySection.classList.remove('hidden');
            window.dispatchEvent(new Event('resize'));
            if (window._eidosScrollytelling) window._eidosScrollytelling.resetScrollTriggers();
        }

        currentSlide = 0;
        totalSlides = 0;
        generatedHtml = '';
        slideContainer = null;
        _refreshSlotOverlays = null;
        // Remove persistent slot overlays from previous presentation
        document.querySelectorAll('._slot-overlay-label').forEach(el => el.remove());
        document.querySelectorAll('._slot-overlay-input').forEach(el => el.remove());
        slideDots.innerHTML = '';
        progressBarEl.style.transition = 'none';
        progressBarEl.style.width = '0%';

        // restart typewriter if empty
        if (document.getElementById('w-tema').value.trim() === '') {
            if (chatPlaceholderContainer) chatPlaceholderContainer.style.display = '';
            startTypewriter();
        }
    }

    resetBtn.addEventListener('click', resetUI);
    backBtn.addEventListener('click', resetUI);
    previewResetBtn.addEventListener('click', resetUI);
    document.getElementById('refused-back-btn').addEventListener('click', resetUI);

    // =========================================================
    // 11. LANDING SCROLLYTELLING (THREE.JS CINEMATIC)
    // =========================================================
    class ThreeScrollytelling {
        constructor() {
            this.container = document.getElementById('scrolly-canvas-container');
            if (!this.container) return;

            this.scene = new THREE.Scene();
            this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
            this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this.container.appendChild(this.renderer.domElement);

            this.clock = new THREE.Clock();
            this.initLights();
            this.initObjects();
            this.initLenis();
            this.initScrollTrigger();
            this.animate();

            window.addEventListener('resize', () => this.onResize());
        }

        initLights() {
            const ambient = new THREE.AmbientLight(0xffffff, 0.5);
            this.scene.add(ambient);

            this.pointLight = new THREE.PointLight(0xffffff, 2);
            this.pointLight.position.set(5, 5, 5);
            this.scene.add(this.pointLight);

            const blueLight = new THREE.PointLight(0x3b82f6, 10, 20);
            blueLight.position.set(-5, -2, 2);
            this.scene.add(blueLight);
        }

        initObjects() {
            // Step 1: Neural Core (Icosahedron with Wireframe)
            this.coreGroup = new THREE.Group(); // GSAP-controllable (scroll rotation)
            this.idleGroup = new THREE.Group(); // Loop-controllable (constant rotation)
            this.coreGroup.add(this.idleGroup);
            
            const coreGeom = new THREE.IcosahedronGeometry(2, 2);
            const coreMat = new THREE.MeshStandardMaterial({ 
                color: 0xffffff, 
                wireframe: true,
                transparent: true,
                opacity: 1
            });
            this.coreMesh = new THREE.Mesh(coreGeom, coreMat);
            this.idleGroup.add(this.coreMesh);

            const innerGeom = new THREE.IcosahedronGeometry(1.2, 1);
            const innerMat = new THREE.MeshStandardMaterial({ 
                color: 0xffffff, 
                emissive: 0xffffff,
                emissiveIntensity: 0.5,
                transparent: true,
                opacity: 1
            });
            this.innerCore = new THREE.Mesh(innerGeom, innerMat);
            this.idleGroup.add(this.innerCore);

            this.scene.add(this.coreGroup);

            // Step 2 & 3: Particles / Crystals (InstancedMesh for performance)
            this.particleCount = 500;
            const partGeom = new THREE.SphereGeometry(0.04, 8, 8);
            const partMat = new THREE.MeshStandardMaterial({ 
                color: 0xffffff,
                transparent: true,
                opacity: 0
            });
            this.particles = new THREE.InstancedMesh(partGeom, partMat, this.particleCount);
            
            this.dummy = new THREE.Object3D();
            this.initialPositions = new Float32Array(this.particleCount * 3);
            for (let i = 0; i < this.particleCount; i++) {
                const x = (Math.random() - 0.5) * 20;
                const y = (Math.random() - 0.5) * 20;
                const z = (Math.random() - 0.5) * 20;
                this.initialPositions[i * 3] = x;
                this.initialPositions[i * 3 + 1] = y;
                this.initialPositions[i * 3 + 2] = z;

                this.dummy.position.set(x, y, z);
                this.dummy.updateMatrix();
                this.particles.setMatrixAt(i, this.dummy.matrix);
            }
            this.particles.instanceMatrix.needsUpdate = true;
            this.particles.visible = false;
            this.scene.add(this.particles);

            this.camera.position.z = 10;
        }

        initLenis() {
            this._createLenis();
        }

        _createLenis() {
            // Limpia instancia anterior
            if (this._lenisTickerFn) {
                gsap.ticker.remove(this._lenisTickerFn);
                this._lenisTickerFn = null;
            }
            if (this.lenis) {
                this.lenis.destroy();
                this.lenis = null;
                window._eidosLenis = null;
            }

            if (typeof Lenis === 'undefined') return;

            this.lenis = new Lenis({
                duration: 1.2,
                easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
                orientation: 'vertical',
                smoothWheel: true,
            });
            window._eidosLenis = this.lenis;

            // INTEGRACIÓN OFICIAL: Lenis tickea con GSAP, no con rAF manual
            // Sin esto, Lenis y ScrollTrigger corren desincronizados → el "querer regresar"
            this.lenis.on('scroll', () => {
                if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.update();
            });

            this._lenisTickerFn = (time) => {
                if (this.lenis) this.lenis.raf(time * 1000);
            };
            gsap.ticker.add(this._lenisTickerFn);
            gsap.ticker.lagSmoothing(0); // evita que GSAP acelere para compensar lag
        }

        initScrollTrigger() {
            gsap.registerPlugin(ScrollTrigger);
            
            // Estabilizar scroll para evitar conflictos con smooth scrolling
            ScrollTrigger.normalizeScroll(true);
            ScrollTrigger.config({ ignoreMobileResize: true });

            const steps = gsap.utils.toArray('.narrative-step');
            const sections = steps.length;
            const sectionSelector = '.scrolly-three-section';

            // Global container height based on steps
            gsap.set(sectionSelector, { height: (sections * 100) + "vh" });

            // Global container fade in
            gsap.to(this.container, {
                opacity: 1,
                scrollTrigger: {
                    trigger: sectionSelector,
                    start: "top 80%",
                    end: "top 20%",
                    scrub: true
                }
            });

            // Master Timeline (Synced with Scroll)
            const tl = gsap.timeline({
                scrollTrigger: {
                    trigger: sectionSelector,
                    start: "top top",
                    end: "bottom bottom",
                    scrub: 1,
                    onUpdate: (self) => {
                        const prog = self.progress * 100;
                        document.querySelector('.v-fill').style.height = prog + '%';
                        const activeIdx = Math.min(Math.floor(self.progress * sections), sections - 1);
                        document.querySelectorAll('.v-numbers span').forEach((n, i) => {
                            n.classList.toggle('active', i === activeIdx);
                        });
                    }
                }
            });

            // Camera & Object Animation Timeline (Synchronized to avoid pauses)
            tl.fromTo(this.camera.position, { x: 0, y: 0, z: 10 }, { z: 5, duration: 2.5, ease: "power2.inOut" }, 0)
              .to(this.coreGroup.rotation, { y: Math.PI * 4, duration: 6, ease: "none" }, 0)
              .to(this.coreGroup.scale, { x: 8, y: 8, z: 8, duration: 3, ease: "power2.in" }, 1.5)
              .to([this.coreMesh.material, this.innerCore.material], { opacity: 0, duration: 2 }, 2)
              .to(this.particles, { visible: true }, 1.5)
              .to(this.particles.material, { opacity: 1, duration: 2.5, ease: "power2.inOut" }, 1.5)
              .to(this.camera.position, { y: 2, z: 18, duration: 3.5, ease: "power2.inOut" }, 2.5);

            // Total Duration is now 6 (approx)
            const totalDur = 6;

            // Narrative Steps Transitions (Sequence to avoid overlap + Distinct animations)
            const stepDuration = totalDur / sections;
            
            steps.forEach((step, i) => {
                const content = step.querySelector('.step-content');
                const startTime = i * stepDuration;
                
                // Varied Animation Styles per Step
                let entranceVars = { opacity: 1, duration: 1.2, ease: "power2.inOut" };
                let exitVars = { opacity: 0, duration: 1.2, ease: "power2.inOut" };

                if (i === 0) { // Step 1: Horizontal Slide
                    gsap.set(content, { x: -100, opacity: 0 });
                    entranceVars.x = 0;
                    exitVars.x = 50;
                } else if (i === 1) { // Step 2: Zoom & Blur
                    gsap.set(content, { scale: 0.8, filter: "blur(10px)", opacity: 0 });
                    entranceVars.scale = 1;
                    entranceVars.filter = "blur(0px)";
                    exitVars.scale = 1.2;
                    exitVars.filter = "blur(15px)";
                } else if (i === 2) { // Step 3: 3D Tilt
                    gsap.set(content, { rotateY: 30, x: 100, opacity: 0 });
                    entranceVars.rotateY = 0;
                    entranceVars.x = 0;
                    exitVars.rotateY = -30;
                    exitVars.x = -100;
                } else { // Step 4: Vertical Reveal
                    gsap.set(content, { y: 100, opacity: 0 });
                    entranceVars.y = 0;
                }

                // Add Entrance to Timeline
                tl.to(content, entranceVars, startTime);

                // Add Exit (Except for the last step)
                // Overlap exit with next entrance to avoid "cuts"
                if (i < sections - 1) {
                    tl.to(content, exitVars, startTime + stepDuration - 0.5);
                }
            });
        }

        resetScrollTriggers() {
            if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.getAll().forEach(st => st.kill());
            if (typeof gsap !== 'undefined') {
                gsap.killTweensOf([
                    this.camera.position, this.coreGroup.rotation, this.coreGroup.scale,
                    this.coreMesh.material, this.innerCore.material,
                    this.particles.material, this.particles,
                ]);
                gsap.set(this.camera.position, { x: 0, y: 0, z: 10 });
                gsap.set(this.coreGroup.rotation, { y: 0 });
                gsap.set(this.coreGroup.scale, { x: 1, y: 1, z: 1 });
                gsap.set([this.coreMesh.material, this.innerCore.material], { opacity: 1 });
                gsap.set(this.particles.material, { opacity: 0 });
            }
            if (this.particles) this.particles.visible = false;

            // Destruye Lenis (también remueve del ticker de GSAP)
            this._createLenis(); // destroy + recreate limpio

            window.scrollTo(0, 0);
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;

            // Espera 2 frames para que el browser procese scrollY = 0
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    this.initScrollTrigger();
                    if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh();
                });
            });
        }

        pauseForPreview() {
            if (this._lenisTickerFn) {
                gsap.ticker.remove(this._lenisTickerFn);
                this._lenisTickerFn = null;
            }
            if (this.lenis) this.lenis.stop();
        }

        onResize() {
            const width = window.innerWidth;
            const height = window.innerHeight;
            
            // Solo redimensionar si el ancho cambia significativamente 
            // (evita tirones por barra de direcciones en móvil)
            if (this._lastW === width && Math.abs(this._lastH - height) < 100) return;
            this._lastW = width;
            this._lastH = height;

            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(width, height);
            
            // Refrescar ScrollTrigger con un pequeño delay para asegurar layout estable
            clearTimeout(this._refreshT);
            this._refreshT = setTimeout(() => {
                ScrollTrigger.refresh();
            }, 200);
        }

        animate() {
            requestAnimationFrame(() => this.animate());
            const time = this.clock.getElapsedTime();

            if (this.idleGroup) {
                this.idleGroup.rotation.y += 0.004; // Gentle idle spin
                this.coreGroup.position.y = Math.sin(time) * 0.15; // Hover effect on parent
            }

            if (this.particles && this.particles.visible) {
                for(let i=0; i<this.particleCount; i++) {
                    const x = this.initialPositions[i*3];
                    const y = this.initialPositions[i*3+1];
                    const z = this.initialPositions[i*3+2];
                    
                    this.dummy.position.set(
                        x + Math.sin(time * 0.4 + i) * 0.15,
                        y + Math.cos(time * 0.3 + i) * 0.15,
                        z + Math.sin(time * 0.5 + i) * 0.15
                    );
                    this.dummy.rotation.x += 0.005;
                    this.dummy.rotation.y += 0.005;
                    this.dummy.updateMatrix();
                    this.particles.setMatrixAt(i, this.dummy.matrix);
                }
                this.particles.instanceMatrix.needsUpdate = true;
            }

            this.renderer.render(this.scene, this.camera);
        }
    }

    function initLandingScrollytelling() {
        window._eidosScrollytelling = new ThreeScrollytelling();
    }

    initLandingScrollytelling();

    // =========================================================
    // DESELECT ON CLICK OUTSIDE PREVIEW
    // =========================================================
    document.addEventListener('mousedown', (e) => {
        // Only act if preview is visible
        if (previewContainer && !previewContainer.classList.contains('hidden')) {
            // If not clicking inside the iframe itself
            if (e.target !== previewIframe) {
                // And not clicking on editor UI elements (tools, minimap, header)
                const isEditorInteraction = 
                    e.target.closest('#editor-tools-panel') || 
                    e.target.closest('#editor-minimap') || 
                    e.target.closest('.preview-unified-header') ||
                    e.target.closest('._slot-overlay-label');

                if (!isEditorInteraction) {
                    try {
                        if (previewIframe && previewIframe.contentWindow && previewIframe.contentWindow.eidosDeselect) {
                            previewIframe.contentWindow.eidosDeselect();
                        }
                    } catch (err) { }
                }
            }
        }
    });

    // Global helper for chips
    window.fillInput = (keyOrText) => {
        const input = document.getElementById('w-tema');
        if (input) {
            // Use translation if key exists, otherwise use as literal
            const translated = (typeof window.__eidos_t === 'function') 
                ? window.__eidos_t(keyOrText) 
                : keyOrText;
            input.value = translated;
            input.focus();
            input.dispatchEvent(new Event('input'));
        }
    };

    // Prevent wheel propagation for data-lenis-prevent elements
    document.addEventListener('wheel', (e) => {
        const target = e.target.closest('[data-lenis-prevent]');
        if (target) {
            e.stopPropagation();
        }
    }, { capture: false, passive: true });

    // Scroll is now native; no custom scroll-loop system
});
