function sanitizeModelOutput(html) {
    if (typeof html !== 'string') return html;
    // Strip ALL inline script blocks from AI-generated content.
    // External scripts (<script src="...">) are allowed through but subject to CSP script-src.
    html = html.replace(/<script[^>]*>(\s*)<\/script>/gi, '$1'); // keep empty external wrappers
    html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ''); // strip scripts with content
    html = html.replace(/<script[^>]*>/gi, ''); // strip unclosed opening tags
    html = html.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
    html = html.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '');
    html = html.replace(/\s+(href|src|action)\s*=\s*["']javascript:[^"']*["']/gi, '');
    // Fix malformed font <link> tags where AI writes href="url('https://...')" instead of href="https://..."
    html = html.replace(
        /<link([^>]*)href\s*=\s*(["'])url\s*\(\s*['"]?(https?[^'")\s]+)['"]?\s*\)\s*\2([^>]*)>/gi,
        '<link$1href="$3"$4>'
    );
    return html;
}

/**
 * Converts a File to a data URL, snapshotting the first frame if it's a GIF.
 * Returns a Promise<string> with a JPEG data URL (PNG for non-GIF).
 */
function gifToStaticDataUrl(file) {
    if (!file.type.includes('gif')) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(file);
        });
    }
    // GIF: draw the first frame onto a canvas and export as JPEG
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width  = img.naturalWidth  || img.width;
            canvas.height = img.naturalHeight || img.height;
            canvas.getContext('2d').drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', 0.9));
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            // Fallback: plain FileReader
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(file);
        };
        img.src = url;
    });
}

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

    // Called once the first slide is visible in the skeleton — set by handleGenerate
    let _pendingTransitionFn = null;

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

            // Trigger chat→preview transition on the first real slide
            if (_pendingTransitionFn) {
                const fn = _pendingTransitionFn;
                _pendingTransitionFn = null;
                fn();
            }

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
    // HERO MESSAGE (RANDOM ON LOAD)
    // =========================================================
    const heroTitle = document.querySelector('.hero-title-single');
    const heroMessageKeys = Array.from({ length: 20 }, (_, i) => `hero_msg_${i + 1}`);

    window.__eidos_applyRandomHeroMessage = function () {
        if (!heroTitle) return;
        const heroMessages = heroMessageKeys
            .map((key) => {
                const resolved = (typeof window.__eidos_t === 'function') ? window.__eidos_t(key) : key;
                return resolved === key ? null : resolved;
            })
            .filter(Boolean);
        if (!heroMessages.length) return;
        const randomIndex = Math.floor(Math.random() * heroMessages.length);
        heroTitle.innerHTML = heroMessages[randomIndex];
    };

    window.__eidos_applyRandomHeroMessage();

    // =========================================================
    // TOP PANEL CONTROLS (THEME + LANGUAGE)
    // =========================================================
    (function setupTopPanelControls() {
        const root = document.documentElement;
        const themeToggleBtn = document.getElementById('theme-toggle-btn');
        const previewThemeToggleBtn = document.getElementById('preview-theme-toggle-btn');
        const langSelect = document.getElementById('lang-select');

        function applyInputPlaceholder(lang) {
            const input = document.getElementById('w-tema');
            if (!input) return;
            input.placeholder = lang === 'es'
                ? 'Escribe el tema de tu presentacion...'
                : 'Describe your presentation topic...';
        }

        function applyTheme(theme) {
            const nextTheme = theme === 'light' ? 'light' : 'dark';
            root.setAttribute('data-theme', nextTheme);
            localStorage.setItem('eidos_theme', nextTheme);
            const title = (typeof window.__eidos_t === 'function')
                ? window.__eidos_t('theme_toggle')
                : 'Toggle theme';
            if (themeToggleBtn) {
                themeToggleBtn.title = title;
                themeToggleBtn.setAttribute('aria-label', title);
            }
            if (previewThemeToggleBtn) {
                previewThemeToggleBtn.title = title;
                previewThemeToggleBtn.setAttribute('aria-label', title);
            }
            // Propagate theme into live preview iframe (if present)
            try {
                const doc = previewIframe && (previewIframe.contentDocument || (previewIframe.contentWindow && previewIframe.contentWindow.document));
                if (doc && doc.documentElement) {
                    doc.documentElement.setAttribute('data-theme', nextTheme);
                }
            } catch (e) {
                // ignore cross-origin or not-yet-ready iframe
            }
        }

        function applyLang(lang) {
            const nextLang = lang === 'es' ? 'es' : 'en';
            if (typeof window.__eidos_setLang === 'function') {
                window.__eidos_setLang(nextLang);
            }
            applyInputPlaceholder(nextLang);
            localStorage.setItem('eidos_lang', nextLang);
            if (langSelect && langSelect.value !== nextLang) {
                langSelect.value = nextLang;
            }
            if (typeof window.__eidos_applyRandomHeroMessage === 'function') {
                window.__eidos_applyRandomHeroMessage();
            }
        }

        const savedTheme = localStorage.getItem('eidos_theme') || 'dark';
        const savedLang = localStorage.getItem('eidos_lang') || window.currentLang || 'en';

        applyTheme(savedTheme);
        applyLang(savedLang);

        if (themeToggleBtn) {
            themeToggleBtn.addEventListener('click', () => {
                const current = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
                applyTheme(current === 'light' ? 'dark' : 'light');
            });
        }
        if (previewThemeToggleBtn) {
            previewThemeToggleBtn.addEventListener('click', () => {
                const current = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
                applyTheme(current === 'light' ? 'dark' : 'light');
            });
        }

        if (langSelect) {
            langSelect.addEventListener('change', (e) => {
                applyLang(e.target.value);
            });
        }
    })();

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }

    // =========================================================
    // MOUSE PHYSICS (HERO + PROMPT CARDS)
    // =========================================================
    (function setupMousePhysics() {
        const physicsTargets = [
            document.querySelector('.hero-title-single')
        ].filter(Boolean);

        if (!physicsTargets.length) return;

        const cfg = {
            radius: 180,
            force: 0.38,
            spring: 0.12,
            damping: 0.83,
            maxOffset: 12
        };

        const states = physicsTargets.map((el) => ({ el, x: 0, y: 0, vx: 0, vy: 0 }));
        const pointer = { x: 0, y: 0, active: false };
        let rafId = 0;

        function clamp(v, min, max) {
            return Math.max(min, Math.min(max, v));
        }

        function tick() {
            let keepRunning = false;

            states.forEach((s) => {
                const r = s.el.getBoundingClientRect();
                const cx = r.left + r.width * 0.5;
                const cy = r.top + r.height * 0.5;

                if (pointer.active) {
                    const dx = cx - pointer.x;
                    const dy = cy - pointer.y;
                    const dist = Math.hypot(dx, dy) || 1;
                    if (dist < cfg.radius) {
                        const push = (1 - dist / cfg.radius) * cfg.force;
                        s.vx += (dx / dist) * push;
                        s.vy += (dy / dist) * push;
                    }
                }

                // Spring back to origin + damping for soft physical feel
                s.vx += -s.x * cfg.spring;
                s.vy += -s.y * cfg.spring;
                s.vx *= cfg.damping;
                s.vy *= cfg.damping;

                s.x = clamp(s.x + s.vx, -cfg.maxOffset, cfg.maxOffset);
                s.y = clamp(s.y + s.vy, -cfg.maxOffset, cfg.maxOffset);

                s.el.style.transform = `translate3d(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px, 0)`;

                const energy = Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.vx) + Math.abs(s.vy);
                if (energy > 0.03 || pointer.active) keepRunning = true;
            });

            if (keepRunning) {
                rafId = requestAnimationFrame(tick);
            } else {
                rafId = 0;
            }
        }

        function scheduleTick() {
            if (!rafId) rafId = requestAnimationFrame(tick);
        }

        window.addEventListener('pointermove', (e) => {
            pointer.x = e.clientX;
            pointer.y = e.clientY;
            pointer.active = true;
            scheduleTick();
        }, { passive: true });

        window.addEventListener('pointerleave', () => {
            pointer.active = false;
            scheduleTick();
        });

        // Start in a settled state and wake up only on interaction
        scheduleTick();
    })();

    // =========================================================
    // STARTER CAROUSEL LOOP (SEAMLESS)
    // =========================================================
    (function setupStarterCarousel() {
        const carousel = document.querySelector('.starter-carousel');
        const track = document.getElementById('starter-track');
        if (!carousel || !track || track.dataset.cloned === '1') return;

        const originals = Array.from(track.children);
        if (!originals.length) return;

        originals.forEach((node) => {
            const clone = node.cloneNode(true);
            clone.setAttribute('aria-hidden', 'true');
            clone.tabIndex = -1;
            track.appendChild(clone);
        });

        // We drive the carousel with JS so speed can change on hover without visual jumps.
        track.style.animation = 'none';

        let loopWidth = 0;
        let offset = 0;
        let lastTs = 0;
        let currentSpeed = 58; // px/s
        let targetSpeed = 58;  // px/s

        function measureLoopWidth() {
            loopWidth = track.scrollWidth / 2;
            if (!Number.isFinite(loopWidth) || loopWidth <= 0) {
                loopWidth = 1;
            }
            offset = offset % loopWidth;
        }

        function tick(ts) {
            if (!lastTs) lastTs = ts;
            const dt = Math.min(64, ts - lastTs) / 1000;
            lastTs = ts;

            // Smooth easing between normal and slow hover speed.
            const easing = Math.min(1, dt * 7.5);
            currentSpeed += (targetSpeed - currentSpeed) * easing;

            offset += currentSpeed * dt;
            if (offset >= loopWidth) offset -= loopWidth;
            track.style.transform = `translate3d(${-offset.toFixed(2)}px, 0, 0)`;

            requestAnimationFrame(tick);
        }

        carousel.addEventListener('pointerenter', () => {
            targetSpeed = 12;
        });

        carousel.addEventListener('pointerleave', () => {
            targetSpeed = 58;
        });

        // Keep hover highlight pinned to the card under the pointer.
        let activeHoverCard = null;
        carousel.addEventListener('pointermove', (e) => {
            const card = e.target.closest('.starter-card');
            if (card === activeHoverCard) return;
            if (activeHoverCard) activeHoverCard.classList.remove('is-hovered');
            activeHoverCard = card;
            if (activeHoverCard) activeHoverCard.classList.add('is-hovered');
        });

        carousel.addEventListener('pointerleave', () => {
            if (activeHoverCard) activeHoverCard.classList.remove('is-hovered');
            activeHoverCard = null;
        });

        window.addEventListener('resize', measureLoopWidth);

        measureLoopWidth();
        requestAnimationFrame(tick);
        track.dataset.cloned = '1';
    })();


    // =========================================================
    // INPUT PLACEHOLDER (NATIVE)
    // =========================================================
    const typewriterCursor = null;
    const chatPlaceholderContainer = null;
    let typewriterRunning = false;
    function startTypewriter() {}
    function stopTypewriter() {}

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

        // Scroll to top if user starts typing while scrolled down
        if (window.scrollY > 200) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
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

    // ── Button cycling message state ──────────────────────────────────────
    const BTN_LOADING_KEYS = [
        'gen_loading_1', 'gen_loading_2', 'gen_loading_3', 'gen_loading_4',
        'gen_loading_5', 'gen_loading_6', 'gen_loading_7', 'gen_loading_8',
        'gen_loading_9', 'gen_loading_final'
    ];
    let _btnMsgTimer = null;
    let _btnMsgIndex = 0;

    function _scheduleNextBtnMsg() {
        if (_btnMsgIndex >= BTN_LOADING_KEYS.length - 1) return;
        _btnMsgTimer = setTimeout(() => {
            _btnMsgIndex++;
            const label = generateBtn.querySelector('.btn-generate-label');
            if (label) label.textContent = window.__eidos_t(BTN_LOADING_KEYS[_btnMsgIndex]);
            _scheduleNextBtnMsg();
        }, 1900);
    }

    function startBtnMessages() {
        _btnMsgIndex = 0;
        _btnMsgTimer = null;
        const label = generateBtn.querySelector('.btn-generate-label');
        if (label) label.textContent = window.__eidos_t(BTN_LOADING_KEYS[0]);
        _scheduleNextBtnMsg();
    }

    function pauseBtnMessages() {
        if (_btnMsgTimer) { clearTimeout(_btnMsgTimer); _btnMsgTimer = null; }
    }

    function resumeBtnMessages() {
        if (!_btnMsgTimer) _scheduleNextBtnMsg();
    }

    function stopBtnMessages() {
        pauseBtnMessages();
        _btnMsgIndex = 0;
        const label = generateBtn.querySelector('.btn-generate-label');
        if (label) label.textContent = window.__eidos_t('generate_presentation', 'Generate presentation');
    }
    // ─────────────────────────────────────────────────────────────────────

    function toggleGenerateLoading(isLoading) {
        const editorControls = [
            ...Array.from(document.querySelectorAll('.preview-unified-header button, .preview-unified-header select, .preview-unified-header input')),
            ...Array.from(document.querySelectorAll('#editor-tools-panel button, #editor-tools-panel select, #editor-tools-panel input, #editor-minimap button'))
        ];

        if (isLoading) {
            temaInput.disabled = true;
            generateBtn.disabled = true;
            if (sendIcon) sendIcon.classList.add('hidden');
            if (loaderIcon) loaderIcon.classList.remove('hidden');
            stopTypewriter();
            startBtnMessages();

            // Disable editor buttons/controls during generation
            editorControls.forEach(ctrl => { if (ctrl) ctrl.disabled = true; });
        } else {
            temaInput.disabled = false;
            generateBtn.disabled = temaInput.value.trim().length < 4;
            if (sendIcon) sendIcon.classList.remove('hidden');
            if (loaderIcon) loaderIcon.classList.add('hidden');
            if (typewriterCursor) typewriterCursor.style.display = '';
            stopBtnMessages();

            // Enable editor buttons/controls after generation (or error)
            editorControls.forEach(ctrl => { if (ctrl) ctrl.disabled = false; });

            // Native textarea placeholder handles empty state.
        }
    }

    async function handleGenerate(regenerateTema = null, isRegenerating = false) {
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

        // If regenerating: immediately ensure panels are visible — strip every class
        // that could be hiding them, regardless of what previous animation cycle left behind.
        if (isRegenerating) {
            previewContainer.classList.remove('is-generating', 'reveal-sequence', 'reveal-minimap', 'reveal-tools');
        }

        toggleGenerateLoading(true);

        window.removeEventListener('resize', scaleIframe); // evita acumulación

        // Transition: called once on first AI chunk, slides from chat → live skeleton
        let _hasTransitioned = false;
        function doTransitionToPreview() {
            if (_hasTransitioned) return;
            _hasTransitioned = true;
            stopBtnMessages();
            // Fade chat screen out (it's covered by fixed preview-container, but still clean)
            chatScreen.style.cssText = 'opacity:0;transition:opacity 0.35s ease;pointer-events:none;';
            setTimeout(() => {
                chatScreen.classList.add('hidden');
                chatScreen.style.cssText = '';
            }, 380);
            // Reveal preview (sectionFadeIn animation kicks in automatically)
            previewHeader.classList.remove('slide-down');
            previewContainer.classList.remove('hidden', 'reveal-chrome', 'reveal-sequence', 'reveal-minimap', 'reveal-tools');
            previewContainer.classList.add('is-generating');
            document.body.classList.add('no-scroll');
            requestAnimationFrame(() => scaleIframe());
            window.addEventListener('resize', scaleIframe);
        }

        // Reset the iframe completely by injecting a fresh DOM node
        minimapAlreadyInit = false;
        toolsAlreadyInit = false;
        const rawIframe = previewIframe.cloneNode();
        previewIframe.parentNode.replaceChild(rawIframe, previewIframe);
        previewIframe = rawIframe;

        // Clear Minimap and Dots
        const minimapList = document.getElementById('minimap-list');
        if (minimapList) {
            minimapList.innerHTML = '';
            minimapList.style.transform = 'none'; // Reset scrolling
            const mmContainer = document.getElementById('editor-minimap');
            if (mmContainer) {
                mmContainer.style.removeProperty('--presentation-accent');
                mmContainer.style.removeProperty('--accent');
            }
        }
        if (slideDots) slideDots.innerHTML = '';

        const iframeDoc = previewIframe.contentDocument || previewIframe.contentWindow.document;
        const G_FONTS = `
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap" rel="stylesheet">`;
        const loadingHtml = `
        ${G_FONTS}
        <style class="skeleton-injector">
            body { background: #121212; margin: 0; padding: 0; }
        </style>
        <link rel="stylesheet" href="editor.css?v=3">
        <script src="editor.js?v=3"></script>
        `;

        // Immediately update preview label
        const previewLabel = document.getElementById('preview-topic-label');
        if (previewLabel) {
            if (previewLabel.tagName === 'INPUT') previewLabel.value = tema;
            else previewLabel.textContent = tema;
        }


        slideLabel.textContent = "1 / 1";
        updateMinimapSkeleton(1);

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

                        if (parsed.queued === true) {
                            pauseBtnMessages();
                            const label = generateBtn.querySelector('.btn-generate-label');
                            if (label) {
                                const msg = window.__eidos_t("queued_position", "Waiting in queue — position {pos}");
                                label.textContent = msg.replace('{pos}', parsed.position);
                            }
                            continue;
                        }
                        if (parsed.queued === false) {
                            resumeBtnMessages();
                            continue;
                        }

                        if (parsed.chunk) {
                            if (firstWrite) {
                                firstWrite = false;
                                // Schedule chat→preview transition only when coming from the chat screen
                                if (!isRegenerating) {
                                    _pendingTransitionFn = doTransitionToPreview;
                                }
                                iframeDoc.open();
                                const skelStyle = `
                                <style class="skeleton-injector">
                                    html {
                                        overflow-x: auto !important;
                                        overflow-y: hidden !important;
                                        scroll-behavior: smooth !important;
                                    }
                                    html body {
                                        display: flex !important;
                                        flex-direction: row !important;
                                        width: max-content !important;
                                        height: 100vh !important;
                                        margin: 0 !important;
                                        padding: 0 !important;
                                    }
                                    html section.s, html section[class*="slide"] {
                                        flex: 0 0 100vw !important;
                                        width: 100vw !important;
                                        height: 100vh !important;
                                        overflow: hidden !important;
                                        box-sizing: border-box !important;
                                        margin: 0 !important;
                                    }
                                    html ::-webkit-scrollbar { display: none !important; }
                                </style>
                                ${G_FONTS}
                                ${loadingHtml}
                                <script src="/features/skeleton/skeleton-injector.js"></script>
                                `;
                                // Write our trusted skeleton markup directly (no sanitization needed).
                                // Only AI chunks go through sanitizeModelOutput.
                                iframeDoc.write(skelStyle);
                            }
                            iframeDoc.write(sanitizeModelOutput(parsed.chunk));
                        }
                        if (parsed.refused) {
                            _pendingTransitionFn = null;
                            chatScreen.style.cssText = '';
                            chatScreen.classList.remove('hidden');
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
                            if (parsed.chunk) iframeDoc.write(sanitizeModelOutput(parsed.chunk));
                            if (parsed.done && parsed.html) generatedHtml = parsed.html;
                        } catch (e) { }
                    }
                }
            }

            if (!generatedHtml || generatedHtml.trim().length < 50) {
                throw new Error("Sorry, could not generate the presentation correctly.");
            }

            iframeDoc.close();

            // Fix malformed <link href="url('...')"> that may have slipped through per-chunk
            // sanitization (the tag could be split across two chunks). Uses DOM manipulation
            // since the document is already live at this point.
            try {
                if (iframeDoc && iframeDoc.querySelectorAll) {
                    iframeDoc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
                        const raw = link.getAttribute('href') || '';
                        const m = raw.match(/^url\s*\(\s*['"']?(https?[^'"')\s]+)['"']?\s*\)/i);
                        if (m) link.href = m[1];
                    });
                }
            } catch (e) { /* cross-origin guard */ }

            // --- FLICKER GATE: Fade out shortly before final reload ---
            const stage = document.getElementById('preview-stage');
            if (stage) stage.classList.add('flicker-mask');
            const minimapPanel = document.getElementById('editor-minimap');
            if (minimapPanel) minimapPanel.classList.add('flicker-mask');

            // Wait a tiny bit for the fade to start
            await new Promise(r => setTimeout(r, 100));

            // Re-clone at the end to match Debug mode's working behavior and ensure editor.js runs in a clean window
            minimapAlreadyInit = false;
            toolsAlreadyInit = false;
            const rawIframe = previewIframe.cloneNode();
            previewIframe.parentNode.replaceChild(rawIframe, previewIframe);
            previewIframe = rawIframe;

            initPreview(generatedHtml, () => {
                // Restore visibility only after setup is truly complete
                setTimeout(() => {
                    if (stage) stage.classList.remove('flicker-mask');
                    if (minimapPanel) minimapPanel.classList.remove('flicker-mask');

                    if (isRegenerating) {
                        // Panels were never hidden — just rescale and we're done.
                        if (previewHeader) previewHeader.classList.add('slide-down');
                        scaleIframe();
                        return;
                    }

                    // Reveal the UI chrome with a staggered sequence (header -> minimap -> tools)
                    previewContainer.classList.remove('is-generating');
                    previewContainer.classList.add('reveal-sequence');

                    // Ensure header slide is present (setupPreviewInteractions usually adds this)
                    if (previewHeader) previewHeader.classList.add('slide-down');

                    const revealAfterHeader = () => {
                        // Reveal minimap first (slide in from left)
                        previewContainer.classList.add('reveal-minimap');
                        // Give minimap a more noticeable duration before revealing the tools
                        setTimeout(() => {
                            previewContainer.classList.add('reveal-tools');
                            // After tools animation settles, add legacy class and final scale
                            setTimeout(() => {
                                previewContainer.classList.add('reveal-chrome');
                                // Clean up reveal helpers so panels return to natural state
                                previewContainer.classList.remove('reveal-sequence', 'reveal-minimap', 'reveal-tools');
                                scaleIframe();
                            }, 900);
                        }, 700);
                        // A mid-phase scale to keep layout responsive
                        setTimeout(() => scaleIframe(), 520);
                    };

                    // Wait for header transition to end, then start reveal. Fallback to timeout.
                    let headerHandled = false;
                    if (previewHeader) {
                        const onHeaderEnd = (ev) => {
                            if (ev && ev.propertyName && ev.propertyName !== 'transform' && ev.propertyName !== 'opacity') return;
                            if (headerHandled) return;
                            headerHandled = true;
                            revealAfterHeader();
                        };
                        previewHeader.addEventListener('transitionend', onHeaderEnd, { once: true });
                        // Fallback in case transitionend doesn't fire
                        setTimeout(() => {
                            if (!headerHandled) {
                                headerHandled = true;
                                revealAfterHeader();
                            }
                        }, 1200);
                    } else {
                        // No header: reveal immediately
                        revealAfterHeader();
                    }
                }, 100);
            });

        } catch (error) {
            console.error(error);

            const errTitle = document.getElementById('t-error-title');
            const errSubtitle = document.getElementById('t-error-subtitle');

            // Default titles/subtitles
            if (errTitle) errTitle.textContent = window.__eidos_t('error_title', "Something didn't go as planned");
            if (errSubtitle) errSubtitle.textContent = window.__eidos_t('error_subtitle', "The AI service is temporarily unavailable. This is usually resolved quickly.");

            if (error.message.includes('RATE_LIMIT_EXCEEDED')) {
                if (errTitle) errTitle.textContent = window.__eidos_t('rate_limit_title', "Slow down a little");
                if (errSubtitle) errSubtitle.textContent = window.__eidos_t('rate_limit_msg', "You've reached the generation limit. Please wait a few minutes before trying again.");
            } else if (error.message.includes('TOPIC_TOO_LONG')) {
                if (errSubtitle) errSubtitle.textContent = window.__eidos_t('topic_too_long', "The topic is too long. Maximum 600 characters.");
            } else {
                // Try to extract "Please retry in X seconds" from Gemini standard errors
                let retryMsg = "";
                const retryMatch = error.message.match(/retry in ([\d\.]+)s/i);
                if (retryMatch) {
                    const seconds = Math.ceil(parseFloat(retryMatch[1]));
                    const timeStr = seconds >= 60
                        ? `${Math.ceil(seconds / 60)} min`
                        : `${seconds}s`;
                    const retryTpl = window.__eidos_t(window.currentLang === 'es' ? 'retry_in_es' : 'retry_in_en', "<br><br><strong>Retry in: {time}</strong>");
                    retryMsg = retryTpl.replace('{time}', timeStr);
                }

                if (error.message.includes('429') || error.message.includes('503') || error.message.toLowerCase().includes('exhausted') || error.message.toLowerCase().includes('saturated')) {
                    if (errSubtitle) {
                        errSubtitle.innerHTML = (window.__eidos_t ? window.__eidos_t('t-error-saturated', "The service is currently overloaded due to high demand. Please try again in a few minutes.") : "The service is currently overloaded due to high demand. Please try again in a few minutes.") + retryMsg;
                    }
                }
            }

            errorMessage.textContent = error.message;
            errorContainer.classList.remove('hidden');
            previewContainer.classList.remove('is-generating', 'reveal-sequence', 'reveal-minimap', 'reveal-tools');
            previewContainer.classList.add('hidden');
            // Clean up any in-progress chat→preview transition
            chatScreen.style.cssText = '';
            if (!_hasTransitioned) chatScreen.classList.remove('hidden');
            iframeDoc.close();
        } finally {
            toggleGenerateLoading(false);
            // is-generating is cleared by the reveal callback (success) or catch block (error).
            // Do NOT remove it here — that would cause panels to flash before the reveal animation.
            _pendingTransitionFn = null;
        }
    }

    generateBtn.addEventListener('click', () => handleGenerate(null));



    // Preview actions (Edit / Regenerate / Back)
    const btnBackToChat = document.getElementById('btn-back-to-chat');
    if (btnBackToChat) {
        btnBackToChat.addEventListener('click', () => {
            previewContainer.classList.add('hidden');
            window.removeEventListener('resize', scaleIframe);
            chatScreen.classList.remove('hidden');
            window.dispatchEvent(new Event('resize'));
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
            handleGenerate(temaInput.value.trim(), true);
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
            setTimeout(doSetup, 300);
        };

        if (html) {
            // Anti-flicker: Prevent scrollbars and margins during initial parse
            const antiFlicker = `<style id="eidos-anti-flicker">
                html, body { 
                    overflow: hidden !important; 
                    margin: 0 !important; 
                    padding: 0 !important; 
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

            // Fix any malformed <link href="url('https://...')"> the AI may have generated.
            // The browser treats url('...') as a relative path → requests /url('...') from the
            // server → gets HTML back → MIME-type error. Strip the url() wrapper here as the
            // final client-side safety net (server already does the same in sanitizeGeneratedHtml).
            html = html.replace(
                /<link([^>]*)href\s*=\s*(["'])url\s*\(\s*['"']?(https?[^'"')\s]+)['"']?\s*\)\s*\2([^>]*)>/gi,
                '<link$1href="$3"$4>'
            );

            const doc = previewIframe.contentDocument || previewIframe.contentWindow.document;
            doc.open();
            doc.write('<!DOCTYPE html>' + html);
            doc.close();
            try {
                const theme = document.documentElement.getAttribute('data-theme') || localStorage.getItem('eidos_theme') || 'dark';
                if (doc && doc.documentElement) doc.documentElement.setAttribute('data-theme', theme);
            } catch (e) {
                // ignore
            }
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

    let minimapAlreadyInit = false;
    let toolsAlreadyInit = false;
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

        // On mobile: canvas is read-only. Image-slot overlays (parent-frame labels) are
        // independent of the lock so photo upload still works normally.
        if (window.innerWidth < 850) {
            const iw = previewIframe.contentWindow;
            if (iw && typeof iw.eidosSetLocked === 'function') {
                iw.eidosSetLocked(true);
            }
        }

        if (typeof window.initMinimap === 'function' && !minimapAlreadyInit) {
            minimapAlreadyInit = true;
            window.initMinimap(previewIframe);
        }
        if (typeof window.initTools === 'function' && !toolsAlreadyInit) {
            toolsAlreadyInit = true;
            window.initTools(previewIframe);
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

        window._eidosBaseScale = scale;
        const mobileZoom = window._eidos_mobile_zoom || 1;
        const totalScale = scale * mobileZoom;

        previewIframe.style.transform = `scale(${totalScale})`;
        wrapper.style.height = `${iframeNativeHeight * totalScale}px`;
        wrapper.style.width = `${iframeNativeWidth * totalScale}px`;

        // Keep wrapper pan transform in sync with zoom state
        if (mobileZoom <= 1) {
            if (window._eidos_pan) { window._eidos_pan.x = 0; window._eidos_pan.y = 0; }
            wrapper.style.transform = 'translate(0,0)';
        } else if (window._eidos_pan) {
            wrapper.style.transform = `translate(${window._eidos_pan.x}px, ${window._eidos_pan.y}px)`;
        }

        // Inject scale into iframe for the visual editor's coordinate math
        try {
            const iframeWin = previewIframe.contentWindow;
            if (iframeWin) iframeWin._eidosIframeScale = totalScale;
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
                width: 100%; height: 100%;
                overflow: hidden !important;
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
        gifToStaticDataUrl(file).then((dataUrl) => applyImageToSlot(slot, dataUrl));
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
            const mmContainer = document.getElementById('editor-minimap');
            if (mmContainer) {
                mmContainer.style.removeProperty('--presentation-accent');
                mmContainer.style.removeProperty('--accent');
            }
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
            const iframeWin = previewIframe.contentWindow;
            const iframeDoc = previewIframe.contentDocument || iframeWin.document;

            // Deselect any active editor element so the selection box and toolbar
            // are hidden before we clone — otherwise they end up in the PDF.
            if (iframeWin.eidosDeselect) iframeWin.eidosDeselect();

            // ── Step 1: Freeze all slides ─────────────────────────────────────────
            // Unedited slides have never been through normalizeElement, so their
            // children are still in CSS grid/flex flow. Puppeteer recalculates that
            // layout with its own font metrics and can produce different widths.
            // eidosFreezeAllSlides converts every slide to absolute coordinates
            // using getBoundingClientRect() from the live browser without saving
            // any undo state.
            if (iframeWin.eidosFreezeAllSlides) iframeWin.eidosFreezeAllSlides();

            // ── Step 2: Snapshot text-child widths inside layout containers ──────
            // Children of card/stat-box containers (big-label, p, h3 …) are
            // intentionally kept inside their container by normalizeElement
            // and therefore have no inline width constraint. When Puppeteer
            // renders the same font with slightly different metrics (~1-2 px per
            // glyph) a label that fits on 1 line in the browser can wrap to 2.
            // Solution: measure each child NOW in the live browser, set its exact
            // pixel width as an inline style, and for single-line elements also
            // set white-space:nowrap so font-metric drift cannot cause a wrap.
            // We restore the live doc immediately after cloneNode.
            const _PDF_CONTAINER_SEL = 'div.stat-box, div.card, div.step-item, div.timeline-item, .quote-block, blockquote, ul, ol, [class*="card"], [class*="box"]';
            const _PDF_TEXT_SEL = 'h1,h2,h3,h4,p,span,.big-number,.big-label,.tag,li,cite';
            const _pdfSnapshots = [];
            const _iframeView = iframeDoc.defaultView;
            iframeDoc.querySelectorAll(_PDF_CONTAINER_SEL).forEach(container => {
                container.querySelectorAll(_PDF_TEXT_SEL).forEach(child => {
                    const rect = child.getBoundingClientRect();
                    if (!rect.width || !rect.height) return;
                    const comp = _iframeView.getComputedStyle(child);
                    const lineH = parseFloat(comp.lineHeight) || parseFloat(comp.fontSize) * 1.2;
                    const isSingleLine = rect.height <= lineH * 1.8;
                    _pdfSnapshots.push({
                        el: child,
                        prevWidth: child.style.width,
                        prevMinWidth: child.style.minWidth,
                        prevWhiteSpace: child.style.whiteSpace
                    });
                    if (isSingleLine) {
                        // For single-line elements only set white-space:nowrap —
                        // a fixed width is unnecessary (nowrap alone prevents wrapping)
                        // and a too-tight px value can cause Puppeteer to clip when
                        // its font metrics are 1-2px wider than the browser's.
                        child.style.whiteSpace = 'nowrap';
                    } else {
                        // Multi-line: lock width so Puppeteer can't reflow to more lines
                        child.style.width = rect.width + 'px';
                        child.style.minWidth = rect.width + 'px';
                    }
                });
            });

            const clone = iframeDoc.documentElement.cloneNode(true);

            // Restore live document immediately — snapshots only needed for the clone
            _pdfSnapshots.forEach(({ el, prevWidth, prevMinWidth, prevWhiteSpace }) => {
                el.style.width = prevWidth;
                el.style.minWidth = prevMinWidth;
                el.style.whiteSpace = prevWhiteSpace;
            });

            // Strip ALL editor UI that may still be in the DOM after deselect
            const editorUI = clone.querySelectorAll(
                '.eidos-selection-box, .eidos-toolbar, .eidos-color-picker, .eidos-guide'
            );
            editorUI.forEach(el => el.remove());

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
        document.body.classList.remove('no-scroll');
        // Show chat again
        if (resultContainer) resultContainer.classList.add('hidden');
        if (errorContainer) errorContainer.classList.add('hidden');
        if (refusedContainer) refusedContainer.classList.add('hidden');
        if (previewContainer) previewContainer.classList.add('hidden');
        if (chatScreen) {
            chatScreen.style.cssText = ''; // clear any in-progress fade
            chatScreen.classList.remove('hidden');
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
            // Prompts can come from i18n strings with HTML entities (&apos;, &amp;, etc.).
            // Decode them before writing to textarea value.
            const entityDecoder = document.createElement('textarea');
            entityDecoder.innerHTML = translated;
            input.value = entityDecoder.value;
            input.focus();
            input.dispatchEvent(new Event('input'));
        }
    };

    // Scroll is now native; no custom scroll-loop system
});
