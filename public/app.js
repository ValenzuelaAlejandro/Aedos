document.addEventListener('DOMContentLoaded', () => {
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

    // Preview elements
    let previewIframe = document.getElementById('preview-iframe');
    const prevSlideBtn = document.getElementById('prev-slide');
    const nextSlideBtn = document.getElementById('next-slide');
    const slideDots = document.getElementById('slide-dots');
    const slideLabel = document.getElementById('slide-label');
    const previewHeader = document.querySelector('.preview-unified-header');
    const finalizeBtn = document.getElementById('finalize-btn');
    const previewResetBtn = document.getElementById('preview-reset-btn');
    const progressBarEl = document.getElementById('loading-progress-bar');

    // State
    let currentSlide = 0;
    let totalSlides = 0;
    let generatedHtml = '';
    let slideContainer = null; // The actual parent element of the slides (may be body or a wrapper)
    let currentTitle = 'Presentation';

    // Listen for messages from iframe during skeleton generation
    window.addEventListener('message', (e) => {
        if (!e.data) return;
        if (e.data.type === 'slideUpdate') {
            const count = e.data.count;
            if (slideLabel) {
                slideLabel.textContent = `${count} / ${count}`;
            }

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

    // =========================================================
    // I18N SUPPORT
    // =========================================================
    const userLang = navigator.language || navigator.userLanguage;
    const isSpanish = userLang.toLowerCase().includes('es');

    const i18n = {
        es: {
            "t-app-subtitle": "Genera una presentación completa sobre...",
            "t-app-microcopy": "8–12 slides &middot; Contenido estructurado &middot; Listo para descargar en PDF",
            "tema-error": "Por favor, ingresa un tema para generar tu presentación.",
            "t-btn-edit-topic": "Editar",
            "t-btn-regenerate": "Regenerar",
            "t-finalize-text": "Descargar PDF",
            "t-reset-text": "Nuevo",
            "t-result-title": "¡Tu presentación está lista!",
            "result-subtitle": "Las diapositivas sobre tu tema han sido generadas.",
            "t-download-text": "Descargar PDF",
            "reset-btn": "Generar otra presentación",
            "t-error-title": "Algo no salió como esperábamos",
            "t-error-subtitle": "El servicio de IA no está disponible temporalmente. Suele resolverse rápido.",
            "t-error-saturated": "El servicio está saturado en este momento debido a la alta demanda. Por favor, intenta de nuevo en unos minutos.",
            "t-error-summary": "Detalles técnicos",
            "back-btn": "Intentar de nuevo",
            "t-refused-title": "Este tema no puede ser generado",
            "t-refused-subtitle": "La IA se ha negado a crear esta presentación por motivos de seguridad.",
            "refused-back-btn": "Intentar un tema distinto",
            "loading-text": "Dando forma a tus ideas…",

            // Dynamic texts
            "generating": "Generando presentación...",
            "slide_label": "{current} / {total}",
            "click_drop": "Haz clic o arrastra una imagen",
            "refused_msg": "Este tema no puede ser generado."
        }
    };

    function t(key, defaultText) {
        if (!isSpanish) return defaultText;
        return i18n.es[key] || defaultText;
    }

    if (isSpanish) {
        for (const [id, text] of Object.entries(i18n.es)) {
            const el = document.getElementById(id);
            if (el) el.innerHTML = text;
        }
    }

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

    const topics = isSpanish ? topicsEs : topicsEn;

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
    const sendIcon = document.getElementById('btn-icon-send');
    const loaderIcon = document.getElementById('btn-icon-loader');

    function toggleGenerateLoading(isLoading) {
        if (isLoading) {
            temaInput.disabled = true;
            generateBtn.disabled = true;
            if (sendIcon) sendIcon.classList.add('hidden');
            if (loaderIcon) loaderIcon.classList.remove('hidden');
            stopTypewriter();
        } else {
            temaInput.disabled = false;
            generateBtn.disabled = temaInput.value.trim().length < 4;
            if (sendIcon) sendIcon.classList.remove('hidden');
            if (loaderIcon) loaderIcon.classList.add('hidden');
            if (typewriterCursor) typewriterCursor.style.display = '';
            if (temaInput.value.trim() && chatPlaceholderContainer) {
                chatPlaceholderContainer.style.display = 'none';
            }

            if (temaInput.value.trim() === '' && !typewriterRunning) {
                startTypewriter();
            }
        }
    }

    async function handleGenerate(regenerateTema = null) {
        const tema = regenerateTema || temaInput.value.trim();
        if (!tema) {
            temaError.classList.add('visible');
            temaInput.focus();
            return;
        }
        temaError.classList.remove('visible');

        const requestData = {
            tema: tema,
            subtitulo: '',
            numSlides: 8,
            densidad: 'Balanced',
            colorPrimario: '#6366f1',
            institution: '',
            members: '',
            teacher: '',
            date: '',
            contenidoUsuario: ''
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


        // Hide chatScreen when loading
        chatScreen.classList.add('hidden');
        previewHeader.classList.remove('slide-down');
        previewContainer.classList.remove('hidden');

        // Scale iframe immediately so the skeleton doesn't overflow/look zoomed in
        scaleIframe();
        window.addEventListener('resize', scaleIframe);

        // Reset the iframe completely by injecting a fresh DOM node
        const rawIframe = previewIframe.cloneNode();
        previewIframe.parentNode.replaceChild(rawIframe, previewIframe);
        previewIframe = rawIframe;

        const iframeDoc = previewIframe.contentDocument || previewIframe.contentWindow.document;
        iframeDoc.open();
        const loadingMsg = isSpanish ? "Cargando estructura de la presentación..." : "Loading presentation structure...";
        const loadingHtml = `
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
        `;

        // Wait for the AI's first chunk with a loading screen
        iframeDoc.write(loadingHtml);

        // Immediately update preview label
        const previewLabel = document.getElementById('preview-topic-label');
        if (previewLabel) previewLabel.textContent = tema;


        slideLabel.textContent = "1 / 1";
        if (slideDots) slideDots.innerHTML = '';

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
                buffer = lines.pop(); // keep the incomplete line in buffer

                for (let line of lines) {
                    if (line.startsWith('data: ')) {
                        let dataStr = line.substring(6);
                        if (dataStr.trim() === '[DONE]') continue;
                        let parsed;
                        try { parsed = JSON.parse(dataStr); } catch (e) { continue; }

                        if (parsed.chunk) {
                            if (firstWrite) {
                                iframeDoc.open(); // Reset the backdrop style
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
                                ${loadingHtml}
                                <script class="skeleton-injector">
                                    document.documentElement.classList.add('skeleton-active');
                                    let skelLastCount = 0;
                                    let sentTitle = false;
                                    const skelObs = new MutationObserver(() => {
                                        if (!document.documentElement.classList.contains('skeleton-active')) return;
                                        
                                        // Attempt to find title
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
                            refusedMessage.textContent = parsed.message || (isSpanish ? "Este tema no puede ser generado." : "This topic cannot be generated.");
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
                            // Fallback to <title> or <h1>
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

                            if (previewLabel) previewLabel.textContent = `[ ${displayTitle} ]`;
                            currentTitle = displayTitle;
                        }
                    }
                }
            }

            if (!generatedHtml || generatedHtml.trim().length < 50) {
                // If it finished but we have no HTML, it's an error unless refused was already handled
                throw new Error(isSpanish ? "Lo sentimos, no se pudo generar la presentación. El servicio podría estar saturado." : "Sorry, could not generate the presentation. The service might be saturated.");
            }

            iframeDoc.close();
            initPreview(generatedHtml);

        } catch (error) {
            console.error(error);

            const errSubtitle = document.getElementById('t-error-subtitle');

            // Try to extract "Please retry in X seconds"
            let retryMsg = "";
            const retryMatch = error.message.match(/retry in ([\d\.]+s)/i);
            if (retryMatch) {
                retryMsg = isSpanish ? `<br><br><strong>Podrás reintentar en: ${retryMatch[1]}</strong>` : `<br><br><strong>You can retry in: ${retryMatch[1]}</strong>`;
            }

            if (error.message.includes('429') || error.message.includes('503') || error.message.toLowerCase().includes('exhausted') || error.message.toLowerCase().includes('saturated')) {
                if (errSubtitle) {
                    errSubtitle.innerHTML = t('t-error-saturated', "El servicio está saturado en este momento debido a la alta demanda. Por favor, intenta de nuevo en unos minutos.") + retryMsg;
                }
            } else {
                if (errSubtitle) {
                    errSubtitle.textContent = t('t-error-subtitle', "The AI service is temporarily unavailable. This is usually resolved quickly.");
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

    // Preview actions (Edit / Regenerate / Back)
    const btnBackToChat = document.getElementById('btn-back-to-chat');
    if (btnBackToChat) {
        btnBackToChat.addEventListener('click', () => {
            previewContainer.classList.add('hidden');
            chatScreen.classList.remove('hidden');
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

    // =========================================================
    // 7. PREVIEW SYSTEM
    // =========================================================
    function initPreview(html) {
        currentSlide = 0;
        let setupDone = false;

        const doSetup = () => {
            if (setupDone) return;
            setupDone = true;
            setupPreviewInteractions();
        };

        // Set onload BEFORE writing so we don't miss the event
        previewIframe.onload = () => setTimeout(doSetup, 50);

        // Fallback: poll until slides appear in the DOM (handles slow CDN)
        let attempts = 0;
        const poll = () => {
            if (setupDone) return;
            attempts++;
            const doc = previewIframe.contentDocument;
            if (doc && doc.body) {
                const found = findSlides(doc);
                if (found.length > 1) {
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
        if (slides.length > 1) return slides;

        // Strategy 2: sections with class containing "slide"
        slides = doc.querySelectorAll('section[class*="slide"]');
        if (slides.length > 1) return slides;

        // Strategy 3: leaf sections (sections that don't contain other sections)
        const allSections = Array.from(doc.querySelectorAll('section'));
        const leafSections = allSections.filter(s => !s.querySelector('section'));
        if (leafSections.length > 1) return leafSections;
        if (allSections.length > 1) return allSections;

        // Strategy 4: divs with slide-like classes
        slides = doc.querySelectorAll('div.s, div.slide, div[class*="slide"]');
        if (slides.length > 1) return slides;

        // Strategy 5: direct body children (excluding script/style/link)
        const bodyKids = Array.from(doc.body.children).filter(el =>
            !['SCRIPT', 'STYLE', 'LINK', 'META'].includes(el.tagName)
        );
        if (bodyKids.length > 1) return bodyKids;

        // Strategy 6: single wrapper — get ITS children
        if (bodyKids.length === 1) {
            const inner = Array.from(bodyKids[0].children).filter(el =>
                !['SCRIPT', 'STYLE', 'LINK'].includes(el.tagName)
            );
            if (inner.length > 1) return inner;
        }

        return slides; // fallback to whatever last matched
    }

    function setupPreviewInteractions() {
        const iframeDoc = previewIframe.contentDocument || previewIframe.contentWindow.document;
        if (!iframeDoc || !iframeDoc.body) return;

        const slides = findSlides(iframeDoc);
        totalSlides = slides.length || 1;
        buildDots();

        // Attach global nav listeners directly to the iframe document too!
        // This solves the issue where file input dialog steals focus to the iframe.
        iframeDoc.addEventListener('keydown', handleSlideKeyboardNav);
        iframeDoc.addEventListener('wheel', handleSlideWheelNav, { passive: true });

        // Problem 6: Touch events for mobile swipe
        iframeDoc.addEventListener('touchstart', handleTouchStart, { passive: true });
        iframeDoc.addEventListener('touchend', handleTouchEnd, { passive: true });


        // Determine the container that holds the slides (could be body or a wrapper like <main>)
        slideContainer = (slides.length > 0) ? slides[0].parentElement : iframeDoc.body;

        injectImageReplacementSystem(iframeDoc);

        // Apply horizontal carousel layout to the real slide container
        slideContainer.style.cssText += '; display:flex !important; flex-direction:row !important; width:max-content !important; height:100%; transition:transform 0.6s cubic-bezier(0.25,1,0.5,1); margin:0; padding:0;';

        // Ensure each slide fills the viewport
        slides.forEach(s => {
            s.style.flex = '0 0 100vw';
            s.style.width = '100vw';
            s.style.height = '100vh';
            s.style.overflow = 'hidden';
            s.style.position = 'relative';
            s.style.boxSizing = 'border-box';
        });

        // If slides are inside a wrapper (not direct body children), make sure body doesn't clip
        if (slideContainer !== iframeDoc.body) {
            iframeDoc.body.style.margin = '0';
            iframeDoc.body.style.padding = '0';
            iframeDoc.body.style.overflow = 'hidden';
        }

        scrollToSlide(0);
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
    }

    function scaleIframe() {
        const wrapper = document.querySelector('.preview-wrapper');
        if (!wrapper) return;
        const wrapperWidth = wrapper.clientWidth;
        const iframeNativeWidth = 297 * 3.7795275591;
        const scale = wrapperWidth / iframeNativeWidth;
        previewIframe.style.transform = `scale(${scale})`;
        const iframeNativeHeight = 167 * 3.7795275591;
        wrapper.style.height = `${iframeNativeHeight * scale}px`;
    }

    function injectImageReplacementSystem(doc) {
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
            [data-image-slot] {
                cursor: pointer;
                transition: outline 0.2s ease;
                position: relative;
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
            [data-image-slot]:hover {
                outline: 2px dashed rgba(255,255,255,0.3);
                outline-offset: -2px;
            }
            .img-replace-overlay {
                position: absolute;
                bottom: 10px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 15;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                padding: 5px 14px;
                background: rgba(0,0,0,0.6);
                backdrop-filter: blur(8px);
                border-radius: 20px;
                opacity: 0;
                transition: opacity 0.25s ease;
                pointer-events: none;
                white-space: nowrap;
            }
            [data-image-slot]:hover .img-replace-overlay {
                opacity: 1;
            }
            .img-replace-overlay svg {
                width: 14px; height: 14px;
                stroke: white; fill: none; stroke-width: 1.5;
            }
            .img-replace-overlay span {
                color: white; font-size: 11px;
                font-family: 'DM Sans', sans-serif;
            }
            [data-image-slot].drag-over {
                outline: 3px solid #6366f1 !important;
                outline-offset: -3px;
            }
        `;
        doc.head.appendChild(style);

        const slots = doc.querySelectorAll('[data-image-slot]');
        slots.forEach(slot => {
            // Hide decorative shapes (circles, blobs) but keep gradient overlays
            Array.from(slot.children).forEach(child => {
                if (child.classList.contains('img-replace-overlay') || child.classList.contains('preview-file-input')) return;
                const s = child.style;
                // If it has explicit pixel dimensions (not inset:0), it's a shape — hide it
                if (s.width && s.width !== '100%' && s.height && s.height !== '100%' && s.borderRadius === '50%') {
                    child.style.display = 'none';
                }
            });

            const overlay = doc.createElement('div');
            overlay.className = 'img-replace-overlay';
            overlay.innerHTML = `
                <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                <span>${t('click_drop', 'Click or drop image')}</span>
            `;
            slot.appendChild(overlay);

            const fileInput = doc.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*';
            fileInput.className = 'preview-file-input';
            fileInput.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; z-index: 20; border: none; padding: 0; margin: 0; display: block;';
            slot.appendChild(fileInput);

            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) replaceSlotImage(slot, file);
                // Refocus parent window so keyboard arrows keep working
                window.focus();
            });

            // Also refocus when file dialog is cancelled
            fileInput.addEventListener('click', () => {
                const refocus = () => { window.focus(); };
                window.addEventListener('focus', refocus, { once: true });
            });

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
            container.style.transform = `translateX(-${index * 100}vw)`;
            slides.forEach(s => s.classList.remove('active'));
            slides[index].classList.add('active');
            currentSlide = index;
            updateSlideCounter();
        }
    }

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
        const tpl = t("slide_label", "Slide {current} of {total}");
        slideLabel.textContent = tpl.replace('{current}', currentSlide + 1).replace('{total}', totalSlides);
        prevSlideBtn.disabled = currentSlide <= 0;
        nextSlideBtn.disabled = currentSlide >= totalSlides - 1;
    }

    prevSlideBtn.addEventListener('click', () => {
        if (currentSlide > 0) scrollToSlide(currentSlide - 1);
    });

    nextSlideBtn.addEventListener('click', () => {
        if (currentSlide < totalSlides - 1) scrollToSlide(currentSlide + 1);
    });

    // Keyboard arrow navigation for slides
    function handleSlideKeyboardNav(e) {
        if (previewContainer.classList.contains('hidden')) return;
        // Don't capture arrows when user is typing in an input/textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            if (currentSlide > 0) scrollToSlide(currentSlide - 1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            if (currentSlide < totalSlides - 1) scrollToSlide(currentSlide + 1);
        }
    }
    document.addEventListener('keydown', handleSlideKeyboardNav);

    // Mouse wheel navigation for slides
    let wheelCooldown = false;
    function handleSlideWheelNav(e) {
        if (previewContainer.classList.contains('hidden')) return;
        if (wheelCooldown) return;

        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            if (e.deltaY > 0) {
                if (currentSlide < totalSlides - 1) {
                    scrollToSlide(currentSlide + 1);
                    wheelCooldown = true;
                    setTimeout(() => { wheelCooldown = false; }, 400);
                }
            } else if (e.deltaY < 0) {
                if (currentSlide > 0) {
                    scrollToSlide(currentSlide - 1);
                    wheelCooldown = true;
                    setTimeout(() => { wheelCooldown = false; }, 400);
                }
            }
        } else {
            if (e.deltaX > 0) {
                if (currentSlide < totalSlides - 1) {
                    scrollToSlide(currentSlide + 1);
                    wheelCooldown = true;
                    setTimeout(() => { wheelCooldown = false; }, 400);
                }
            } else if (e.deltaX < 0) {
                if (currentSlide > 0) {
                    scrollToSlide(currentSlide - 1);
                    wheelCooldown = true;
                    setTimeout(() => { wheelCooldown = false; }, 400);
                }
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

        currentSlide = 0;
        totalSlides = 0;
        generatedHtml = '';
        slideContainer = null;
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

});
