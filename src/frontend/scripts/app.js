function sanitizeModelOutput(html) {
    if (typeof html !== 'string') return html;
    // Strip ALL inline script blocks from AI-generated content.
    // External scripts (<script src="...">) are allowed through but subject to CSP script-src.
    html = html.replace(/<script[^>]*>(\s*)<\/script>/gi, '$1'); // keep empty external wrappers
    html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ''); // strip scripts with content
    html = html.replace(/<script[^>]*>/gi, ''); // strip complete opening tags
    html = html.replace(/<script\b[^>]*/gi, ''); // strip partial tags split across SSE chunks
    html = html.replace(/<\/script>/gi, '');     // strip orphaned closing tags from stripped split-chunk scripts
    html = html.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
    html = html.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '');
    html = html.replace(/\s+(href|src|action)\s*=\s*["']javascript:[^"']*["']/gi, '');
    // Strip ALL <link> tags from streaming chunks — same rationale as server-side cleanSSEChunk.
    // A <link href="url('https://fonts...."> can split across two SSE chunks so any regex that
    // targets 'fonts.googleapis.com' will miss it when that string straddles a chunk boundary.
    // Stripping all <link> tags is safe: the streaming iframe is visual-only and initPreview()
    // always writes the server-sanitized final HTML which already has correct font links injected.
    html = html.replace(/<link[^>]*\/?>/gi, '');   // complete link tags
    html = html.replace(/<link\b[^>]*/gi, '');      // partial/unclosed link tags (cross-chunk)
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
            canvas.width = img.naturalWidth || img.width;
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
    const uiLog = window.BrowserLogger
        ? window.BrowserLogger.createLogger({ scope: 'UI', minLevel: 'debug' })
        : {
            debug: () => { },
            info: () => { },
            success: () => { },
            warn: () => { },
            error: () => { }
        };

    // Prevent accidental browser navigation when dragging files over the page
    window.addEventListener('dragover', (e) => {
        const previewContainer = document.getElementById('preview-container');
        if (previewContainer && !previewContainer.classList.contains('hidden')) return; // Let editor handle its own dragover
        e.preventDefault();
    }, false);
    window.addEventListener('drop', (e) => {
        const previewContainer = document.getElementById('preview-container');
        if (previewContainer && !previewContainer.classList.contains('hidden')) return; // Let editor handle its own drop
        e.preventDefault();
    }, false);

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
    let debugLastGeneratedBtn = null; // Created dynamically in dev only

    // ── Active SSE stream controller (cancel on Back / new generation) ──
    // NOTE: also exposed on window so outline.js abort logic can reach it.
    let _activeGenController = null;
    Object.defineProperty(window, '_activeGenController', {
        get: () => _activeGenController,
        set: (v) => { _activeGenController = v; }
    });
    let _skeletonGenController = null;
    let _heroCustomTextActive = false;
    // Callback run when the error modal is dismissed (varies by context)
    let _errorModalOnDismiss = null;

    function showErrorModal(onDismiss) {
        _errorModalOnDismiss = onDismiss || null;
        errorContainer.classList.remove('hidden');
    }

    function hideErrorModal() {
        errorContainer.classList.add('is-closing');
        setTimeout(() => {
            errorContainer.classList.remove('is-closing');
            errorContainer.classList.add('hidden');
            _errorModalOnDismiss = null;
        }, 190);
    }

    // Wire error modal close/action buttons
    const _errCloseBtnEl = document.getElementById('error-modal-close-btn');
    if (_errCloseBtnEl) _errCloseBtnEl.addEventListener('click', () => {
        const cb = _errorModalOnDismiss;
        hideErrorModal();
        if (cb) cb();
    });

    const _refCloseBtnEl = document.getElementById('refused-modal-close-btn');
    if (_refCloseBtnEl) _refCloseBtnEl.addEventListener('click', () => {
        refusedContainer.classList.add('is-closing');
        setTimeout(() => {
            refusedContainer.classList.remove('is-closing');
            refusedContainer.classList.add('hidden');
            chatScreen.style.cssText = '';
            chatScreen.classList.remove('hidden');
        }, 190);
    });

    // Preview elements
    let previewIframe = document.getElementById('preview-iframe');
    const slideDots = document.getElementById('slide-dots');
    const slideLabel = document.getElementById('slide-label');
    const mobileSlideDots = document.getElementById('mobile-slide-dots');
    const mobileSlideLabel = document.getElementById('mobile-slide-label');
    const previewHeader = document.querySelector('.preview-unified-header');
    const finalizeBtn = document.getElementById('finalize-btn');
    const progressBarEl = document.getElementById('loading-progress-bar');

    // State
    let currentSlide = 0;
    window.currentSlide = 0; // Initialize globally for editor iframe sync
    let totalSlides = 0;
    let generatedHtml = '';
    let slideContainer = null; // The actual parent element of the slides (may be body or a wrapper)
    let currentTitle = 'Presentation';
    let _refreshSlotOverlays = null; // assigned in injectImageReplacementSystem
    let _overlayMap = new Map(); // slotEl -> { input, label }
    let _stabilizeMinimapOnNextPreviewInit = false;

    // Panel insets used by scaleIframe to account for floating panel overlay.
    // GSAP tweens this object during the settling animation so scaleIframe can
    // call getBoundingClientRect once and derive both scale and centering offset.
    let _editorInsets = { left: 0, right: 0, top: 0, bottom: 0 };
    // Tracks the active settling GSAP tween so we can kill it before a new generation
    // starts (prevents the previous onComplete from firing showFloatingPills mid-stream).
    let _settlingAnimation = null;

    function clearStageInlinePadding() {
        const stageEl = document.getElementById('preview-stage');
        if (!stageEl) return;
        // GSAP writes longhand paddings during settle; clear each one explicitly.
        stageEl.style.padding = '';
        stageEl.style.paddingLeft = '';
        stageEl.style.paddingRight = '';
        stageEl.style.paddingTop = '';
        stageEl.style.paddingBottom = '';
    }

    function resetMobileZoomState() {
        if (window.MobileRuntime && typeof window.MobileRuntime.resetZoomState === 'function') {
            window.MobileRuntime.resetZoomState();
            return;
        }
        window._mobile_zoom = 1;
        window._pan = { x: 0, y: 0 };
    }

    const MOBILE_BREAKPOINT =
        window.MobileConfig && Number.isFinite(window.MobileConfig.breakpoint)
            ? window.MobileConfig.breakpoint
            : 850;

    function isMobileViewport() {
        if (window.MobileRuntime && typeof window.MobileRuntime.isMobileLayout === 'function') {
            return window.MobileRuntime.isMobileLayout();
        }
        return window.innerWidth <= MOBILE_BREAKPOINT;
    }

    // Mode toggle: false = Flash (default), true = Pro (3-stage pipeline)
    let proModeEnabled = false;

    // ── Dropdown Menus Logic (Mode & Language) ──────────────────────────────────
    let targetLanguage = 'auto';
    const modeBtn = document.getElementById('btn-mode-dropdown');
    const modeMenu = document.getElementById('mode-dropdown-menu');
    const langBtn = document.getElementById('btn-lang-dropdown');
    const langMenu = document.getElementById('lang-dropdown-menu');
    const currentModeLabel = document.getElementById('current-mode-label');
    const currentLangLabel = document.getElementById('current-lang-label');
    const chatInputWrapper = document.querySelector('.chat-input-wrapper');

    function closeAllDropdowns() {
        if (modeMenu) modeMenu.classList.add('hidden');
        if (langMenu) langMenu.classList.add('hidden');
        if (modeBtn) modeBtn.setAttribute('aria-expanded', 'false');
        if (langBtn) langBtn.setAttribute('aria-expanded', 'false');
    }

    if (modeBtn && modeMenu) {
        modeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (modeBtn.disabled) return;
            const isHidden = modeMenu.classList.contains('hidden');
            closeAllDropdowns();
            if (isHidden) {
                modeMenu.classList.remove('hidden');
                modeBtn.setAttribute('aria-expanded', 'true');
            }
        });

        modeMenu.addEventListener('click', (e) => {
            const item = e.target.closest('.dropdown-item[data-mode]');
            if (!item) return;
            const mode = item.dataset.mode;
            proModeEnabled = (mode === 'pro');

            modeMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');

            const labelKey = mode === 'pro' ? 'mode_pro_title' : 'mode_flash_title';
            if (currentModeLabel) {
                currentModeLabel.textContent = window.__t(labelKey);
                currentModeLabel.setAttribute('data-i18n', labelKey);
            }
            if (chatInputWrapper) chatInputWrapper.classList.toggle('is-pro', proModeEnabled);
            closeAllDropdowns();
        });
    }

    if (langBtn && langMenu) {
        langBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = langMenu.classList.contains('hidden');
            closeAllDropdowns();
            if (isHidden) {
                langMenu.classList.remove('hidden');
                langBtn.setAttribute('aria-expanded', 'true');
            }
        });

        langMenu.addEventListener('click', (e) => {
            const item = e.target.closest('.dropdown-item[data-lang]');
            if (!item) return;
            targetLanguage = item.dataset.lang;

            langMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');

            if (currentLangLabel) currentLangLabel.textContent = item.textContent.split(' ')[0]; // Show shortened name if space exists
            closeAllDropdowns();
        });
    }

    document.addEventListener('click', closeAllDropdowns);

    // Auto-lock pro mode when files are attached
    window._syncModeWithFiles = function () {
        if (!modeBtn) return;
        if (window._attachedFiles && window._attachedFiles.length > 0) {
            proModeEnabled = true;
            modeBtn.disabled = true;
            modeBtn.style.opacity = '0.6';
            modeBtn.style.cursor = 'not-allowed';
            modeBtn.parentElement.setAttribute('data-tooltip', window.__t('mode_tooltip_file_locked', 'High Quality is required to analyze files.'));
            if (currentModeLabel) currentModeLabel.textContent = window.__t('mode_pro_title', 'High Quality');
            if (chatInputWrapper) chatInputWrapper.classList.add('is-pro');
            if (modeMenu) modeMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.toggle('active', el.dataset.mode === 'pro'));
        } else {
            proModeEnabled = false;
            modeBtn.disabled = false;
            modeBtn.style.opacity = '';
            modeBtn.style.cursor = '';
            modeBtn.parentElement.removeAttribute('data-tooltip');
            if (currentModeLabel) currentModeLabel.textContent = window.__t('mode_flash_title', 'Fast Mode');
            if (chatInputWrapper) chatInputWrapper.classList.remove('is-pro');
            if (modeMenu) modeMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.toggle('active', el.dataset.mode === 'flash'));
        }
    };
    // ─────────────────────────────────────────────────────────────────────

    // Listen for messages from iframe during skeleton generation
    window.addEventListener('message', (e) => {
        if (!e.data) return;
        if (e.data.type === 'slideUpdate') {
            const count = e.data.count;
            totalSlides = count;
            if (slideLabel) {
                const tpl = window.__t("slide_label_tpl", "{current} / {total}");
                slideLabel.textContent = tpl.replace('{current}', count).replace('{total}', count);
            }
            currentSlide = count - 1;

            // Trigger chat→preview transition on the first real slide
            if (_pendingTransitionFn) {
                const fn = _pendingTransitionFn;
                _pendingTransitionFn = null;
                setTimeout(() => fn(), 670);
            }

            // Rebuild dots and minimap skeletons during generation.
            // During soft-regen the minimap stays frozen on the old thumbnails until
            // buildMinimap() replaces them after the final render.
            if (typeof buildDots === 'function') buildDots();
            if (!_skipMinimapSkeleton) updateMinimapSkeleton(count);
        }
        if (e.data.type === 'titleUpdate') {
            const previewLabel = document.getElementById('preview-topic-label');
            if (previewLabel) {
                // Keep it short if it's too long
                let t = e.data.title.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                if (t.length > 50) t = t.substring(0, 47) + '...';
                previewLabel.textContent = t;

            }
        }
    });

    // --- i18n is now handled globally by i18n.js ---

    // =========================================================
    // TOP PANEL CONTROLS (THEME + LANGUAGE)
    // =========================================================
    (function setupTopPanelControls() {
        const root = document.documentElement;
        const themeToggleBtn = document.getElementById('theme-toggle-btn');
        const previewThemeToggleBtn = document.getElementById('preview-theme-toggle-btn');


        function applyInputPlaceholder(lang) {
            const input = document.getElementById('w-tema');
            if (!input) return;
            input.placeholder = lang === 'es'
                ? 'Escribe el tema de tu presentacion...'
                : 'Describe your presentation topic...';
        }

        function applyTheme(theme, animate = false, event = null) {
            const nextTheme = theme === 'light' ? 'light' : 'dark';

            const doChange = () => {
                root.setAttribute('data-theme', nextTheme);
                localStorage.setItem('app_theme', nextTheme);
                const title = (typeof window.__t === 'function')
                    ? window.__t('theme_toggle')
                    : 'Toggle theme';
                if (themeToggleBtn) {
                    themeToggleBtn.setAttribute('aria-label', title);
                }
                if (previewThemeToggleBtn) {
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
            };

            if (!animate || !document.startViewTransition) {
                doChange();
                return;
            }

            document.documentElement.classList.add('theme-transitioning');
            const transition = document.startViewTransition(() => {
                doChange();
            });

            transition.ready.then(() => {
                const x = event ? event.clientX : window.innerWidth / 2;
                const y = event ? event.clientY : window.innerHeight / 2;

                // Calculate distance to the furthest corner to ensure full coverage
                const endRadius = Math.hypot(
                    Math.max(x, window.innerWidth - x),
                    Math.max(y, window.innerHeight - y)
                ) + 60; // Extra buffer for mobile toolbars

                document.documentElement.animate(
                    {
                        clipPath: [
                            `circle(0px at ${x}px ${y}px)`,
                            `circle(${endRadius}px at ${x}px ${y}px)`
                        ]
                    },
                    {
                        duration: 700,
                        easing: "cubic-bezier(0.25, 1, 0.5, 1)",
                        pseudoElement: "::view-transition-new(root)"
                    }
                );
            });

            transition.finished.then(() => {
                document.documentElement.classList.remove('theme-transitioning');
            });
        }



        const savedTheme = localStorage.getItem('app_theme') || 'dark';
        applyTheme(savedTheme);

        if (themeToggleBtn) {
            themeToggleBtn.addEventListener('click', (e) => {
                const current = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
                applyTheme(current === 'light' ? 'dark' : 'light', true, e);
            });
        }
        if (previewThemeToggleBtn) {
            previewThemeToggleBtn.addEventListener('click', (e) => {
                const current = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
                applyTheme(current === 'light' ? 'dark' : 'light', true, e);
            });
        }


    })();

    // ── Smart Tooltips (JS singleton, position: fixed) ────────────────────
    (function initSmartTooltips() {
        const tip = document.getElementById('js-tooltip');
        if (!tip) return;

        const MARGIN = 8; // px from viewport edge
        const GAP = 10; // px between trigger and tooltip

        function showTip(trigger) {
            const text = trigger.dataset.tooltip;
            if (!text) return;

            // Set text and reset position so it can size freely while still hidden
            tip.textContent = text;
            tip.style.left = '0';
            tip.style.top = '0';

            // Measure while still invisible (visibility:hidden has correct layout)
            const tr = trigger.getBoundingClientRect();
            const tw = tip.offsetWidth;
            const th = tip.offsetHeight;
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            // Prefer above for btn-mode-toggle, below for header icons
            const preferAbove = trigger.classList.contains('btn-mode-toggle');

            const spaceAbove = tr.top;
            const spaceBelow = vh - tr.bottom;

            let top;
            if (preferAbove) {
                top = spaceAbove >= th + GAP
                    ? tr.top - th - GAP
                    : tr.bottom + GAP; // flip below
            } else {
                top = spaceBelow >= th + GAP
                    ? tr.bottom + GAP
                    : tr.top - th - GAP; // flip above
            }

            // Center horizontally, clamped to viewport
            let left = tr.left + tr.width / 2 - tw / 2;
            left = Math.max(MARGIN, Math.min(left, vw - tw - MARGIN));

            tip.style.top = top + 'px';
            tip.style.left = left + 'px';

            // Show only after positioned — prevents first-hover flash at wrong size
            tip.classList.add('visible');
        }

        function hideTip() {
            tip.classList.remove('visible');
        }

        // Event delegation — works for all 3 tooltip triggers
        document.addEventListener('mouseover', function (e) {
            const trigger = e.target.closest('[data-tooltip]');
            if (trigger && trigger.dataset.tooltip && !trigger.disabled) showTip(trigger);
        });

        document.addEventListener('mouseout', function (e) {
            const trigger = e.target.closest('[data-tooltip]');
            if (trigger) hideTip();
        });

        document.addEventListener('mousedown', hideTip);
        document.addEventListener('scroll', hideTip, true);
    })();

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }

    // =========================================================
    // INPUT PLACEHOLDER (NATIVE)
    // =========================================================
    const typewriterCursor = null;
    const chatPlaceholderContainer = null;
    let typewriterRunning = false;
    function startTypewriter() { }
    function stopTypewriter() { }

    // =========================================================
    // STATE ROUTER
    // =========================================================
    window.navigateToHome = function() {
        if (window.location.hash !== '#home') {
            window.history.replaceState(null, '', '#home');
        }
        
        const chatScreen = document.getElementById('chat-screen');
        if (chatScreen) {
            chatScreen.classList.remove('chat-mode');
            chatScreen.classList.remove('hidden');
            chatScreen.style.cssText = '';
        }
        
        const heroZone = document.getElementById('hero-zone');
        if (heroZone) heroZone.classList.remove('fade-out');
        
        const pills = document.getElementById('suggestion-pills-row');
        if (pills) { pills.style.transition = ''; pills.style.opacity = '1'; pills.style.pointerEvents = 'auto'; }
        const microcopy = document.querySelector('.app-microcopy');
        if (microcopy) { microcopy.style.transition = ''; microcopy.style.opacity = '1'; }
        const counter = document.querySelector('.chat-counter-row');
        if (counter) { counter.style.transition = ''; counter.style.opacity = '1'; }
        
        const convZone = document.getElementById('conversation-zone');
        if (convZone) {
            convZone.classList.add('hidden');
            convZone.classList.remove('visible');
            
            // 1. Move outline-container back to its original home inside #chat-ai-response .chat-ai-body and hide it
            const outlineContainer = document.getElementById('outline-container');
            const originalAiBody = document.querySelector('#chat-ai-response .chat-ai-body');
            if (outlineContainer && originalAiBody) {
                outlineContainer.classList.add('hidden');
                originalAiBody.appendChild(outlineContainer);
            }

            // 2. Remove any dynamically added follow-up bubbles, but keep the first two hardcoded ones safe
            const dynamicBubbles = convZone.querySelectorAll('.chat-msg:not(#chat-user-bubble):not(#chat-ai-response)');
            dynamicBubbles.forEach(b => b.remove());
            const dynamicErrors = convZone.querySelectorAll('.chat-error-message');
            dynamicErrors.forEach(e => e.remove());

            // 3. Clean up any historical outline summaries anywhere in the chat
            convZone.querySelectorAll('.historical-outline-summary').forEach(el => el.remove());

            // 4. Reset outline slides container and chips to pristine empty state
            const slidesContainer = document.getElementById('outline-slides-container');
            if (slidesContainer) slidesContainer.innerHTML = '';
            const chipsContainer = document.getElementById('outline-suggested-chips');
            if (chipsContainer) {
                chipsContainer.innerHTML = '';
                if (window._chipsRenderTimeout) clearTimeout(window._chipsRenderTimeout);
            }

            // 5. Clean up the first two hardcoded bubbles to their pristine starting state
            const firstUserText = document.getElementById('chat-user-text');
            if (firstUserText) firstUserText.textContent = '';

            const firstAiResponse = document.getElementById('chat-ai-response');
            if (firstAiResponse) {
                // Restore default classes
                firstAiResponse.className = 'chat-msg chat-msg-ai';
                
                // Clean up any proceed, cancelled or error elements
                firstAiResponse.querySelectorAll('.chat-proceed-message, .chat-cancelled-message, .chat-error-message').forEach(el => el.remove());
                
                // Reset thinking dots
                const thinking = firstAiResponse.querySelector('.chat-thinking');
                if (thinking) {
                    thinking.className = 'chat-thinking hidden';
                }
                
                // Restore avatar opacity
                const avatar = firstAiResponse.querySelector('.chat-ai-avatar');
                if (avatar) {
                    avatar.style.opacity = '';
                    avatar.style.pointerEvents = '';
                    avatar.style.userSelect = '';
                }
            }
        }
        
        // 6. Reset local attached files state and UI
        if (window._attachedFiles) {
            window._attachedFiles = [];
            const attachmentPreview = document.getElementById('attachment-preview-container');
            if (attachmentPreview) {
                attachmentPreview.innerHTML = '';
                attachmentPreview.classList.add('hidden');
            }
            const modeBtn = document.getElementById('btn-mode-dropdown');
            if (modeBtn) {
                modeBtn.disabled = false;
                modeBtn.style.opacity = '';
                modeBtn.style.cursor = '';
                if (modeBtn.parentElement) {
                    modeBtn.parentElement.removeAttribute('data-tooltip');
                }
            }
        }
        
        if (window.outlineEditorState) {
            window.outlineEditorState.skeleton = null;
            window.outlineEditorState.isLoading = false;
        }
        
        const previewCont = document.getElementById('preview-container');
        if (previewCont) {
            previewCont.classList.add('hidden');
        }
        
        const temaInput = document.getElementById('w-tema');
        if (temaInput) temaInput.value = '';

        // Reset hero custom state and title text upon returning home
        _heroCustomTextActive = false;
        const heroTextSpan = document.querySelector('.hero-title-text');
        if (heroTextSpan && heroTextSpan.getAttribute('data-original-text')) {
            heroTextSpan.textContent = heroTextSpan.getAttribute('data-original-text');
            heroTextSpan.parentElement.classList.remove('waiting-state');
        }
    };

    window.navigateToChat = function() {
        if (window.location.hash !== '#chat') {
            window.history.pushState(null, '', '#chat');
        }
        // Let existing chat initialization (outline.js) handle specific DOM changes
    };

    window.navigateToEditor = function() {
        if (window.location.hash !== '#editor') {
            window.history.pushState(null, '', '#editor');
        }
        // Specific changes handled organically by startFinalGeneration
    };

    // Handle browser back/forward button natively via Router
    window.addEventListener('popstate', (e) => {
        const hash = window.location.hash;
        
        const previewCont = document.getElementById('preview-container');
        const outlineContainer = document.getElementById('outline-container');

        // Check if there is active progress that can be lost (generation OR manual editing)
        const outlineActive = !!_skeletonGenController || (outlineContainer && !outlineContainer.classList.contains('hidden'));
        const editorActive = !!_activeGenController || (previewCont && !previewCont.classList.contains('hidden'));

        if (outlineActive || editorActive) {
            const msg = window.__t ? window.__t('confirm_exit_draft', 'Are you sure you want to go back? Your progress will be lost.') : 'Are you sure you want to go back? Your progress will be lost.';
            if (confirm(msg)) {
                if (outlineContainer) outlineContainer.classList.add('hidden'); 
                if (previewCont) previewCont.classList.add('hidden'); 
                
                if (_activeGenController) { _activeGenController.abort(); _activeGenController = null; }
                if (_skeletonGenController) { _skeletonGenController.abort(); _skeletonGenController = null; }
                
                // Reset hash to #home and reload to guarantee a clean URL
                window.location.href = window.location.origin + window.location.pathname + '#home';
            } else {
                // User cancelled, restore URL hash corresponding to their active state
                // If the preview container is visible, they are in the editor (#editor)
                // Otherwise they are in the outline editor or slide loading screen (#chat)
                const editorVisible = previewCont && !previewCont.classList.contains('hidden');
                if (editorVisible) {
                    window.history.replaceState(null, '', '#editor');
                } else {
                    window.history.replaceState(null, '', '#chat');
                }
                return; // Stop processing popstate
            }
        }
        
        // Standard Router Fallback (if no active progress is at risk)
        if (hash === '' || hash === '#home') {
            window.navigateToHome();
        } else if (hash === '#chat') {
            // As per user requirement: if the user navigates back to the chat from the editor,
            // they should be returned to the menu to avoid getting stuck in the "creating slides" state.
            window.navigateToHome();
        }
    });

    // Always force redirect to #home on fresh reload or entry
    const initialHash = window.location.hash;
    if (initialHash !== '#home') {
        window.history.replaceState(null, '', '#home');
    }
    window.navigateToHome();

    // Click brand logo to go to #home with progress warning checks
    const topBrand = document.querySelector('.top-brand');
    if (topBrand) {
        topBrand.addEventListener('click', () => {
            const previewCont = document.getElementById('preview-container');
            const outlineContainer = document.getElementById('outline-container');
            const outlineActive = !!_skeletonGenController || (outlineContainer && !outlineContainer.classList.contains('hidden'));
            const editorActive = !!_activeGenController || (previewCont && !previewCont.classList.contains('hidden'));

            if (outlineActive || editorActive) {
                const msg = window.__t ? window.__t('confirm_exit_draft', 'Are you sure you want to go back? Your progress will be lost.') : 'Are you sure you want to go back? Your progress will be lost.';
                if (!confirm(msg)) {
                    return; // user cancelled, do not navigate
                }
                
                // If confirmed, reset states
                if (outlineContainer) outlineContainer.classList.add('hidden'); 
                if (previewCont) previewCont.classList.add('hidden'); 
                if (_activeGenController) { _activeGenController.abort(); _activeGenController = null; }
                if (_skeletonGenController) { _skeletonGenController.abort(); _skeletonGenController = null; }
            }

            // Cleanly reset UI and set hash to #home
            window.navigateToHome();
        });
    }

    // Warn on tab close if the user has active draft progress (generation OR manual editing)
    window.addEventListener('beforeunload', (e) => {
        const outlineContainer = document.getElementById('outline-container');
        const previewCont = document.getElementById('preview-container');
        
        const outlineActive = !!_skeletonGenController || (outlineContainer && !outlineContainer.classList.contains('hidden'));
        const editorActive = !!_activeGenController || (previewCont && !previewCont.classList.contains('hidden'));

        if (outlineActive || editorActive) {
            e.preventDefault();
            e.returnValue = ''; // Standard way to trigger native browser prompt
        }
    });

    // Clear error on typing and validate length
    const temaInput = document.getElementById('w-tema');
    const btnGenerate = document.getElementById('btn-generate');

    // ── File Upload Logic ───────────────────────────────────────────────
    const btnAttachFile = document.getElementById('btn-attach-file');
    const fileUploadInput = document.getElementById('file-upload-input');
    const attachmentPreviewContainer = document.getElementById('attachment-preview-container');

    // Store files locally for submission
    window._attachedFiles = [];

    function handleFilesAdded(files) {
        if (files.length === 0) return;

        const allowedExtensions = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.webp'];
        const validFiles = [];
        for (let f of files) {
            const ext = f.name.includes('.') ? f.name.substring(f.name.lastIndexOf('.')).toLowerCase() : '';
            if (!allowedExtensions.includes(ext)) {
                const msg = window.__t('invalid_file_format', 'Invalid file format. Only PDF, Office Word, and images are allowed.');
                alert(msg);
                continue;
            }

            if (f.size > 10 * 1024 * 1024) {
                const msg = window.__t('file_too_large', 'The file "{name}" is too large. Maximum size is 10MB.').replace('{name}', f.name);
                alert(msg);
                continue;
            }
            validFiles.push(f);
        }

        if (window._attachedFiles.length + validFiles.length > 3) {
            alert(window.__t('max_files_reached', 'You can upload a maximum of 3 files per presentation.'));
            validFiles.splice(3 - window._attachedFiles.length);
        }

        if (validFiles.length > 0) {
            window._attachedFiles = window._attachedFiles.concat(validFiles);
            renderAttachmentChips();
            validateGenerateButton();
        }
    }

    if (btnAttachFile && fileUploadInput) {
        btnAttachFile.addEventListener('click', () => {
            fileUploadInput.click();
        });

        fileUploadInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            handleFilesAdded(files);
            fileUploadInput.value = '';
        });
    }

    // ── Drag and Drop Event Listeners ───────────────────────────────────
    (function setupDragAndDrop() {
        let dragCounter = 0;
        const dragDropOverlay = document.getElementById('drag-drop-overlay');

        window.addEventListener('dragenter', (e) => {
            e.preventDefault();

            // Do not show full-screen drag overlay or allow global file attachment if editor is active
            const previewContainer = document.getElementById('preview-container');
            if (previewContainer && !previewContainer.classList.contains('hidden')) return;

            // Block drag and drop in chat mode
            const chatScreen = document.getElementById('chat-screen');
            if (chatScreen && chatScreen.classList.contains('chat-mode')) return;

            if (btnAttachFile && btnAttachFile.disabled) return;
            if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;

            dragCounter++;
            if (dragCounter === 1 && dragDropOverlay) {
                dragDropOverlay.classList.remove('hidden');
            }
        });

        window.addEventListener('dragover', (e) => {
            const previewContainer = document.getElementById('preview-container');
            if (previewContainer && !previewContainer.classList.contains('hidden')) return;

            // Block drag and drop in chat mode
            const chatScreen = document.getElementById('chat-screen');
            if (chatScreen && chatScreen.classList.contains('chat-mode')) return;

            e.preventDefault();
        });

        window.addEventListener('dragleave', (e) => {
            e.preventDefault();

            const previewContainer = document.getElementById('preview-container');
            if (previewContainer && !previewContainer.classList.contains('hidden')) {
                dragCounter = 0;
                if (dragDropOverlay) dragDropOverlay.classList.add('hidden');
                return;
            }

            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                if (dragDropOverlay) dragDropOverlay.classList.add('hidden');
            }
        });

        window.addEventListener('drop', (e) => {
            e.preventDefault();

            const previewContainer = document.getElementById('preview-container');
            if (previewContainer && !previewContainer.classList.contains('hidden')) {
                dragCounter = 0;
                if (dragDropOverlay) dragDropOverlay.classList.add('hidden');
                return;
            }

            // Block drag and drop in chat mode
            const chatScreen = document.getElementById('chat-screen');
            if (chatScreen && chatScreen.classList.contains('chat-mode')) {
                dragCounter = 0;
                if (dragDropOverlay) dragDropOverlay.classList.add('hidden');
                return;
            }

            dragCounter = 0;
            if (dragDropOverlay) dragDropOverlay.classList.add('hidden');

            if (btnAttachFile && btnAttachFile.disabled) return;

            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const files = Array.from(e.dataTransfer.files);
                handleFilesAdded(files);
            }
        });
    })();

    function renderAttachmentChips() {
        if (!attachmentPreviewContainer) return;

        if (typeof window._syncModeWithFiles === 'function') {
            window._syncModeWithFiles();
        }

        // Revoke any existing object URLs to prevent memory leaks
        const existingChips = attachmentPreviewContainer.querySelectorAll('.file-chip');
        existingChips.forEach(c => {
            if (c.dataset.objectUrl) URL.revokeObjectURL(c.dataset.objectUrl);
        });

        attachmentPreviewContainer.innerHTML = '';
        if (window._attachedFiles.length === 0) {
            attachmentPreviewContainer.classList.add('hidden');
            return;
        }

        attachmentPreviewContainer.classList.remove('hidden');

        window._attachedFiles.forEach((file, index) => {
            const chip = document.createElement('div');
            chip.className = 'file-chip';

            let iconMarkup = '';
            let isLucide = false;

            if (file.type.startsWith('image/')) {
                const objectUrl = URL.createObjectURL(file);
                iconMarkup = `<img src="${objectUrl}" alt="preview" style="width: 24px; height: 24px; object-fit: cover; border-radius: 4px; margin-right: 6px;">`;
                chip.dataset.objectUrl = objectUrl;
            } else if (file.type.includes('pdf') || file.name.endsWith('.pdf')) {
                // PDF Acrobat red flat icon
                iconMarkup = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" style="margin-right: 6px; flex-shrink: 0;"><path d="M4 2h10l6 6v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#E2231A"/><path d="M14 2v6h6z" fill="#B0150F"/><text x="11" y="16.5" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="6.2" font-weight="900" text-anchor="middle" letter-spacing="-0.3px">PDF</text></svg>`;
            } else if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
                // DOCX Word blue flat icon
                iconMarkup = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" style="margin-right: 6px; flex-shrink: 0;"><path d="M4 2h10l6 6v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#185ABD"/><path d="M14 2v6h6z" fill="#103F8A"/><text x="11" y="16.5" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="7.5" font-weight="900" text-anchor="middle">W</text></svg>`;
            } else {
                isLucide = true;
                iconMarkup = `<i data-lucide="file-text" style="width: 18px; height: 18px; margin-right: 6px; color: var(--text-color);"></i>`;
            }

            // Limit name length
            let displayName = file.name;
            if (displayName.length > 20) {
                displayName = displayName.substring(0, 17) + '...';
            }

            const nameSpan = document.createElement('span');
            nameSpan.style.display = 'flex';
            nameSpan.style.alignItems = 'center';
            nameSpan.innerHTML = `${iconMarkup} <span>${displayName}</span>`;

            if (isLucide) {
                setTimeout(() => {
                    if (window.lucide && typeof window.lucide.createIcons === 'function') {
                        window.lucide.createIcons({ root: nameSpan });
                    }
                }, 0);
            }

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'file-chip-remove';
            removeBtn.setAttribute('aria-label', 'Remove file');
            removeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

            removeBtn.addEventListener('click', () => {
                window._attachedFiles.splice(index, 1);
                renderAttachmentChips();
                validateGenerateButton();
            });

            chip.appendChild(nameSpan);
            chip.appendChild(removeBtn);
            attachmentPreviewContainer.appendChild(chip);
        });
    }

    function validateGenerateButton() {
        if (btnGenerate && btnGenerate.classList.contains('is-generating')) {
            return;
        }

        const val = temaInput ? temaInput.value.trim() : '';
        const hasFiles = window._attachedFiles && window._attachedFiles.length > 0;
        const isActive = val.length >= 4 || hasFiles;

        if (btnGenerate) {
            btnGenerate.disabled = !isActive;
        }

        // Animate hero title dynamically based on active state and language
        if (isActive) {
            if (!_heroCustomTextActive) {
                _heroCustomTextActive = true;
                animateHeroTitle(window.__t('hero_active'));
            }
        } else {
            if (_heroCustomTextActive) {
                _heroCustomTextActive = false;
                animateHeroTitle(window.__t('hero_line_1'));
            }
        }
    }
    window.validateGenerateButton = validateGenerateButton;
    // ─────────────────────────────────────────────────────────────────────


    let warmedUp = false;
    temaInput.addEventListener('input', () => {
        const val = temaInput.value;

        // Warm up the backend if not already done
        if (!warmedUp && val.length > 0) {
            warmedUp = true;
            fetch('/health').catch(() => {
                // Silently fail, allow retry on next input if it failed
                warmedUp = false;
            });
        }

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

        validateGenerateButton();
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

    // Hide hero cursor on focus to avoid double-cursor visual overload (without layout shift)
    if (temaInput) {
        const heroCursor = document.querySelector('.hero-cursor');
        if (heroCursor) {
            // Check immediately on startup in case of browser autofocus
            if (document.activeElement === temaInput) {
                heroCursor.style.visibility = 'hidden';
            }

            temaInput.addEventListener('focus', () => {
                heroCursor.style.visibility = 'hidden';
            });
            temaInput.addEventListener('blur', () => {
                heroCursor.style.visibility = 'visible';
            });
        }
    }



    // =========================================================
    // 5. GENERATE BUTTON
    // =========================================================
    const generateBtn = document.getElementById('btn-generate');



    // ── Button cycling message state ──────────────────────────────────────
    const BTN_LOADING_KEYS_DESKTOP = [
        'gen_loading_1', 'gen_loading_2', 'gen_loading_3', 'gen_loading_4',
        'gen_loading_5', 'gen_loading_6', 'gen_loading_7', 'gen_loading_8',
        'gen_loading_9', 'gen_loading_final'
    ];
    let _activeBtnLoadingKeys = BTN_LOADING_KEYS_DESKTOP;
    let _btnMsgTimer = null;
    let _btnMsgIndex = 0;

    function _resolveBtnLoadingKeys() {
        if (window.MobileRuntime && typeof window.MobileRuntime.resolveLoadingKeys === 'function') {
            return window.MobileRuntime.resolveLoadingKeys(BTN_LOADING_KEYS_DESKTOP);
        }
        if (window.innerWidth <= 768) {
            return BTN_LOADING_KEYS_DESKTOP.map(key => key + '_mobile');
        }
        return BTN_LOADING_KEYS_DESKTOP;
    }

    function _scheduleNextBtnMsg() {
        if (_btnMsgIndex >= _activeBtnLoadingKeys.length - 1) return;
        _btnMsgTimer = setTimeout(() => {
            _btnMsgIndex++;
            const key = _activeBtnLoadingKeys[_btnMsgIndex];
            const fallbackKey = BTN_LOADING_KEYS_DESKTOP[_btnMsgIndex] || 'gen_loading_final';
            const newText = window.__t(key, window.__t(fallbackKey));
            animateHeroTitle(newText);
            _scheduleNextBtnMsg();
        }, 3000); // Increased interval slightly to account for animations
    }

    function animateHeroTitle(newText) {
        const heroTextSpan = document.querySelector('.hero-title-text');
        const heroTitle = document.querySelector('.hero-title');
        if (!heroTextSpan || !heroTitle) return;
        const clean = newText.replace(/\.+$/, '').trimEnd();

        if (window._heroTypewriterTimer) {
            clearTimeout(window._heroTypewriterTimer);
            window._heroTypewriterTimer = null;
        }
        if (window.gsap) window.gsap.killTweensOf(heroTitle);

        // Fast fade out from right to left (moving left while fading)
        gsap.to(heroTitle, {
            x: -20,
            opacity: 0,
            duration: 0.45,
            ease: "power2.in",
            onComplete: () => {
                heroTextSpan.textContent = '';
                gsap.set(heroTitle, { x: 0, opacity: 1 });

                // Manual typewriter effect
                let i = 0;
                function typeChar() {
                    if (i < clean.length) {
                        heroTextSpan.textContent += clean.charAt(i);
                        i++;
                        window._heroTypewriterTimer = setTimeout(typeChar, 28);
                    }
                }
                typeChar();
            }
        });
    }

    let _heroResetTimer = null;
    function startBtnMessages() {
        if (_heroResetTimer) { clearTimeout(_heroResetTimer); _heroResetTimer = null; }
        _activeBtnLoadingKeys = _resolveBtnLoadingKeys();
        _btnMsgIndex = 0;
        _btnMsgTimer = null;
        const key = _activeBtnLoadingKeys[0];
        const newText = window.__t(key, window.__t(BTN_LOADING_KEYS_DESKTOP[0]));
        animateHeroTitle(newText);
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
        if (_heroResetTimer) clearTimeout(_heroResetTimer);
        _heroResetTimer = setTimeout(() => {
            animateHeroTitle(window.__t('hero_line_1', 'Got a spicy idea?'));
            _heroResetTimer = null;
        }, 3000);
    }
    // ─────────────────────────────────────────────────────────────────────

    function toggleGenerateLoading(isLoading) {
        const editorControls = [
            ...Array.from(document.querySelectorAll('.preview-unified-header button, .preview-unified-header select, .preview-unified-header input')),
            ...Array.from(document.querySelectorAll('#editor-tools-panel button, #editor-tools-panel select, #editor-tools-panel input, #editor-minimap button'))
        ];

        if (isLoading) {
            // Keep temaInput enabled so user can write while generating
            if (temaInput) temaInput.disabled = false;

            // Keep generateBtn enabled and flag it as active generation (so it acts as stop button)
            if (generateBtn) {
                generateBtn.classList.add('is-generating');
                generateBtn.disabled = false;
            }
            if (typeof modeBtn !== 'undefined' && modeBtn) modeBtn.disabled = true;
            if (typeof langBtn !== 'undefined' && langBtn) langBtn.disabled = true;
            if (typeof btnAttachFile !== 'undefined' && btnAttachFile) btnAttachFile.disabled = true;

            stopTypewriter();
            startBtnMessages();

            document.querySelectorAll('.suggestion-pill, .file-chip-remove').forEach(el => el.disabled = true);

            // Disable editor buttons/controls during generation
            editorControls.forEach(ctrl => { if (ctrl) ctrl.disabled = true; });
        } else {
            // Force hide all thinking loaders in the DOM when loading stops
            document.querySelectorAll('.chat-thinking').forEach(el => el.classList.add('hidden'));

            if (temaInput) temaInput.disabled = false;

            if (generateBtn) {
                generateBtn.classList.remove('is-generating');
            }
            if (typeof validateGenerateButton === 'function') validateGenerateButton();
            if (typeof modeBtn !== 'undefined' && modeBtn) { if (!window._attachedFiles || window._attachedFiles.length === 0) modeBtn.disabled = false; }
            if (typeof langBtn !== 'undefined' && langBtn) langBtn.disabled = false;
            if (typeof btnAttachFile !== 'undefined' && btnAttachFile) btnAttachFile.disabled = false;

            if (typewriterCursor) typewriterCursor.style.display = '';
            stopBtnMessages();

            document.querySelectorAll('.suggestion-pill, .file-chip-remove').forEach(el => el.disabled = false);

            // Enable editor buttons/controls after generation (or error)
            editorControls.forEach(ctrl => { if (ctrl) ctrl.disabled = false; });

            // Native textarea placeholder handles empty state.
            if (typeof updateZoomDisplay === 'function') updateZoomDisplay();
        }
    }

    function resetPreviewSurface() {
        window.removeEventListener('resize', scaleIframe);

        minimapAlreadyInit = false;
        toolsAlreadyInit = false;
        const rawIframe = previewIframe.cloneNode();
        previewIframe.parentNode.replaceChild(rawIframe, previewIframe);
        previewIframe = rawIframe;

        const minimapList = document.getElementById('minimap-list');
        if (minimapList) {
            minimapList.innerHTML = '';
            minimapList.style.transform = 'none';
            const mmContainer = document.getElementById('editor-minimap');
            if (mmContainer) {
                mmContainer.style.removeProperty('--presentation-accent');
                mmContainer.style.removeProperty('--accent');
            }
        }

        if (slideDots) slideDots.innerHTML = '';
        slideContainer = null;
        _refreshSlotOverlays = null;
        _overlayMap = new Map();
    }

    function setPreviewTitle(title) {
        const previewLabel = document.getElementById('preview-topic-label');
        if (!previewLabel) return;

        if (previewLabel.tagName === 'INPUT') previewLabel.value = title;
        else previewLabel.textContent = title;
    }

    function extractPreviewTitleFromHtml(html, fallbackTitle = 'Debug Canvas') {
        if (!html || typeof html !== 'string') return fallbackTitle;

        const configMatch = html.match(/<!--\s*CONFIG\s*([\s\S]*?)\s*-->/i);
        if (configMatch) {
            try {
                const configObj = JSON.parse(configMatch[1]);
                if (configObj.Clean_Topic) return configObj.Clean_Topic;
                if (configObj.topic) return configObj.topic;
            } catch (e) { }
        }

        const titleMatch = html.match(/<title>\s*(.*?)\s*<\/title>/i);
        if (titleMatch && titleMatch[1]) return titleMatch[1];

        const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (h1Match && h1Match[1]) {
            const cleanTitle = h1Match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (cleanTitle) return cleanTitle;
        }

        return fallbackTitle;
    }

    function openPreviewFromExistingHtml(html, title) {
        if (!html || typeof html !== 'string') {
            throw new Error('Debug HTML is empty or invalid.');
        }

        // Set the hash to #editor so back button and warnings work flawlessly in debug mode
        if (window.location.hash !== '#editor') {
            window.navigateToEditor();
        }

        generatedHtml = html;
        currentSlide = 0;
        totalSlides = 0;
        window.currentSlide = 0;
        currentTitle = title;
        _pendingTransitionFn = null;
        window._manualZoomScale = 1;
        updateZoomDisplay();

        if (resultContainer) resultContainer.classList.add('hidden');
        if (errorContainer) errorContainer.classList.add('hidden');
        if (refusedContainer) refusedContainer.classList.add('hidden');

        previewContainer.classList.remove('hidden', 'is-generating', 'is-settling', 'is-editor-ready', 'reveal-sequence', 'reveal-minimap', 'reveal-tools', 'reveal-chrome');
        chatScreen.style.cssText = '';
        chatScreen.classList.add('hidden');
        document.body.classList.add('no-scroll');

        resetPreviewSurface();
        setPreviewTitle(title);

        slideLabel.textContent = '1 / 1';
        updateMinimapSkeleton(1);

        previewHeader.classList.remove('slide-down');
        initPreview(html, () => {
            previewContainer.classList.remove('is-generating', 'is-settling', 'is-editor-ready', 'reveal-sequence', 'reveal-minimap', 'reveal-tools');
            previewHeader.classList.add('slide-down');
            // Apply settled insets so the slide centers between panels in debug mode.
            if (window.innerWidth > 768) {
                _editorInsets = { left: 165, right: 30, top: 64, bottom: 64 };
                const dbgStage = document.getElementById('preview-stage');
                if (dbgStage) {
                    dbgStage.style.paddingLeft = '165px';
                    dbgStage.style.paddingRight = '30px';
                    dbgStage.style.paddingTop = '64px';
                    dbgStage.style.paddingBottom = '64px';
                }
            }
            previewContainer.classList.add('is-editor-ready');
            scaleIframe();
        });
    }

    async function openLastGeneratedDebugCanvas() {
        if (debugLastGeneratedBtn) debugLastGeneratedBtn.disabled = true;

        try {
            const response = await fetch('/__dev__/last-generated', { cache: 'no-store' });
            if (!response.ok) {
                throw new Error('No debug HTML available in tmp/last_generated.html.');
            }

            const html = await response.text();
            const title = extractPreviewTitleFromHtml(html, 'Debug Canvas');
            openPreviewFromExistingHtml(html, title);
        } catch (error) {
            if (previewContainer) previewContainer.classList.add('hidden');
            if (chatScreen) {
                chatScreen.style.cssText = '';
                chatScreen.classList.remove('hidden');
            }
            if (errorMessage) errorMessage.textContent = error.message;
            if (errorContainer) showErrorModal(() => resetUI());
            document.body.classList.remove('no-scroll');
        } finally {
            if (debugLastGeneratedBtn) debugLastGeneratedBtn.disabled = false;
        }
    }

    async function setupDevelopmentDebugMode() {
        // Only run on localhost — never inject anything in production
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (!isLocal) return;

        try {
            const response = await fetch('/__dev__/last-generated', { method: 'HEAD', cache: 'no-store' });
            if (!response.ok) return;

            // Create the button dynamically so it never ships in the production HTML
            debugLastGeneratedBtn = document.createElement('button');
            debugLastGeneratedBtn.type = 'button';
            debugLastGeneratedBtn.id = 'btn-debug-last-generated';
            debugLastGeneratedBtn.className = 'action-icon-btn';
            debugLastGeneratedBtn.title = 'Load last generated HTML (Dev only)';
            debugLastGeneratedBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>`;

            // Insert before the attach-file button
            const btnAttachFileEl = document.getElementById('btn-attach-file');
            if (btnAttachFileEl) {
                btnAttachFileEl.parentElement.insertBefore(debugLastGeneratedBtn, btnAttachFileEl);
            }

            debugLastGeneratedBtn.addEventListener('click', () => openLastGeneratedDebugCanvas());

            const params = new URLSearchParams(window.location.search);
            if (params.get('debug') === 'last') {
                openLastGeneratedDebugCanvas();
            }
        } catch (error) {
            // Endpoint unavailable — silently skip
        }
    }

    async function handleGenerate() {
        // If already generating, act as a CANCEL/STOP button!
        if (generateBtn && generateBtn.classList.contains('is-generating')) {
            console.log("Stopping active generation...");
            if (_skeletonGenController) {
                _skeletonGenController.abort();
                _skeletonGenController = null;
            }
            if (window.stopOutlineGeneration) {
                window.stopOutlineGeneration();
            }
            toggleGenerateLoading(false);
            return;
        }

        // Clean up any old error or cancelled messages inside the hardcoded first AI bubble to prevent them from stacking
        const firstAiResponse = document.getElementById('chat-ai-response');
        if (firstAiResponse) {
            firstAiResponse.querySelectorAll('.chat-proceed-message, .chat-cancelled-message, .chat-error-message').forEach(el => el.remove());
        }

        // Abort any previous in-flight skeleton generation
        if (_skeletonGenController) {
            _skeletonGenController.abort();
            _skeletonGenController = null;
        }

        // Push state immediately so the native back button works during the loading phase
        if (window.location.hash !== '#chat') {
            window.navigateToChat();
        }

        const tema = temaInput.value.trim();
        const hasFiles = window._attachedFiles && window._attachedFiles.length > 0;
        if (!tema && !hasFiles) {
            temaError.classList.add('visible');
            temaInput.focus();
            return;
        }
        temaError.classList.remove('visible');

        const finalTema = tema || (hasFiles ? (window.__t ? window.__t('default_document_prompt', 'Analyze this document and create a presentation') : 'Analyze this document and create a presentation') : '');

        const requestData = {
            tema: finalTema,
            mode: 'chat', // skeleton always draws from the chat rate-limit bucket
            ...(targetLanguage !== 'auto' ? { language: targetLanguage } : {})
        };

        const isFollowUpRequest = window.outlineEditorState && window.outlineEditorState.skeleton !== null;

        if (isFollowUpRequest) {
            requestData.currentSkeleton = JSON.stringify(window.outlineEditorState.skeleton);
            // Backup the current skeleton in case the next instruction is a "proceed/create" action
            window._backupSkeleton = JSON.parse(JSON.stringify(window.outlineEditorState.skeleton));
        } else {
            window._backupSkeleton = null;
        }

        toggleGenerateLoading(true);

        let bodyData;
        let headers = {};
        if (window._attachedFiles && window._attachedFiles.length > 0) {
            const formData = new FormData();
            formData.append('tema', requestData.tema);
            if (requestData.mode) formData.append('mode', requestData.mode);
            if (requestData.language) formData.append('language', requestData.language);
            if (requestData.slides !== undefined) formData.append('slides', requestData.slides);
            if (requestData.currentSkeleton) formData.append('currentSkeleton', requestData.currentSkeleton);
            window._attachedFiles.forEach(f => formData.append('files', f));
            bodyData = formData;
        } else {
            headers['Content-Type'] = 'application/json';
            bodyData = JSON.stringify(requestData);
        }

        const controller = new AbortController();
        _skeletonGenController = controller;

        if (window.showOutlineEditorLoading) {
            window.showOutlineEditorLoading(requestData.slides || 8);
        }

        // Before stream starts, prepare the outline streaming layout (fading pills, moving containers, etc.)
        if (window.prepareOutlineStreaming) {
            window.prepareOutlineStreaming(proModeEnabled ? 'pro' : 'flash');
        }

        // Only the very first request should mount the panel in the static
        // `#chat-ai-response` bubble. Follow-ups already create their own AI
        // bubble in `showOutlineEditorLoading()`, and re-targeting the static
        // bubble here makes the old top panel look like it is being reused.
        try {
            if (!isFollowUpRequest) {
                const _initialAiBody = document.querySelector('#chat-ai-response .chat-ai-body');
                if (_initialAiBody && window.AedosThinking) {
                    window.AedosThinking.show(_initialAiBody, {
                        label: window.__t ? window.__t('chat_thinking', 'Thinking…') : 'Thinking…',
                        stage: 'stage1'
                    });
                }
            }
        } catch (_) { /* panel is non-critical */ }

        try {
            const skeletonResponse = await fetch('/generate-skeleton', {
                method: 'POST',
                headers: headers,
                body: bodyData,
                signal: controller.signal
            });

            if (!skeletonResponse.ok) {
                const errData = await skeletonResponse.json().catch(() => ({}));
                const serverErr = errData.error || `Server error: ${skeletonResponse.status}`;
                throw new Error(serverErr);
            }

            const reader = skeletonResponse.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let rawText = '';
            let finalSkeleton = null;
            let sawSkeletonSseParseError = false;
            const _skeletonReasoningAiBody = (() => {
                const _aiMessages = document.querySelectorAll('.chat-msg-ai');
                const _latestAi = _aiMessages[_aiMessages.length - 1];
                return _latestAi && _latestAi.querySelector('.chat-ai-body');
            })();

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep last incomplete line in buffer

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6).trim();
                        if (!dataStr) continue;

                        try {
                            const data = JSON.parse(dataStr);
                            if (data.error) {
                                throw new Error(data.error);
                            }

                            // Reasoning tokens — surface in the thinking panel
                            // for the currently active AI bubble. The first
                            // request reuses the static #chat-ai-response;
                            // follow-ups work via showOutlineEditorLoading.
                            if (data.reasoning && typeof data.reasoning === 'string') {
                                const allAiBodies = document.querySelectorAll('.chat-msg-ai .chat-ai-body');
                                const _aiBody = allAiBodies[allAiBodies.length - 1];
                                if (_aiBody && window.AedosThinking) {
                                    // Lazily create the panel if a previous
                                    // legacy code path forgot to call show().
                                    if (!window.AedosThinking.getPanel(_aiBody)) {
                                        window.AedosThinking.show(_aiBody, {
                                            label: window.__t ? window.__t('chat_thinking', 'Thinking…') : 'Thinking…',
                                            stage: data.stage || 'stage1'
                                        });
                                    }
                                    window.AedosThinking.appendReasoning(_aiBody, data.reasoning);
                                }
                                continue;
                            }

                            if (data.chunk) {
                                rawText += data.chunk;
                                const partialSkeleton = window.parsePartialSkeleton(rawText);
                                if (window.outlineEditorState) {
                                    window.outlineEditorState.skeleton = partialSkeleton;
                                }
                                if (window.renderStreamingOutline) {
                                    window.renderStreamingOutline(partialSkeleton);
                                }

                                // Collapse the thinking panel (instead of
                                // hiding it) once the first slide starts
                                // streaming. The pill stays visible so the
                                // user can re-expand it to see what the
                                // model was thinking about.
                                if (partialSkeleton && partialSkeleton.slides && partialSkeleton.slides.length > 0) {
                                    if (window.AedosThinking) {
                                        window.AedosThinking.collapse(_skeletonReasoningAiBody);
                                    }
                                    // Legacy fall-back: also hide the old
                                    // dot loader if it's still around.
                                    const aiMessages = document.querySelectorAll('.chat-msg-ai');
                                    const latestAiMessage = aiMessages[aiMessages.length - 1];
                                    if (latestAiMessage) {
                                        const thinking = latestAiMessage.querySelector('.chat-thinking');
                                        if (thinking) thinking.classList.add('hidden');
                                    }
                                }
                            }
                            if (data.done) {
                                finalSkeleton = data.skeleton;
                            }
                        } catch (e) {
                            sawSkeletonSseParseError = true;
                            console.error('SSE JSON error:', e);
                            if (e.message && (e.message.includes('Limit') || e.message.includes('pressure') || e.message.includes('failed') || e.message.includes('REJECTED'))) {
                                throw e;
                            }
                        }
                    }
                }
            }

            // The skeleton fetch stream is complete. Free the skeleton controller safely.
            _skeletonGenController = null;

            window._pendingGenerateBodyData = bodyData;
            window._pendingGenerateHeaders = headers;

            toggleGenerateLoading(false);

            if (!finalSkeleton) {
                finalSkeleton = window.parsePartialSkeleton(rawText);
            }

            const hasRenderableSkeleton = !!(
                finalSkeleton &&
                Array.isArray(finalSkeleton.slides) &&
                finalSkeleton.slides.length > 0
            );

            if (!hasRenderableSkeleton && (!finalSkeleton || !finalSkeleton.action)) {
                const streamWasInterrupted = sawSkeletonSseParseError || rawText.trim().length > 0 || !finalSkeleton;
                if (streamWasInterrupted) {
                    throw new Error(
                        window.__t
                            ? window.__t('outline_stream_interrupted', 'The outline response was interrupted. Please try again.')
                            : 'The outline response was interrupted. Please try again.'
                    );
                }
            }

            // Only hide the panel when nothing useful arrived. If the model
            // streamed reasoning successfully, keep it collapsed so the chat
            // does not look empty after a recoverable failure.
            if (window.AedosThinking) {
                if (!hasRenderableSkeleton) {
                    if (!finalSkeleton || !finalSkeleton.action) {
                        if (window.AedosThinking.hasReasoning && window.AedosThinking.hasReasoning(_skeletonReasoningAiBody)) {
                            window.AedosThinking.collapse(_skeletonReasoningAiBody);
                        } else {
                            window.AedosThinking.hide(_skeletonReasoningAiBody);
                        }
                    }
                } else if (finalSkeleton.action === 'proceed') {
                    // Proceed flow: collapse (not hide) the panel and let
                    // the "Drafting slides…" message take over visually.
                    window.AedosThinking.collapse(_skeletonReasoningAiBody);
                }
            }

            // Intention Parser Interception
            if (finalSkeleton && finalSkeleton.action === 'proceed') {
                const aiMessages = document.querySelectorAll('.chat-msg-ai');
                const latestAiMessage = aiMessages[aiMessages.length - 1];
                if (latestAiMessage) {
                    const thinking = latestAiMessage.querySelector('.chat-thinking');
                    if (thinking) thinking.classList.add('hidden');

                    const aiBody = latestAiMessage.querySelector('.chat-ai-body');
                    if (aiBody) {
                        const progressMsg = document.createElement('div');
                        progressMsg.className = 'chat-proceed-message';
                        progressMsg.style.cssText = 'padding: 0.8rem 1rem; color: var(--text); font-weight: 500; font-family: var(--font-body); display: flex; align-items: center; gap: 0.5rem;';
                        
                        const textSpan = document.createElement('span');
                        textSpan.textContent = window.__t ? window.__t('chat_proceeding_1', 'Analyzing request...') : 'Analyzing request...';
                        
                        progressMsg.innerHTML = `<span style="color: var(--accent); font-size: 1.2rem; display: inline-block;" class="loading-spinner">⟳</span>`;
                        progressMsg.appendChild(textSpan);
                        aiBody.appendChild(progressMsg);
                        
                        // GSAP premium entrance animation for proceed loading message
                        if (window.gsap) {
                            window.gsap.fromTo(progressMsg, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
                        }

                        const spinner = progressMsg.querySelector('.loading-spinner');
                        if (spinner && spinner.animate) {
                            spinner.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 1500, iterations: Infinity });
                        }

                        const msgs = [
                            window.__t ? window.__t('chat_proceeding_2', 'Drafting slides...') : 'Drafting slides...',
                            window.__t ? window.__t('chat_proceeding_3', 'Structuring narrative...') : 'Structuring narrative...',
                            window.__t ? window.__t('chat_proceeding_4', 'Finding visual assets...') : 'Finding visual assets...',
                            window.__t ? window.__t('chat_proceeding_5', 'Polishing layout...') : 'Polishing layout...'
                        ];
                        let msgIdx = 0;
                        if (window._proceedMsgInterval) {
                            clearInterval(window._proceedMsgInterval);
                        }
                        window._proceedMsgInterval = setInterval(() => {
                            if (!document.body.contains(progressMsg) || document.body.classList.contains('no-scroll')) {
                                clearInterval(window._proceedMsgInterval);
                                window._proceedMsgInterval = null;
                                return;
                            }
                            if (window.gsap) {
                                window.gsap.to(textSpan, {
                                    opacity: 0,
                                    y: -4,
                                    duration: 0.25,
                                    onComplete: () => {
                                        textSpan.textContent = msgs[msgIdx % msgs.length];
                                        window.gsap.fromTo(textSpan, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' });
                                        msgIdx++;
                                    }
                                });
                            } else {
                                textSpan.style.opacity = 0;
                                setTimeout(() => {
                                    textSpan.textContent = msgs[msgIdx % msgs.length];
                                    textSpan.style.opacity = 1;
                                    msgIdx++;
                                }, 200);
                            }
                        }, 2500);
                    }
                }

                // Clean up split outline layout and proceed directly
                document.body.classList.remove('split-outline-active');
                
                if (window.startFinalGeneration) {
                    let finalSkeletonObj = (window.outlineEditorState && window.outlineEditorState.skeleton) 
                        ? window.outlineEditorState.skeleton 
                        : finalSkeleton;

                    // If proceeding and the streaming skeleton was empty or parsed as empty, restore from the backup
                    if (window._backupSkeleton && (!finalSkeletonObj || !finalSkeletonObj.slides || finalSkeletonObj.slides.length === 0)) {
                        if (window.outlineEditorState) {
                            window.outlineEditorState.skeleton = window._backupSkeleton;
                        }
                        finalSkeletonObj = window._backupSkeleton;
                    }
                    window.startFinalGeneration(finalSkeletonObj);
                }
                return;
            }

            if (window.finalizeStreamingOutline) {
                window.finalizeStreamingOutline(finalSkeleton);
            } else {
                throw new Error("Outline editor not initialized");
            }
        } catch (error) {
            if (_skeletonGenController && controller !== _skeletonGenController) {
                console.log("Ignoring obsolete skeleton generation error/abort");
                return;
            }
            toggleGenerateLoading(false);
            if (window.outlineEditorState) {
                window.outlineEditorState.isLoading = false;
            }

            const isAbort = error.name === 'AbortError' || error.message?.toLowerCase().includes('abort');

            // Find the latest active AI bubble in the conversation zone to avoid appending to legacy items
            const aiBubbles = document.querySelectorAll('.chat-msg-ai');
            const latestAiBubble = aiBubbles[aiBubbles.length - 1];

            if (latestAiBubble) {
                // Clean up thinking loader in the latest active AI bubble to prevent hanging infinite loader
                const thinking = latestAiBubble.querySelector('.chat-thinking');
                if (thinking) thinking.classList.add('hidden');

                const aiBody = latestAiBubble.querySelector('.chat-ai-body');
                if (aiBody) {
                    // Preserve the reasoning pill on recoverable errors so the
                    // bubble does not look empty. Aborts still remove it.
                    if (window.AedosThinking) {
                        const preserveThinking =
                            !isAbort &&
                            window.AedosThinking.hasReasoning &&
                            window.AedosThinking.hasReasoning(aiBody);
                        if (preserveThinking) {
                            window.AedosThinking.collapse(aiBody);
                        } else {
                            window.AedosThinking.hide(aiBody);
                        }
                    }

                    aiBody.querySelectorAll('.chat-proceed-message, .chat-error-message, .chat-cancelled-message').forEach(el => el.remove());

                    const errEl = document.createElement('div');
                    if (isAbort) {
                        errEl.className = 'chat-cancelled-message';
                        const cancelText = window.__t ? window.__t('generation_cancelled', 'Generation cancelled by user') : 'Generation cancelled by user';
                        errEl.textContent = cancelText;
                    } else {
                        errEl.className = 'chat-error-message';
                        errEl.style.cssText = "color: var(--danger); font-weight: 500; display: flex; align-items: center; gap: 0.5rem; margin-top: 1rem;";
                        errEl.innerHTML = `<span>⚠</span> <span>${escapeHtml(error.message)}</span>`;
                    }
                    aiBody.appendChild(errEl);
                    
                    if (window.gsap) {
                        window.gsap.fromTo(errEl, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3 });
                    }
                }
            } else {
                // Fallback for ID-based first bubble cleanup
                const thinking = document.getElementById('chat-thinking');
                if (thinking) thinking.classList.add('hidden');
            }

            if (!isAbort) {
                if (errorMessage) errorMessage.textContent = error.message;
                showErrorModal(() => {
                    const outlineContainer = document.getElementById('outline-container');
                    if (outlineContainer) outlineContainer.classList.add('hidden');
                    const backdrop = document.getElementById('outline-backdrop');
                    if (backdrop) backdrop.classList.remove('active');
                    const edgeTab = document.getElementById('outline-edge-tab');
                    if (edgeTab) edgeTab.classList.add('hidden');
                });
            }
        }
    }

    // Direct proceed shortcut: when the user explicitly approves the outline via the
    // primary "Looks good! Create presentation" chip, skip the AI skeleton analysis and
    // immediately start the final generation. This saves a request + tokens that would
    // otherwise be spent re-asking the model to detect the proceed intent from
    // "Todo listo! Crear presentación".
    window.proceedWithCurrentOutline = function() {
        if (window._activeGenController) {
            console.warn("A generation is already in progress. Ignoring proceed request.");
            return;
        }
        if (_skeletonGenController) {
            _skeletonGenController.abort();
            _skeletonGenController = null;
        }

        const skeleton = (window.outlineEditorState && window.outlineEditorState.skeleton)
            ? window.outlineEditorState.skeleton
            : null;
        if (!skeleton || !Array.isArray(skeleton.slides) || skeleton.slides.length === 0) {
            console.warn("proceedWithCurrentOutline: no outline available to proceed with.");
            return;
        }

        if (window.location.hash !== '#chat') {
            window.navigateToChat();
        }

        // Build the same body/headers that handleGenerate would build for the
        // /generate-skeleton call. startFinalGeneration reuses these for /generate.
        const tema = (temaInput && temaInput.value ? temaInput.value.trim() : '') ||
            (window.__t ? window.__t('default_document_prompt', 'Analyze this document and create a presentation') : 'Analyze this document and create a presentation');
        const requestData = {
            tema,
            mode: 'chat',
            ...(targetLanguage !== 'auto' ? { language: targetLanguage } : {})
        };
        requestData.currentSkeleton = JSON.stringify(skeleton);

        let bodyData;
        let headers = {};
        if (window._attachedFiles && window._attachedFiles.length > 0) {
            const formData = new FormData();
            formData.append('tema', requestData.tema);
            if (requestData.mode) formData.append('mode', requestData.mode);
            if (requestData.language) formData.append('language', requestData.language);
            if (requestData.slides !== undefined) formData.append('slides', requestData.slides);
            if (requestData.currentSkeleton) formData.append('currentSkeleton', requestData.currentSkeleton);
            window._attachedFiles.forEach(f => formData.append('files', f));
            bodyData = formData;
        } else {
            headers['Content-Type'] = 'application/json';
            bodyData = JSON.stringify(requestData);
        }

        window._pendingGenerateBodyData = bodyData;
        window._pendingGenerateHeaders = headers;

        // Lock outline editor buttons while the final generation runs
        const btnGen = document.getElementById('btn-outline-generate');
        const btnAdd = document.getElementById('btn-outline-add-slide');
        if (btnGen) btnGen.disabled = true;
        if (btnAdd) btnAdd.disabled = true;

        // Mirror the normal "user sent a message" behavior: clear the chip row and
        // any pending chip render so the user can't fire another request mid-flight.
        const chipsContainer = document.getElementById('outline-suggested-chips');
        if (chipsContainer) {
            chipsContainer.innerHTML = '';
            if (window._chipsRenderTimeout) {
                clearTimeout(window._chipsRenderTimeout);
                window._chipsRenderTimeout = null;
            }
        }
        document.querySelectorAll('.suggested-chip').forEach(el => { el.disabled = true; });

        // Mirror the proceed loading UI normally rendered after the AI returns proceed
        const aiMessages = document.querySelectorAll('.chat-msg-ai');
        const latestAiMessage = aiMessages[aiMessages.length - 1];
        if (latestAiMessage) {
            const thinking = latestAiMessage.querySelector('.chat-thinking');
            if (thinking) thinking.classList.add('hidden');

            const aiBody = latestAiMessage.querySelector('.chat-ai-body');
            if (aiBody) {
                aiBody.querySelectorAll('.chat-proceed-message').forEach(el => el.remove());

                const progressMsg = document.createElement('div');
                progressMsg.className = 'chat-proceed-message';
                progressMsg.style.cssText = 'padding: 0.8rem 1rem; color: var(--text); font-weight: 500; font-family: var(--font-body); display: flex; align-items: center; gap: 0.5rem;';

                const textSpan = document.createElement('span');
                textSpan.textContent = window.__t ? window.__t('chat_proceeding_1', 'Analyzing request...') : 'Analyzing request...';

                progressMsg.innerHTML = `<span style="color: var(--accent); font-size: 1.2rem; display: inline-block;" class="loading-spinner">⟳</span>`;
                progressMsg.appendChild(textSpan);
                aiBody.appendChild(progressMsg);

                // Activate (or reactivate) the new Claude-style thinking panel
                // for the proceed flow. Stages 1 and 2 (content + design) are
                // non-streaming on the server, but the server still emits
                // reasoning tokens that we'll pipe into this panel. Once Stage
                // 3 starts, the panel collapses into a "Thought for Ns" pill.
                if (window.AedosThinking) {
                    window.AedosThinking.show(aiBody, {
                        label: window.__t ? window.__t('chat_proceeding_1', 'Analyzing request…') : 'Analyzing request…',
                        stage: proModeEnabled ? 'stage1' : 'flash'
                    });
                }

                if (window.gsap) {
                    window.gsap.fromTo(progressMsg, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
                }

                const spinner = progressMsg.querySelector('.loading-spinner');
                if (spinner && spinner.animate) {
                    spinner.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 1500, iterations: Infinity });
                }

                const msgs = [
                    window.__t ? window.__t('chat_proceeding_2', 'Drafting slides...') : 'Drafting slides...',
                    window.__t ? window.__t('chat_proceeding_3', 'Structuring narrative...') : 'Structuring narrative...',
                    window.__t ? window.__t('chat_proceeding_4', 'Finding visual assets...') : 'Finding visual assets...',
                    window.__t ? window.__t('chat_proceeding_5', 'Polishing layout...') : 'Polishing layout...'
                ];
                let msgIdx = 0;
                if (window._proceedMsgInterval) {
                    clearInterval(window._proceedMsgInterval);
                }
                window._proceedMsgInterval = setInterval(() => {
                    if (!document.body.contains(progressMsg) || document.body.classList.contains('no-scroll')) {
                        clearInterval(window._proceedMsgInterval);
                        window._proceedMsgInterval = null;
                        return;
                    }
                    if (window.gsap) {
                        window.gsap.to(textSpan, {
                            opacity: 0,
                            y: -4,
                            duration: 0.25,
                            onComplete: () => {
                                textSpan.textContent = msgs[msgIdx % msgs.length];
                                window.gsap.fromTo(textSpan, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' });
                                msgIdx++;
                            }
                        });
                    } else {
                        textSpan.style.opacity = 0;
                        setTimeout(() => {
                            textSpan.textContent = msgs[msgIdx % msgs.length];
                            textSpan.style.opacity = 1;
                            msgIdx++;
                        }, 200);
                    }
                }, 2500);
            }
        }

        document.body.classList.remove('split-outline-active');

        if (window.startFinalGeneration) {
            window.startFinalGeneration(skeleton);
        }
    };

    window.startFinalGeneration = async function (skeleton) {
        // Keep hash as #chat during loading, we will only transition to #editor when the first chunk arrives!

        generatedHtml = ''; // Reset state for a fresh start
        currentSlide = 0;
        totalSlides = 0;

        // Keep the send button in the generation (stop-icon) state during the final HTML
        // generation, regardless of whether we got here via a chat "proceed" or via the
        // outline "Create Presentation" button. The finally block below calls
        // toggleGenerateLoading(false) to clear it once streaming settles.
        const btnGenerateSend = document.getElementById('btn-generate');
        if (btnGenerateSend) {
            btnGenerateSend.classList.add('is-generating');
            btnGenerateSend.disabled = false;
        }
        const btnLangSend = document.getElementById('btn-lang-dropdown');
        if (btnLangSend) btnLangSend.disabled = true;

        window.removeEventListener('resize', scaleIframe); // evita acumulación

        // Transition: called once on first AI chunk, slides from chat → live skeleton
        let _hasTransitioned = false;
        function doTransitionToPreview() {
            if (_hasTransitioned) return;
            _hasTransitioned = true;
            stopBtnMessages();

            // Only transition the URL to #editor now that the editor has actually loaded!
            if (window.location.hash !== '#editor') {
                window.navigateToEditor();
            }

            // Clean up split outline layout and reset hero
            document.body.classList.remove('split-outline-active');
            const btnOutlineGenerate = document.getElementById('btn-outline-generate');
            if (btnOutlineGenerate) {
                btnOutlineGenerate.classList.remove('is-generating');
            }
            const heroTextSpan = document.querySelector('.hero-title-text');
            if (heroTextSpan && heroTextSpan.getAttribute('data-original-text')) {
                heroTextSpan.textContent = heroTextSpan.getAttribute('data-original-text');
                heroTextSpan.parentElement.classList.remove('waiting-state');
            }

            // Fade chat screen out (it's covered by fixed preview-container, but still clean)
            chatScreen.style.cssText = 'opacity:0;transition:opacity 0.35s ease;pointer-events:none;';
            setTimeout(() => {
                chatScreen.classList.add('hidden');
                chatScreen.style.cssText = '';
            }, 380);
            // Reveal preview (sectionFadeIn animation kicks in automatically)
            previewHeader.classList.remove('slide-down');
            previewContainer.classList.remove('hidden', 'reveal-chrome', 'reveal-sequence', 'reveal-minimap', 'reveal-tools', 'is-editor-ready');
            previewContainer.classList.add('is-generating');
            document.body.classList.add('no-scroll');

            // Kill any in-progress settling tween from a previous generation so its
            // onComplete never fires showFloatingPills during the new streaming session.
            if (_settlingAnimation) { _settlingAnimation.kill(); _settlingAnimation = null; }

            // Reset panel insets so slide fills the full screen during streaming.
            _editorInsets = { left: 0, right: 0, top: 0, bottom: 0 };
            resetMobileZoomState();
            window._manualZoomScale = 1;
            updateZoomDisplay();
            const _scrollableReset = document.getElementById('preview-wrapper-scrollable');
            if (_scrollableReset) _scrollableReset.style.transform = '';
            // Clear any leftover inline stage padding from the previous settling animation
            // (CSS `is-generating .preview-stage { padding:0 !important }` also covers this).
            clearStageInlinePadding();

            // Double-rAF: the first rAF triggers style recalculation after display:none→flex;
            // the second rAF fires after layout is fully computed so getBoundingClientRect
            // returns accurate dimensions.
            requestAnimationFrame(() => requestAnimationFrame(() => {
                scaleIframe();
                // Extra safety: call once more after 300ms in case the iframe resizes on load.
                setTimeout(scaleIframe, 300);
            }));
            window.addEventListener('resize', scaleIframe);
        }

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
        <link rel="stylesheet" href="/editor/editor.css?v=3">
        <script src="/editor/editor.js?v=3"></script>
        `;

        const tema = document.getElementById('w-tema').value.trim();
        const previewLabel = document.getElementById('preview-topic-label');
        if (previewLabel) {
            if (previewLabel.tagName === 'INPUT') previewLabel.value = tema;
            else previewLabel.textContent = tema;
        }

        slideLabel.textContent = "1 / 1";
        updateMinimapSkeleton(1);

        // Activate the new Claude-style thinking panel BEFORE the network
        // request goes out so the user sees the elapsed-time counter from
        // the very first moment. The panel auto-expands as soon as reasoning
        // tokens arrive and collapses once the HTML stream begins.
        try {
            const _aiMessages = document.querySelectorAll('.chat-msg-ai');
            const _latestAi = _aiMessages[_aiMessages.length - 1];
            const _aiBody = _latestAi && _latestAi.querySelector('.chat-ai-body');
            if (_aiBody && window.AedosThinking) {
                window.AedosThinking.show(_aiBody, {
                    label: proModeEnabled
                        ? (window.__t ? window.__t('chat_proceeding_1', 'Analyzing request…') : 'Analyzing request…')
                        : (window.__t ? window.__t('chat_thinking', 'Thinking…') : 'Thinking…'),
                    stage: proModeEnabled ? 'stage1' : 'flash'
                });
            }
        } catch (_) { /* non-critical */ }

        try {
            if (_activeGenController) {
                console.warn("A generation is already in progress. Ignoring duplicate request.");
                return;
            }
            
            const controller = new AbortController();
            _activeGenController = controller;

            let bodyData = window._pendingGenerateBodyData;
            let headers = window._pendingGenerateHeaders || {};

            // Bug #3: Clone body data so we don't mutate the original FormData/JSON
            // (multiple retries would otherwise accumulate extra 'skeleton' fields)
            if (bodyData instanceof FormData) {
                const cloned = new FormData();
                for (const [key, val] of bodyData.entries()) {
                    if (key !== 'files' && key !== 'mode') {
                        cloned.append(key, val);
                    }
                }
                // Restore actual generation mode (skeleton was tagged 'chat' for rate limiting)
                if (proModeEnabled) cloned.append('mode', 'pro');
                cloned.append('skeleton', JSON.stringify(skeleton));
                bodyData = cloned;
            } else {
                const parsed = JSON.parse(bodyData);
                parsed.skeleton = skeleton;
                // Restore actual generation mode (skeleton was tagged 'chat' for rate limiting)
                if (proModeEnabled) {
                    parsed.mode = 'pro';
                } else {
                    delete parsed.mode;
                }
                bodyData = JSON.stringify(parsed);
            }

            const response = await fetch('/generate', {
                method: 'POST',
                headers: headers,
                body: bodyData,
                signal: controller.signal
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const serverErr = errorData.error || `Server error: ${response.status}`;
                const retryAfter = Number(errorData.retryAfterSec);
                if (Number.isFinite(retryAfter) && retryAfter > 0) {
                    throw new Error(`${serverErr}|RETRY_AFTER=${retryAfter}`);
                }
                throw new Error(serverErr);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";
            let firstWrite = true;
            const _generateReasoningAiBody = (() => {
                const _aiMessages = document.querySelectorAll('.chat-msg-ai');
                const _latestAi = _aiMessages[_aiMessages.length - 1];
                return _latestAi && _latestAi.querySelector('.chat-ai-body');
            })();
            // Safety timeout: if no SSE data arrives within a period, abort to prevent
            // an infinite hang when the server closes without sending {done:true}.
            // Pro mode (3-stage pipeline) can take longer, so use a longer timeout that also
            // resets when we receive pipeline stage updates (not just HTML chunks).
            const SSE_WATCHDOG_MS = 600000; // 10 minutes total, enough for all 3 Pro stages
            let sseWatchdog;
            const resetWatchdog = () => {
                clearTimeout(sseWatchdog);
                sseWatchdog = setTimeout(() => {
                    uiLog.warn('STREAM', 'SSE watchdog fired without activity, cancelling reader', {
                        timeoutMs: SSE_WATCHDOG_MS
                    });
                    reader.cancel();
                }, SSE_WATCHDOG_MS);
            };
            resetWatchdog();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                resetWatchdog();

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
                                const msg = window.__t("queued_position", "Waiting in queue — position {pos}");
                                label.textContent = msg.replace('{pos}', parsed.position);
                            }
                            continue;
                        }
                        if (parsed.queued === false) {
                            resumeBtnMessages();
                            continue;
                        }

                        // Reasoning tokens stream — surface them in the new
                        // thinking panel. We use the latest AI bubble as the
                        // host (the same one that shows the "Drafting
                        // slides…" status text). For Pro mode, the server
                        // tags reasoning with a `stage` field so we can
                        // update the panel's accent color and label.
                        if (parsed.reasoning && typeof parsed.reasoning === 'string') {
                            const allAiBodies = document.querySelectorAll('.chat-msg-ai .chat-ai-body');
                            const _aiBody = allAiBodies[allAiBodies.length - 1];
                            if (_aiBody && window.AedosThinking) {
                                if (!window.AedosThinking.getPanel(_aiBody)) {
                                    const stageMap = {
                                        stage1: 'Analyzing request…',
                                        stage2: 'Designing visuals…',
                                        stage3: 'Composing slides…',
                                        flash: 'Drafting slides…'
                                    };
                                    const fallbackLabel = stageMap[parsed.stage] || 'Thinking…';
                                    window.AedosThinking.show(_aiBody, {
                                        label: window.__t ? window.__t('chat_thinking', fallbackLabel) : fallbackLabel,
                                        stage: parsed.stage || 'flash'
                                    });
                                }
                                window.AedosThinking.appendReasoning(_aiBody, parsed.reasoning);
                            }
                            continue;
                        }

                        // Pipeline stage progress events
                        if (parsed.pipeline) {
                            pauseBtnMessages();
                            let stageText;
                            if (parsed.status === 'retrying') {
                                // The AI returned bad JSON / missing fields and the
                                // server is retrying the same stage. Show a clear
                                // "retrying X/Y" message so the user understands the
                                // longer wait is on purpose, not a hang.
                                const tpl = window.__t
                                    ? window.__t('stage_retry', 'The AI stumbled — retrying ({attempt}/{maxAttempts})...')
                                    : 'The AI stumbled — retrying ({attempt}/{maxAttempts})...';
                                const attempt = Number.isFinite(parsed.attempt) ? parsed.attempt : '?';
                                const maxAttempts = Number.isFinite(parsed.maxAttempts) ? parsed.maxAttempts : '?';
                                stageText = tpl.replace('{attempt}', String(attempt)).replace('{maxAttempts}', String(maxAttempts));
                            } else {
                                const stageI18nKeys = {
                                    content: 'stage_content',
                                    design: 'stage_design',
                                    compositing: 'stage_compositing'
                                };
                                const stageFallbacks = {
                                    content: 'Analyzing content...',
                                    design: 'Resolving design...',
                                    compositing: 'Composing slides...'
                                };
                                const i18nKey = stageI18nKeys[parsed.stage];
                                stageText = i18nKey
                                    ? (window.__t ? window.__t(i18nKey, stageFallbacks[parsed.stage]) : stageFallbacks[parsed.stage])
                                    : parsed.stage;
                            }
                            // Update hero title animation
                            if (typeof animateHeroTitle === 'function') animateHeroTitle(stageText);
                            // Also update button label with premium GSAP fade-and-slide animation
                            const label = generateBtn.querySelector('.btn-generate-label');
                            if (label) {
                                if (window.gsap) {
                                    window.gsap.to(label, {
                                        opacity: 0,
                                        y: -5,
                                        duration: 0.2,
                                        onComplete: () => {
                                            label.textContent = stageText;
                                            window.gsap.fromTo(label, { opacity: 0, y: 5 }, { opacity: 1, y: 0, duration: 0.25, ease: 'power2.out' });
                                        }
                                    });
                                } else {
                                    label.textContent = stageText;
                                }
                            }
                            continue;
                        }

                        if (parsed.chunk) {
                            if (firstWrite) {
                                firstWrite = false;
                                _pendingTransitionFn = doTransitionToPreview;
                                // Collapse the thinking panel into a "Thought
                                // for Ns" pill now that the slides are about
                                // to render. The user can still re-expand
                                // the panel to read the model's reasoning.
                                if (window.AedosThinking) {
                                    window.AedosThinking.collapse(_generateReasoningAiBody);
                                }
                                iframeDoc.open();
                                const skelStyle = `
                                <style class="skeleton-injector">
                                    html {
                                        overflow: hidden !important;
                                    }
                                    html body {
                                        display: flex !important;
                                        flex-direction: row !important;
                                        width: max-content !important;
                                        height: 100% !important;
                                        margin: 0 !important;
                                        padding: 0 !important;
                                        gap: 0 !important;
                                        will-change: transform;
                                    }
                                    html section.s, html section[class*="slide"] {
                                        flex: 0 0 100vw !important;
                                        width: 100vw !important;
                                        max-width: 100vw !important;
                                        min-width: 100vw !important;
                                        height: 100% !important;
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
                            _stabilizeMinimapOnNextPreviewInit = false;
                            chatScreen.style.cssText = '';
                            chatScreen.classList.remove('hidden');
                            refusedMessage.textContent = parsed.message || (window.__t ? window.__t('refused_msg', "This topic cannot be generated.") : "This topic cannot be generated.");
                            refusedContainer.classList.remove('hidden');
                            previewContainer.classList.add('hidden');
                            iframeDoc.close();
                            toggleGenerateLoading(false);
                            // Reset title/subtitle to defaults for next generation error
                            const eTitleEl = document.getElementById('t-error-title');
                            if (eTitleEl) eTitleEl.setAttribute('data-i18n', 'error_title');
                            return;
                        }
                        if (parsed.error) {
                            throw new Error(parsed.error);
                        }
                        if (parsed.metadata) {
                            uiLog.info('GENERATION', 'Model Selected', { provider: parsed.metadata.provider, model: parsed.metadata.model });
                            continue;
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
                                        displayTitle = h1Match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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

            clearTimeout(sseWatchdog);

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
                throw new Error(window.__t ? window.__t('error_generation_failed', "Sorry, could not generate the presentation correctly.") : "Sorry, could not generate the presentation correctly.");
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

            // --- FLICKER GATE: Fade out briefly before final re-render ---
            const stage = document.getElementById('preview-stage');
            if (stage) stage.classList.add('flicker-mask');
            // Soft-regen keeps the minimap visible — don't flicker it.
            const minimapPanel = document.getElementById('editor-minimap');
            if (minimapPanel) minimapPanel.classList.add('flicker-mask');

            // Wait a tiny bit for the fade to start
            await new Promise(r => setTimeout(r, 100));

            // Reset init flags so setupPreviewInteractions reinits minimap+tools with new content.
            // We still clone here even on soft-regen: by this point streaming is finished, so
            // replacing the iframe does not disturb the surrounding editor chrome, and it gives
            // editor.js a fresh window so its one-time guards don't block re-initialization.
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

                    // Revealed the UI chrome with a cinematic sequence.
                    // Keep chrome hidden via is-settling during the GSAP shrink so
                    // panels only appear once the slide has fully settled.
                    previewContainer.classList.remove('is-generating');
                    previewContainer.classList.add('is-settling');

                    // CINEMATIC SHRINK: Tween _editorInsets from 0 to settled values.
                    // scaleIframe reads from this object every frame so the slide smoothly
                    // shrinks and re-centers into the area between the floating panels.
                    // No inline styles are set on the stage element — no CSS fights.
                    if (window.gsap && window.innerWidth > 768) {
                        _settlingAnimation = window.gsap.to(_editorInsets, {
                            left: 165,
                            right: 30,
                            top: 64,
                            bottom: 64,
                            duration: 1.2,
                            ease: "expo.out",
                            onUpdate: () => {
                                // Apply _editorInsets as stage padding so the flex container
                                // centers the slide within the panel-free area — no transform
                                // on the scrollable means no overflow-clipping bug.
                                const stageEl = document.getElementById('preview-stage');
                                if (stageEl) {
                                    stageEl.style.paddingLeft = `${_editorInsets.left}px`;
                                    stageEl.style.paddingRight = `${_editorInsets.right}px`;
                                    stageEl.style.paddingTop = `${_editorInsets.top}px`;
                                    stageEl.style.paddingBottom = `${_editorInsets.bottom}px`;
                                }
                                scaleIframe();
                            },
                            onStart: () => {
                                if (previewHeader) previewHeader.classList.add('slide-down');
                            },
                            onComplete: () => {
                                _settlingAnimation = null;
                                showFloatingPills();
                                scaleIframe();
                            }
                        });
                    } else {
                        if (window.innerWidth > 768) {
                            _editorInsets = { left: 165, right: 30, top: 64, bottom: 64 };
                            const fallbackStage = document.getElementById('preview-stage');
                            if (fallbackStage) {
                                fallbackStage.style.paddingLeft = '165px';
                                fallbackStage.style.paddingRight = '30px';
                                fallbackStage.style.paddingTop = '64px';
                                fallbackStage.style.paddingBottom = '64px';
                            }
                        }
                        if (previewHeader) previewHeader.classList.add('slide-down');

                        // Force immediate scale calculation for mobile/Safari to avoid black-out state
                        scaleIframe();
                        setTimeout(() => { showFloatingPills(); scaleIframe(); }, 800);
                    }

                    function showFloatingPills() {
                        previewContainer.classList.remove('is-settling');
                        previewContainer.classList.add('is-editor-ready');
                        // Reveal minimap via GSAP for a reliable, explicit opacity fade
                        // (avoids CSS transition timing edge-cases when is-settling is removed).
                        const mm = document.getElementById('editor-minimap');
                        if (mm) {
                            if (window.gsap) {
                                window.gsap.fromTo(mm, { opacity: 0 }, { opacity: 1, duration: 0.65, ease: 'power2.out' });
                            } else {
                                mm.style.opacity = '';
                            }
                        }
                        // NOTE: reveal-tools is intentionally NOT added.
                        // Right panel only opens when the user selects an element.
                    }
                }, 100);
            });

        } catch (error) {
            if (_activeGenController && _activeGenController.signal.aborted) {
                return;
            }
            _stabilizeMinimapOnNextPreviewInit = false;

            // Ignore intentional user cancellations (Back button)
            if (error.name === 'AbortError') {
                // Bug #17: clean up generating state even on abort
                const btnOutlineGenerate = document.getElementById('btn-outline-generate');
                if (btnOutlineGenerate) btnOutlineGenerate.classList.remove('is-generating');
                iframeDoc.close();
                return;
            }

            uiLog.error('GENERATION', 'Presentation generation failed', { error });

            const errTitle = document.getElementById('t-error-title');
            const errSubtitle = document.getElementById('t-error-subtitle');

            // Default titles/subtitles
            if (errTitle) errTitle.textContent = window.__t ? window.__t('error_title', "Something didn't go as planned") : "Something didn't go as planned";
            if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('error_subtitle', "The AI service is temporarily unavailable. This is usually resolved quickly.") : "The AI service is temporarily unavailable. This is usually resolved quickly.";

            const rawMsg = error.message || '';
            const retryAfterMatch = rawMsg.match(/\|RETRY_AFTER=(\d+)/);
            const retryAfterSec = retryAfterMatch ? parseInt(retryAfterMatch[1], 10) : null;
            const msg = rawMsg.replace(/\|RETRY_AFTER=\d+/, '');

            if (msg.includes('DAILY_LIMIT_EXCEEDED_FLASH') || msg.includes('DAILY_LIMIT_EXCEEDED_PRO') || msg.includes('DAILY_LIMIT_EXCEEDED_CHAT')) {
                if (errTitle) errTitle.textContent = window.__t ? window.__t('daily_limit_title', "You've reached today's limit") : "You've reached today's limit";
                if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('daily_limit_msg', "Free generations reset every 24 hours. Come back tomorrow or try again later.") : "Free generations reset every 24 hours. Come back tomorrow or try again later.";
            } else if (msg.includes('COOLDOWN_ACTIVE')) {
                if (errTitle) errTitle.textContent = window.__t ? window.__t('cooldown_title', "Wait a moment") : "Wait a moment";
                if (errSubtitle) {
                    if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
                        const tpl = window.__t
                            ? window.__t('cooldown_msg_with_seconds', "Please wait {sec}s before generating again.")
                            : "Please wait {sec}s before generating again.";
                        errSubtitle.textContent = tpl.replace('{sec}', String(retryAfterSec));
                    } else {
                        errSubtitle.textContent = window.__t ? window.__t('cooldown_msg', "Please wait at least one minute between generations.") : "Please wait at least one minute between generations.";
                    }
                }
            } else if (msg.includes('GLOBAL_DAILY_LIMIT_EXCEEDED')) {
                if (errTitle) errTitle.textContent = window.__t ? window.__t('global_daily_limit_title', "Today's global capacity was reached") : "Today's global capacity was reached";
                if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('global_daily_limit_msg', "The system reached its daily generation capacity. Please try again tomorrow.") : "The system reached its daily generation capacity. Please try again tomorrow.";
            } else if (msg.includes('QUEUE_FULL')) {
                if (errTitle) errTitle.textContent = window.__t ? window.__t('queue_full_title', "Queue is full right now") : "Queue is full right now";
                if (errSubtitle) {
                    if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
                        const tpl = window.__t
                            ? window.__t('queue_full_msg_with_seconds', "Too many simultaneous requests. Try again in {sec}s.")
                            : "Too many simultaneous requests. Try again in {sec}s.";
                        errSubtitle.textContent = tpl.replace('{sec}', String(retryAfterSec));
                    } else {
                        errSubtitle.textContent = window.__t ? window.__t('queue_full_msg', "Too many simultaneous requests. Try again in a few seconds.") : "Too many simultaneous requests. Try again in a few seconds.";
                    }
                }
            } else if (msg.includes('PRO_TEMPORARILY_PAUSED')) {
                if (errTitle) errTitle.textContent = window.__t ? window.__t('pro_paused_title', "Pro mode is temporarily paused") : "Pro mode is temporarily paused";
                if (errSubtitle) {
                    if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
                        const tpl = window.__t
                            ? window.__t('pro_paused_msg_with_seconds', "High load detected. Retry Pro mode in {sec}s or switch to Flash mode.")
                            : "High load detected. Retry Pro mode in {sec}s or switch to Flash mode.";
                        errSubtitle.textContent = tpl.replace('{sec}', String(retryAfterSec));
                    } else {
                        errSubtitle.textContent = window.__t ? window.__t('pro_paused_msg', "High load detected. Please retry Pro mode shortly or switch to Flash mode.") : "High load detected. Please retry Pro mode shortly or switch to Flash mode.";
                    }
                }
            } else if (msg.includes('RATE_LIMIT_EXCEEDED')) {
                if (errTitle) errTitle.textContent = window.__t ? window.__t('rate_limit_title', "Slow down a bit") : "Slow down a bit";
                if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('rate_limit_msg', "Too many requests in a short time. Wait a few minutes and try again.") : "Too many requests in a short time. Wait a few minutes and try again.";
            } else if (msg.includes('TOPIC_TOO_LONG')) {
                if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('topic_too_long', "The topic is too long. Keep it under 600 characters.") : "The topic is too long. Keep it under 600 characters.";
            } else if (msg.includes('SKELETON_EMPTY')) {
                if (errTitle) errTitle.textContent = window.__t ? window.__t('outline_empty_title', "Outline is empty") : "Outline is empty";
                if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('outline_empty_msg', "Please add at least one slide to your outline before generating.") : "Please add at least one slide to your outline before generating.";
            } else {
                // Try to extract "Please retry in X seconds" from Gemini standard errors
                let retryMsg = "";
                const retryMatch = msg.match(/retry in ([\d\.]+)s/i);
                if (retryMatch) {
                    const seconds = Math.ceil(parseFloat(retryMatch[1]));
                    const timeStr = seconds >= 60
                        ? `${Math.ceil(seconds / 60)} min`
                        : `${seconds}s`;
                    const retryTpl = window.__t ? window.__t(window.currentLang === 'es' ? 'retry_in_es' : 'retry_in_en', "<br><br><strong>Retry in: {time}</strong>") : "<br><br><strong>Retry in: {time}</strong>";
                    retryMsg = retryTpl.replace('{time}', timeStr);
                }

                if (msg.includes('429') || msg.includes('503') || msg.toLowerCase().includes('exhausted') || msg.toLowerCase().includes('saturated')) {
                    if (errTitle) errTitle.textContent = window.__t ? window.__t('overloaded_title', "High demand right now") : "High demand right now";
                    if (errSubtitle) {
                        errSubtitle.innerHTML = (window.__t ? window.__t('t-error-saturated', "The service is a bit overwhelmed at the moment. Usually clears up in a few minutes.") : "The service is a bit overwhelmed at the moment. Usually clears up in a few minutes.") + retryMsg;
                    }
                }
            }


            errorMessage.textContent = msg;
            previewContainer.classList.remove('is-generating', 'is-settling', 'is-editor-ready', 'reveal-sequence', 'reveal-minimap', 'reveal-tools');

            // Clean up split outline layout and reset hero
            document.body.classList.remove('split-outline-active');
            const btnOutlineGenerate = document.getElementById('btn-outline-generate');
            if (btnOutlineGenerate) {
                btnOutlineGenerate.classList.remove('is-generating');
            }
            const heroTextSpan = document.querySelector('.hero-title-text');
            if (heroTextSpan && heroTextSpan.getAttribute('data-original-text')) {
                heroTextSpan.textContent = heroTextSpan.getAttribute('data-original-text');
                heroTextSpan.parentElement.classList.remove('waiting-state');
            }
            // Clean up infinite loader/spinner in the chat bubbles to prevent hanging states on rate-limits
            if (window._proceedMsgInterval) {
                clearInterval(window._proceedMsgInterval);
                window._proceedMsgInterval = null;
            }
            const activeProceedMsg = document.querySelector('.chat-proceed-message');
            if (activeProceedMsg) {
                activeProceedMsg.innerHTML = `<span style="color: var(--danger); font-size: 1.2rem; display: inline-block;">⚠</span> <span style="color: var(--danger); font-weight: 500;">${window.__t ? window.__t('generation_failed_chat', 'Generation failed') : 'Generation failed'}: ${msg}</span>`;
                if (window.gsap) {
                    window.gsap.fromTo(activeProceedMsg, { opacity: 0 }, { opacity: 1, duration: 0.3 });
                }
            }
            // Clean up dynamic thinking loading state in the latest active AI bubble
            const aiBubbles = document.querySelectorAll('.chat-msg-ai');
            const latestAiBubble = aiBubbles[aiBubbles.length - 1];
            if (latestAiBubble) {
                const thinking = latestAiBubble.querySelector('.chat-thinking');
                if (thinking) thinking.classList.add('hidden');
            } else {
                const thinking = document.getElementById('chat-thinking');
                if (thinking) thinking.classList.add('hidden');
            }

            const outlineContainer = document.getElementById('outline-container');
            // FIX: Do NOT hide outlineContainer, backdrop, and edgeTab here.
            // If the user gets rate-limited, they should be able to keep their draft and try again.
            // if (outlineContainer) outlineContainer.classList.add('hidden');
            // const backdrop = document.getElementById('outline-backdrop');
            // if (backdrop) backdrop.classList.remove('active');
            // const edgeTab = document.getElementById('outline-edge-tab');
            // if (edgeTab) edgeTab.classList.add('hidden');

            // Clean up any in-progress chat→preview transition
            if (!_hasTransitioned) {
                chatScreen.style.cssText = '';
                chatScreen.classList.remove('hidden');
            }
            iframeDoc.close();
            // Show error overlay on top of whatever is visible; dismiss → go to home
            showErrorModal(() => {
                window.navigateToHome();
            });
        } finally {
            _activeGenController = null;
            toggleGenerateLoading(false);
            // Re-enable minimap skeleton updates for subsequent normal generations.
            _skipMinimapSkeleton = false;
            // is-generating is cleared by the reveal callback (success) or catch block (error).
            // Do NOT remove it here — that would cause panels to flash before the reveal animation.
            _pendingTransitionFn = null;
        }
    }

    generateBtn.addEventListener('click', () => handleGenerate());
    setupDevelopmentDebugMode();



    // Preview actions (Edit / Regenerate / Back)
    const btnBackToChat = document.getElementById('btn-back-to-chat');
    if (btnBackToChat) {
        btnBackToChat.addEventListener('click', () => {
            const msg = window.__t ? window.__t('confirm_exit_draft', 'Are you sure you want to go back? Your progress will be lost.') : 'Are you sure you want to go back? Your progress will be lost.';
            if (!confirm(msg)) return;

            if (_activeGenController) {
                _activeGenController.abort();
                _activeGenController = null;
            }
            
            window.navigateToHome();
            
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
                const temaInput = document.getElementById('w-tema');
                if (temaInput) temaInput.focus();
            }, 50);
        });
    }

    const btnEditTopic = document.getElementById('btn-edit-topic');
    if (btnEditTopic) {
        btnEditTopic.addEventListener('click', () => {
            const msg = window.__t ? window.__t('confirm_exit_draft', 'Are you sure you want to go back? Your progress will be lost.') : 'Are you sure you want to go back? Your progress will be lost.';
            if (!confirm(msg)) return;

            if (_activeGenController) {
                _activeGenController.abort();
                _activeGenController = null;
            }
            
            window.navigateToHome();
            
            setTimeout(() => {
                const temaInput = document.getElementById('w-tema');
                if (temaInput) temaInput.focus();
            }, 50);
        });
    }

    // =========================================================
    // 6. PREVIEW SYSTEM
    // =========================================================

    function initPreview(html, callback) {
        let setupDone = false;

        const doSetup = () => {
            if (setupDone) return;
            // Guard: if called before the HTML is parsed (e.g. triggered by the
            // about:blank load of the freshly-cloned iframe), bail out and let
            // the poll retry — do NOT set setupDone so the real load can win.
            const iDoc = previewIframe.contentDocument ||
                (previewIframe.contentWindow && previewIframe.contentWindow.document);
            if (iDoc && iDoc.body && findSlides(iDoc).length === 0) return;
            setupDone = true;

            // Safari iOS: safe repaint trigger using rAF + transform nudge.
            // Do NOT use display:none — Safari unloads iframe content on hide.
            try {
                requestAnimationFrame(() => {
                    previewIframe.style.willChange = 'transform';
                    requestAnimationFrame(() => {
                        previewIframe.style.willChange = '';
                    });
                });
            } catch (e) { }

            setupPreviewInteractions();
            if (typeof callback === 'function') callback();
        };

        if (html) {
            // Anti-flicker: Prevent scrollbars and margins during initial parse
            const antiFlicker = `<style id="anti-flicker">
                html, body { 
                    overflow: hidden !important; 
                    margin: 0 !important; 
                    padding: 0 !important; 
                }
            </style>`;
            if (!html.includes('anti-flicker')) {
                html = antiFlicker + html;
            }

            // Ensure editor scripts are always present
            if (!html.includes('editor.js')) {
                if (html.includes('</body>')) {
                    html = html.replace('</body>', '<link rel="stylesheet" href="/editor/editor.css?v=3"><script src="/editor/editor.js?v=3"></script></body>');
                } else {
                    html += '<link rel="stylesheet" href="/editor/editor.css?v=3"><script src="/editor/editor.js?v=3"></script>';
                }
            }
            // Strip all AI-generated googleapis link tags (may have malformed url() hrefs).
            // Both complete and partial/unclosed tags are removed so the correct G_FONTS
            // block below is always the sole font source.
            html = html.replace(/<link[^>]*fonts\.googleapis\.com[^>]*\/?>/gi, '');
            html = html.replace(/<link\b[^>]*fonts\.googleapis\.com[^>]*/gi, '');

            // Ensure fonts are present
            if (!html.includes('family=Archivo+Black')) {
                const G_FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap" rel="stylesheet">`;
                if (html.includes('<head>')) {
                    html = html.replace('<head>', '<head>' + G_FONTS);
                } else {
                    html = G_FONTS + html;
                }
            }

            // Safety Closer: If the AI output ends abruptly (e.g. cut off in mid-comment or mid-tag),
            // force-close them so they don't break the following scripts or icons.
            let safetyCloser = "";
            const openComments = (html.match(/<!--/g) || []).length;
            const closedComments = (html.match(/-->/g) || []).length;
            if (openComments > closedComments) safetyCloser += " -->";

            const openSections = (html.match(/<section/g) || []).length;
            const closedSections = (html.match(/<\/section>/g) || []).length;
            if (openSections > closedSections) safetyCloser += "</section>";

            if (!html.includes('</body>')) safetyCloser += "</body>";
            if (!html.includes('</html>')) safetyCloser += "</html>";

            if (safetyCloser) {
                html += safetyCloser;
            }

            const doc = previewIframe.contentDocument || previewIframe.contentWindow.document;
            // Call doc.open() first to cancel any pending about:blank navigation on
            // the freshly-cloned iframe before we attach the onload handler.
            // If onload were set before doc.open(), the blank-document load event
            // could fire our handler 300ms later on an empty document, setting
            // setupDone=true and permanently locking out the real setup.
            doc.open();

            // On some versions of Safari iOS, setting onload after doc.open can be flaky.
            // We use a combination of onload and an immediate next-tick check.
            const onIframeLoad = () => {
                if (setupDone) return;
                uiLog.debug('PREVIEW', 'Iframe load event or completion detected');
                setTimeout(doSetup, 300);
            };

            previewIframe.onload = onIframeLoad;

            doc.write('<!DOCTYPE html>' + html);
            doc.close();

            // Extra safety for Safari: if the document is already parsed, fire doSetup
            if (doc.readyState === 'complete' || doc.readyState === 'interactive') {
                setTimeout(onIframeLoad, 500);
            }
            try {
                const theme = document.documentElement.getAttribute('data-theme') || localStorage.getItem('app_theme') || 'dark';
                if (doc && doc.documentElement) doc.documentElement.setAttribute('data-theme', theme);
            } catch (e) {
                // ignore
            }
            uiLog.debug('PREVIEW', 'Preview iframe updated with final HTML');
        }

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
                uiLog.warn('PREVIEW', 'Slide polling exhausted, activating fallback setup', {
                    attempts
                });
                // Force-complete setup even if slides aren't found yet
                // (avoids hanging forever if the HTML has an unexpected structure).
                if (!setupDone) {
                    setupDone = true;
                    setupPreviewInteractions();
                    if (typeof callback === 'function') callback();
                }
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
            const isTool = el.classList.contains('editor-selection-box') ||
                el.classList.contains('editor-toolbar') ||
                el.classList.contains('editor-guide') ||
                el.classList.contains('editor-color-picker');
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
    // True during soft-regen streaming: blocks updateMinimapSkeleton so the existing
    // real thumbnails stay visible (instead of being cleared and replaced by skeleton items
    // the moment skeleton-injector fires its first postMessage).
    let _skipMinimapSkeleton = false;
    function setupPreviewInteractions(targetIndex = 0) {
        const iframeDoc = previewIframe.contentDocument || previewIframe.contentWindow.document;
        if (!iframeDoc || !iframeDoc.body) return;

        // ── INJECT GOOGLE FONTS INTO LIVE PREVIEW IFRAME ──
        // The AI-generated HTML only imports the theme fonts (e.g. Syne + DM Sans via @import).
        // Font picker options like Playfair Display, Bebas Neue, etc. are NOT loaded in this document,
        // so changing font-family has no visual effect even though the inline style is applied correctly.
        // Fix: explicitly create <link> elements in the iframe's <head>.
        if (iframeDoc.head && !iframeDoc.head.querySelector('link[data-fonts]')) {
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
            fontLink.dataset.fonts = '1';
            fontLink.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap';
            iframeDoc.head.appendChild(fontLink);
            uiLog.info('PREVIEW', 'Google Fonts injected into live preview iframe');
        }

        const slides = findSlides(iframeDoc);
        totalSlides = slides.length || 1;
        // buildDots() was redundant here as it's called after restoration anyway

        // Attach global nav listeners only once to avoid memory leaks and CPU peaks
        if (!iframeDoc._listenersAttached) {
            iframeDoc.addEventListener('wheel', handleSlideWheelNav, { passive: true });
            iframeDoc.addEventListener('touchstart', handleTouchStart, { passive: true });
            iframeDoc.addEventListener('touchend', handleTouchEnd, { passive: true });
            iframeDoc._listenersAttached = true;
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

        // If we are restoring state, we handle overlay re-keying in the 'state-restored' event listener
        // instead of doing a full destructive clear and rebuild here.
        if (!iframeDoc._restoringState) {
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
        if (isMobileViewport()) {
            const iw = previewIframe.contentWindow;
            if (iw && typeof iw.setLocked === 'function') {
                iw.setLocked(true);
            }
        }

        // Soft-regenerate can leave the fresh minimap cloning from a DOM that has not yet been
        // normalized by the editor. The user's manual workaround (select any element) triggers
        // freezeSlideLayout() and then the minimap refreshes from that stable geometry. Do the
        // same here before initMinimap builds the final thumbnails.
        if (_stabilizeMinimapOnNextPreviewInit) {
            const iw = previewIframe.contentWindow;
            if (iw && typeof iw.freezeAllSlides === 'function') {
                iw.freezeAllSlides();
            }
            _stabilizeMinimapOnNextPreviewInit = false;
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
            iframeWinRef.addEventListener('state-restored', (ev) => {
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
                    iDoc._restoringState = true;
                    setupPreviewInteractions(currentSlide);
                    iDoc._restoringState = false;

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
        // Handled globally by the conditional beforeunload listener in app.js

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


    // Initialize zoom state
    window._manualZoomScale = 1.0; // Manual zoom factor (1.0 = fill available area; panels reserve space via stage padding)
    const MIN_ZOOM = 0.5; // 50%
    const MAX_ZOOM = 2; // 200%
    const ZOOM_STEP = 0.1; // 10% increments
    let _fallbackLastIsMobileLayoutForZoom = window.innerWidth <= MOBILE_BREAKPOINT;
    const syncZoomStateWithViewportMode =
        window.MobileRuntime && typeof window.MobileRuntime.createViewportModeSync === 'function'
            ? window.MobileRuntime.createViewportModeSync({ onLeaveMobile: resetMobileZoomState })
            : function syncZoomStateWithViewportModeFallback() {
                const isMobileLayout = window.innerWidth <= MOBILE_BREAKPOINT;
                if (_fallbackLastIsMobileLayoutForZoom && !isMobileLayout) {
                    resetMobileZoomState();
                }
                _fallbackLastIsMobileLayoutForZoom = isMobileLayout;
                return isMobileLayout;
            };

    function updateZoomDisplay() {
        const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
        const maxZoom = isFullscreen ? MAX_ZOOM : 1;
        const minZoom = MIN_ZOOM;
        const EPS = 0.0001;
        const display = document.getElementById('canvas-zoom-display');
        if (display) {
            const percentage = Math.round(window._manualZoomScale * 100);
            display.textContent = `${percentage}%`;
        }
        if (btnZoomIn) btnZoomIn.disabled = window._manualZoomScale >= (maxZoom - EPS);
        if (btnZoomOut) btnZoomOut.disabled = window._manualZoomScale <= (minZoom + EPS);
    }

    function setZoom(zoomLevel) {
        const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
        const maxZoom = isFullscreen ? MAX_ZOOM : 1;
        zoomLevel = Math.max(MIN_ZOOM, Math.min(maxZoom, zoomLevel));
        window._manualZoomScale = zoomLevel;
        updateZoomDisplay();
        window.dispatchEvent(new Event('resize'));
    }

    // Zoom button handlers
    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');

    if (btnZoomIn) {
        btnZoomIn.addEventListener('click', () => {
            setZoom(window._manualZoomScale + ZOOM_STEP);
        });
    }

    if (btnZoomOut) {
        btnZoomOut.addEventListener('click', () => {
            setZoom(window._manualZoomScale - ZOOM_STEP);
        });
    }

    // Ensure initial display matches the new default
    updateZoomDisplay();

    function scaleIframe() {
        // Measure from a static parent that doesn't collapse with scale to prevent loop
        const stage = document.querySelector('.preview-stage');
        const wrapper = document.querySelector('.preview-wrapper');

        if (!wrapper || !stage || !previewIframe) return;

        const isMobileLayout = syncZoomStateWithViewportMode();

        const iframeNativeWidth = 1122;
        const iframeNativeHeight = 631;

        let scale = 1;
        let forceFitScale = false;
        const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);

        if (isFullscreen) {
            // Use full window dimensions without padding
            const availableWidth = window.innerWidth;
            const availableHeight = window.innerHeight;
            const MathScaleX = availableWidth / iframeNativeWidth;
            const MathScaleY = availableHeight / iframeNativeHeight;
            scale = Math.min(MathScaleX, MathScaleY);
            // Allow scaling up past 100% in presentation mode
        } else {
            // _editorInsets is {0,0,0,0} during streaming and is tweened by GSAP
            // during the settling animation so scaleIframe always gets the right values.
            const L = _editorInsets.left, R = _editorInsets.right;
            const T = _editorInsets.top, B = _editorInsets.bottom;
            const isStreamingState = previewContainer.classList.contains('is-generating') || previewContainer.classList.contains('is-settling');
            // Keep strict fit while streaming and in mobile layout, but allow
            // desktop zoom controls after returning from a mobile-width session.
            forceFitScale = isStreamingState || isMobileLayout;

            const scrollable = document.getElementById('preview-wrapper-scrollable');
            let availableWidth = 0;
            let availableHeight = 0;

            if (scrollable) {
                const scrollRect = scrollable.getBoundingClientRect();
                availableWidth = scrollRect.width;
                availableHeight = scrollRect.height;
            } else {
                // Fallback for edge cases where scrollable has not been mounted yet.
                const stageRect = stage.getBoundingClientRect();
                availableWidth = stageRect.width - L - R;
                availableHeight = stageRect.height - T - B;
            }

            // Guard a couple of pixels to avoid sub-pixel rounding clipping at edges.
            const FIT_GUARD_PX = 2;
            availableWidth = Math.max(1, availableWidth - FIT_GUARD_PX);
            availableHeight = Math.max(1, availableHeight - FIT_GUARD_PX);

            const fitScaleX = availableWidth / iframeNativeWidth;
            const fitScaleY = availableHeight / iframeNativeHeight;
            const fitScale = Math.min(fitScaleX, fitScaleY);

            // During streaming the manual zoom must NOT apply — the slide should
            // fill the full viewport with no panels in the way.
            const requestedScale = forceFitScale ? fitScale : fitScale * window._manualZoomScale;

            // Keep the slide fully contained in editor mode (no clipping/cropping).
            scale = Math.min(requestedScale, fitScale);

            // Centering is achieved by setting asymmetric padding on the stage element
            // (done in the GSAP onUpdate / doTransitionToPreview). The scrollable is always
            // transform-free so it never overflows the parent's overflow:hidden boundary.
            if (scrollable) scrollable.style.transform = '';
        }

        window._baseScale = scale;
        const mobileZoom = forceFitScale ? 1 : (window._mobile_zoom || 1);
        const totalScale = scale * mobileZoom;

        previewIframe.style.transform = `scale(${totalScale}) translate3d(0,0,0)`;
        wrapper.style.height = `${iframeNativeHeight * totalScale}px`;
        wrapper.style.width = `${iframeNativeWidth * totalScale}px`;

        // Keep wrapper pan transform in sync with zoom state
        if (mobileZoom <= 1) {
            if (window._pan) { window._pan.x = 0; window._pan.y = 0; }
            wrapper.style.transform = 'translate3d(0,0,0)';
        } else if (window._pan) {
            wrapper.style.transform = `translate3d(${window._pan.x}px, ${window._pan.y}px, 0)`;
        }

        // Inject scale into iframe for the visual editor's coordinate math
        try {
            const iframeWin = previewIframe.contentWindow;
            if (iframeWin) iframeWin._iframeScale = totalScale;
        } catch (e) { }

        // Keep slot overlays aligned after scale change
        if (_refreshSlotOverlays) _refreshSlotOverlays();
    }

    // --- Fullscreen handling ---
    // When the preview-stage element enters fullscreen we must clear any
    // editor-added inline paddings (GSAP) so the slide can truly occupy
    // the full viewport. Restore previous paddings on exit.
    let _savedStagePadding = null;
    function handleFullscreenChange() {
        const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
        const stageEl = document.getElementById('preview-stage');
        if (!stageEl) return;

        if (isFS) {
            // Save current inline paddings
            _savedStagePadding = {
                left: stageEl.style.paddingLeft || '',
                right: stageEl.style.paddingRight || '',
                top: stageEl.style.paddingTop || '',
                bottom: stageEl.style.paddingBottom || ''
            };
            // Clear inline paddings so :fullscreen CSS / JS scaling can fill viewport
            clearStageInlinePadding();
            // Immediately recompute scale to fit true viewport
            updateZoomDisplay();
            scaleIframe();
        } else {
            // Restore previous paddings (if any) and rescale
            if (_savedStagePadding) {
                stageEl.style.paddingLeft = _savedStagePadding.left || '';
                stageEl.style.paddingRight = _savedStagePadding.right || '';
                stageEl.style.paddingTop = _savedStagePadding.top || '';
                stageEl.style.paddingBottom = _savedStagePadding.bottom || '';
                _savedStagePadding = null;
            } else {
                // Fallback: clear any stray inline padding and let scaleIframe use _editorInsets
                clearStageInlinePadding();
            }
            // Outside fullscreen the editor enforces contain mode up to 100%.
            if (window._manualZoomScale > 1) {
                window._manualZoomScale = 1;
            }
            updateZoomDisplay();
            // Small timeout to allow browser to exit fullscreen and reflow
            setTimeout(scaleIframe, 50);
        }
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

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
            body.editor-locked .img-replace-overlay {
                display: none !important;
            }
            body.editor-locked [data-image-slot]:hover,
            body.editor-locked [data-image-slot].is-hovered {
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
        if (!isRestoringFlow && !doc._restoringState) {
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
            const inputId = `img-input-${slotIdCode}`;

            const input = existingInput || document.createElement('input');
            if (!existingInput) {
                input.className = 'preview-file-input';
                input.type = 'file';
                input.id = inputId;
                input.name = inputId;
                input.accept = 'image/*';
                input.setAttribute('aria-label', 'Upload image');
                input.style.cssText = 'position:fixed;top:-999px;left:-999px;opacity:0;width:1px;height:1px;pointer-events:none;';
                document.body.appendChild(input);

                input.addEventListener('change', (e) => {
                    if (e.target.files && e.target.files.length > 0) {
                        const iframeWin = previewIframe.contentWindow;
                        if (iframeWin && iframeWin.editorSaveState) iframeWin.editorSaveState();
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

            // Mobile: direct touch opens file picker without going through the
            // touch-capture-overlay (which calls preventDefault on touchstart,
            // tainting the gesture and blocking input.click() on iOS).
            label.addEventListener('touchstart', (e) => {
                e.stopPropagation(); // Don't let the touch-capture-overlay see this touch
            }, { passive: true });
            label.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                input.click();
            }, { passive: false });

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
                    if (iframeWin && iframeWin.editorSaveState) iframeWin.editorSaveState();
                    replaceSlotImage(slotRef.current, files[0]);
                    return;
                }
                const imageUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
                if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
                    const iframeWin = previewIframe.contentWindow;
                    if (iframeWin && iframeWin.editorSaveState) iframeWin.editorSaveState();
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
                        <span>${isMobileViewport() ? window.__t('click_drop_mobile') : window.__t('click_drop')}</span>
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
        window._triggerImagePicker = (slot) => {
            // Block if in fullscreen (presentation mode)
            if (document.fullscreenElement || document.webkitFullscreenElement) return;

            const entry = _overlayMap.get(slot);
            if (entry) entry.input.click();
        };

        if (doc._dblClickListener) doc.removeEventListener('dblclick', doc._dblClickListener);
        doc._dblClickListener = (e) => {
            // Block if in fullscreen (presentation mode)
            if (document.fullscreenElement || document.webkitFullscreenElement) return;

            const slot = e.target.closest('[data-image-slot]');
            if (!slot) return;
            e.preventDefault();
            e.stopPropagation();
            window._triggerImagePicker(slot);
        };
        doc.addEventListener('dblclick', doc._dblClickListener);


        // Remove old custom event listener to avoid confusion
        // Remove old custom event listener to avoid confusion
        if (doc._triggerListener) doc.removeEventListener('trigger-image-picker', doc._triggerListener);
        doc._triggerListener = (e) => {
            if (e.detail && e.detail.element) window._triggerImagePicker(e.detail.element);
        };
        doc.addEventListener('trigger-image-picker', doc._triggerListener);




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

        window.addEventListener('drop-complete', () => {
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
                    label.style.pointerEvents = 'none';
                    return;
                }

                // Show and position
                label.style.display = 'block';
                label.style.left = (fr.left + r.left * scale) + 'px';
                label.style.top = (fr.top + r.top * scale) + 'px';
                label.style.width = (r.width * scale) + 'px';
                label.style.height = (r.height * scale) + 'px';
                // On mobile, make label interactive so touch events go directly
                // to the label (above the touch-capture-overlay in z-order),
                // bypassing the overlay's preventDefault that would block input.click()
                if (isMobileViewport()) {
                    label.style.pointerEvents = 'auto';
                }
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

            // Ensure every normalized slot has a parent-side input/label entry.
            // Some templates define only .img-slot (without data-image-slot), and
            // those were previously skipped by the first overlay build pass.
            _buildOverlayForSlot(slot);

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
                    window.parent.dispatchEvent(new CustomEvent('add-image-at', {
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
        // Hide only placeholder layers. Keep real overlays intact so background
        // image readability settings are preserved when the user swaps the photo.
        const placeholderLayers = Array.from(slot.querySelectorAll(':scope > .img-bg1, :scope > .img-bg2'));
        placeholderLayers.forEach(layer => layer.style.display = 'none');

        // Apply image directly on the slot container
        slot.style.backgroundImage = `url('${imageDataOrUrl}')`;
        slot.style.backgroundSize = 'cover';
        slot.style.backgroundPosition = 'center';
        slot.style.backgroundRepeat = 'no-repeat';

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
            window.currentSlide = index; // Expose globally for the editor iframe
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

    window.scrollToSlide = scrollToSlide;
    window.prevSlide = () => tryNavigate(currentSlide - 1);
    window.nextSlide = () => tryNavigate(currentSlide + 1);
    window.getCurrentSlide = () => currentSlide;
    window.getTotalSlides = () => totalSlides;

    function notifySlideMetaUpdate() {
        document.dispatchEvent(new CustomEvent('slide-meta-updated', {
            detail: {
                currentSlide,
                totalSlides
            }
        }));
    }

    function syncMobileSlideCounterFallback() {
        if (!mobileSlideLabel && !mobileSlideDots) return;

        const safeTotal = Math.max(1, Number.isFinite(totalSlides) ? totalSlides : 1);
        const safeCurrent = Math.max(0, Math.min(safeTotal - 1, Number.isFinite(currentSlide) ? currentSlide : 0));

        if (mobileSlideLabel) {
            mobileSlideLabel.textContent = `${safeCurrent + 1} / ${safeTotal}`;
        }

        if (!mobileSlideDots) return;

        if (mobileSlideDots.children.length !== safeTotal) {
            mobileSlideDots.innerHTML = '';
            for (let i = 0; i < safeTotal; i++) {
                const dot = document.createElement('button');
                dot.className = 'slide-dot' + (i === safeCurrent ? ' active' : '');
                dot.setAttribute('aria-label', `Slide ${i + 1}`);
                dot.addEventListener('click', () => scrollToSlide(i));
                mobileSlideDots.appendChild(dot);
            }
            return;
        }

        for (let i = 0; i < safeTotal; i++) {
            mobileSlideDots.children[i].classList.toggle('active', i === safeCurrent);
        }
    }

    function buildDots() {
        slideDots.innerHTML = '';
        for (let i = 0; i < totalSlides; i++) {
            const dot = document.createElement('button');
            dot.className = 'slide-dot' + (i === currentSlide ? ' active' : '');
            dot.setAttribute('aria-label', `Slide ${i + 1}`);
            dot.addEventListener('click', () => scrollToSlide(i));
            slideDots.appendChild(dot);
        }
        syncMobileSlideCounterFallback();
        notifySlideMetaUpdate();
    }

    function updateSlideCounter() {
        const dots = slideDots.querySelectorAll('.slide-dot');
        dots.forEach((d, i) => {
            d.classList.toggle('active', i === currentSlide);
        });
        const tpl = window.__t("slide_label_tpl", "Slide {current} of {total}");
        slideLabel.textContent = tpl.replace('{current}', currentSlide + 1).replace('{total}', totalSlides);
        syncMobileSlideCounterFallback();
        notifySlideMetaUpdate();
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
            if (iframeWin && iframeWin.editorGetSelection && iframeWin.editorGetSelection()) {
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
                    if (iframeWin && iframeWin.editorGetSelection && iframeWin.editorGetSelection()) {
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
                    uiLog.error('EDITOR', 'Error forwarding keyboard shortcut to iframe', {
                        error: err
                    });
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

        // Ignore small/accidental/slow inertial wheel events
        const dx = Math.abs(e.deltaX);
        const dy = Math.abs(e.deltaY);
        if (dx < 30 && dy < 30) return;

        let navigated = false;
        if (dy > dx) {
            if (e.deltaY > 0) {
                navigated = tryNavigate(currentSlide + 1);
            } else if (e.deltaY < 0) {
                navigated = tryNavigate(currentSlide - 1);
            }
        } else {
            if (e.deltaX > 0) {
                navigated = tryNavigate(currentSlide + 1);
            } else if (e.deltaX < 0) {
                navigated = tryNavigate(currentSlide - 1);
            }
        }

        if (navigated) {
            wheelCooldown = true;
            setTimeout(() => {
                wheelCooldown = false;
            }, 600); // 600ms cooldown is perfect to absorb trackpad/mouse swipe inertia
        }
    }
    document.addEventListener('wheel', handleSlideWheelNav, { passive: true });

    // Mobile Swipe Support
    const mobileSwipeHandlers =
        window.MobileRuntime && typeof window.MobileRuntime.createSlideSwipeHandlers === 'function'
            ? window.MobileRuntime.createSlideSwipeHandlers({
                threshold: 50,
                getCurrentSlide: () => currentSlide,
                getTotalSlides: () => totalSlides,
                onNavigate: (nextSlide) => tryNavigate(nextSlide)
            })
            : null;

    let touchStartX = 0;
    let touchEndX = 0;

    function handleTouchStart(e) {
        if (mobileSwipeHandlers) {
            mobileSwipeHandlers.onTouchStart(e);
            return;
        }
        touchStartX = e.changedTouches[0].screenX;
    }

    function handleTouchEnd(e) {
        if (mobileSwipeHandlers) {
            mobileSwipeHandlers.onTouchEnd(e);
            return;
        }
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }

    function handleSwipe() {
        const threshold = 50;
        if (touchEndX < touchStartX - threshold) {
            // Swipe Left -> Next
            tryNavigate(currentSlide + 1);
        } else if (touchEndX > touchStartX + threshold) {
            // Swipe Right -> Prev
            tryNavigate(currentSlide - 1);
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
            if (iframeWin.editorDeselect) iframeWin.editorDeselect();

            // ── Step 1: Freeze all slides ─────────────────────────────────────────
            // Unedited slides have never been through normalizeElement, so their
            // children are still in CSS grid/flex flow. Puppeteer recalculates that
            // layout with its own font metrics and can produce different widths.
            // freezeAllSlides converts every slide to absolute coordinates
            // using getBoundingClientRect() from the live browser without saving
            // any undo state.
            if (iframeWin.freezeAllSlides) iframeWin.freezeAllSlides();

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
            const _PDF_CONTAINER_SEL = '[data-container="true"], div.stat-box, div.card, div.step-item, div.timeline-item, .quote-block, blockquote, ul, ol, .flex-row, .flex-col, .grid-2, .grid-3, [class*="card"], [class*="box"]';
            const _PDF_TEXT_SEL = 'h1,h2,h3,h4,p,span,blockquote,.big-number,.big-label,.tag,.subtitle,.step-num,.timeline-year,li,cite';
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
                '.editor-selection-box, .editor-toolbar, .editor-color-picker, .editor-guide'
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
            // PDF error: overlay the preview WITHOUT hiding it
            errorMessage.textContent = error.message;
            const errTitleEl = document.getElementById('t-error-title');
            const errSubtitleEl = document.getElementById('t-error-subtitle');
            if (errTitleEl) errTitleEl.textContent = window.__t ? window.__t('pdf_error_title', 'PDF could not be generated') : 'PDF could not be generated';
            if (errSubtitleEl) errSubtitleEl.textContent = window.__t ? window.__t('pdf_error_subtitle', 'Something went wrong while creating the file. Your presentation is still there — you can try again.') : 'Something went wrong while creating the file. Your presentation is still there — you can try again.';
            // Dismiss just closes the modal — the user stays in the editor
            showErrorModal(null);
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
        _errorModalOnDismiss = null;
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
        if (mobileSlideDots) mobileSlideDots.innerHTML = '';
        if (mobileSlideLabel) mobileSlideLabel.textContent = '1 / 1';
        progressBarEl.style.transition = 'none';
        progressBarEl.style.width = '0%';

        // restart typewriter if empty
        if (document.getElementById('w-tema').value.trim() === '') {
            if (chatPlaceholderContainer) chatPlaceholderContainer.style.display = '';
            startTypewriter();
        }
    }

    resetBtn.addEventListener('click', resetUI);
    // back-btn: dismiss error modal then call the context-specific dismiss action
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            const cb = _errorModalOnDismiss;
            hideErrorModal();
            if (cb) cb();
            // If no callback, just close the modal — stay on whatever screen is active
        });
    }
    document.getElementById('refused-back-btn').addEventListener('click', () => {
        refusedContainer.classList.add('hidden');
        resetUI();
    });

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
                    e.target.closest('#floating-toolbar') ||
                    e.target.closest('._slot-overlay-label');

                if (!isEditorInteraction) {
                    try {
                        if (previewIframe && previewIframe.contentWindow && previewIframe.contentWindow.editorDeselect) {
                            previewIframe.contentWindow.editorDeselect();
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
            const translated = (typeof window.__t === 'function')
                ? window.__t(keyOrText)
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

// -- Suggestion Pills Logic ---------------------------------------------------
document.querySelectorAll('.suggestion-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        const temaInput = document.getElementById('w-tema');
        if (temaInput) {
            const key = pill.dataset.topicKey;
            temaInput.value = key ? window.__t(key, pill.dataset.topic || '') : (pill.dataset.topic || '');
            temaInput.focus();
            const event = new Event('input', { bubbles: true });
            temaInput.dispatchEvent(event);
        }
    });
});





