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
    const debugLastGeneratedBtn = document.getElementById('btn-debug-last-generated');

    // ── Active SSE stream controller (cancel on Back / new generation) ──
    let _activeGenController = null;
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

    // ── Mode Toggle Button ─────────────────────────────────────────────
    const modeToggleBtn = document.getElementById('btn-mode-toggle');
    const chatInputWrapper = document.querySelector('.chat-input-wrapper');
    const generateBtnLabel = document.querySelector('#btn-generate .btn-generate-label');

    function syncModeToggleI18n() {
        // Set the initial tooltip via i18n
        if (modeToggleBtn) {
            modeToggleBtn.setAttribute('data-tooltip', window.__t(
                proModeEnabled ? 'mode_tooltip_pro' : 'mode_tooltip_flash'
            ));
        }
        // Sync generate button label
        if (generateBtnLabel) {
            const key = proModeEnabled ? 'generate_pro_presentation' : 'generate_presentation';
            generateBtnLabel.setAttribute('data-i18n', key);
            generateBtnLabel.textContent = window.__t(key);
        }
    }

    if (modeToggleBtn) {
        const modeLabel = modeToggleBtn.querySelector('.btn-mode-label');
        const modeSelectMobile = document.getElementById('mode-select-mobile');

        // Set initial tooltip
        syncModeToggleI18n();

        function updateModeUI() {
            const btnGenerate = document.getElementById('btn-generate');
            
            // Capture initial widths
            const initialModeWidth = modeToggleBtn.offsetWidth;
            const initialGenWidth = btnGenerate ? btnGenerate.offsetWidth : 0;

            // Clear inline styles to measure natural dimensions
            modeToggleBtn.style.transition = 'none';
            modeToggleBtn.style.width = 'auto';
            if (btnGenerate) {
                btnGenerate.style.transition = 'none';
                btnGenerate.style.width = '100%'; 
            }

            // Apply content changes
            modeToggleBtn.setAttribute('aria-pressed', String(proModeEnabled));
            modeToggleBtn.classList.toggle('is-active', proModeEnabled);
            modeToggleBtn.classList.add('is-animating');
            setTimeout(() => modeToggleBtn.classList.remove('is-animating'), 400);

            if (chatInputWrapper) chatInputWrapper.classList.toggle('is-pro', proModeEnabled);

            const iconFlash = modeToggleBtn.querySelector('.btn-mode-icon--flash');
            const iconPro = modeToggleBtn.querySelector('.btn-mode-icon--pro');
            if (iconFlash) iconFlash.style.display = proModeEnabled ? 'none' : 'flex';
            if (iconPro) iconPro.style.display = proModeEnabled ? 'flex' : 'none';

            if (modeLabel) {
                const labelKey = proModeEnabled ? 'mode_label_pro' : 'mode_label_flash';
                modeLabel.setAttribute('data-i18n', labelKey);
                modeLabel.textContent = window.__t(labelKey);
            }

            if (modeSelectMobile) {
                modeSelectMobile.value = proModeEnabled ? 'pro' : 'flash';
            }

            syncModeToggleI18n();

            // Measure new widths
            const finalModeWidth = modeToggleBtn.offsetWidth;
            const finalGenWidth = btnGenerate ? btnGenerate.offsetWidth : 0;

            // Revert back and force reflow
            modeToggleBtn.style.width = initialModeWidth + 'px';
            if (btnGenerate) btnGenerate.style.width = initialGenWidth + 'px';
            modeToggleBtn.offsetHeight; // trigger reflow

            // Apply transitions and set final widths
            modeToggleBtn.style.transition = 'width 0.3s cubic-bezier(0.25, 1, 0.5, 1), background 0.4s ease, border-color 0.4s ease, color 0.4s ease';
            if (btnGenerate) btnGenerate.style.transition = 'width 0.3s cubic-bezier(0.25, 1, 0.5, 1), background 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease';

            modeToggleBtn.style.width = finalModeWidth + 'px';
            if (btnGenerate) btnGenerate.style.width = finalGenWidth + 'px';

            // Cleanup explicit widths after transition
            setTimeout(() => {
                modeToggleBtn.style.width = '';
                modeToggleBtn.style.transition = '';
                if (btnGenerate) {
                    btnGenerate.style.width = ''; // Let CSS take over
                    btnGenerate.style.transition = '';
                }
            }, 300);
        }

        const mobileModeController =
            window.MobileRuntime && typeof window.MobileRuntime.initModeToggleMobileController === 'function'
                ? window.MobileRuntime.initModeToggleMobileController({
                    modeToggleBtn,
                    modeSelectMobile,
                    getModeValue: () => (proModeEnabled ? 'pro' : 'flash'),
                    setModeValue: (value) => {
                        proModeEnabled = (value === 'pro');
                    },
                    onModeChanged: updateModeUI
                })
                : null;

        modeToggleBtn.addEventListener('click', (e) => {
            if (mobileModeController && mobileModeController.handleToggleClick(e)) return;
            proModeEnabled = !proModeEnabled;
            updateModeUI();
        });

        if (modeSelectMobile && (!mobileModeController || !mobileModeController.handlesNativeSelect)) {
            modeSelectMobile.addEventListener('change', (e) => {
                proModeEnabled = (e.target.value === 'pro');
                updateModeUI();
            });
            // Stop propagation so the button click doesn't double-toggle
            modeSelectMobile.addEventListener('click', (e) => e.stopPropagation());
        }
    }
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
                fn();
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
                let t = e.data.title.replace(/<[^>]+>/g, '').trim();
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
        const GAP    = 10; // px between trigger and tooltip

        function showTip(trigger) {
            const text = trigger.dataset.tooltip;
            if (!text) return;

            // Set text and reset position so it can size freely while still hidden
            tip.textContent = text;
            tip.style.left = '0';
            tip.style.top  = '0';

            // Measure while still invisible (visibility:hidden has correct layout)
            const tr  = trigger.getBoundingClientRect();
            const tw  = tip.offsetWidth;
            const th  = tip.offsetHeight;
            const vw  = window.innerWidth;
            const vh  = window.innerHeight;

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

            tip.style.top  = top + 'px';
            tip.style.left = left + 'px';

            // Show only after positioned — prevents first-hover flash at wrong size
            tip.classList.add('visible');
        }

        function hideTip() {
            tip.classList.remove('visible');
        }

        // Event delegation — works for all 3 tooltip triggers
        document.addEventListener('mouseover', function(e) {
            const trigger = e.target.closest('[data-tooltip]');
            if (trigger && trigger.dataset.tooltip) showTip(trigger);
        });

        document.addEventListener('mouseout', function(e) {
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
        return BTN_LOADING_KEYS_DESKTOP;
    }

    function _scheduleNextBtnMsg() {
        if (_btnMsgIndex >= _activeBtnLoadingKeys.length - 1) return;
        _btnMsgTimer = setTimeout(() => {
            _btnMsgIndex++;
            const label = generateBtn.querySelector('.btn-generate-label');
            if (label) {
                const key = _activeBtnLoadingKeys[_btnMsgIndex];
                const fallbackKey = BTN_LOADING_KEYS_DESKTOP[_btnMsgIndex] || 'gen_loading_final';
                label.textContent = window.__t(key, window.__t(fallbackKey));
            }
            _scheduleNextBtnMsg();
        }, 1900);
    }

    function startBtnMessages() {
        _activeBtnLoadingKeys = _resolveBtnLoadingKeys();
        _btnMsgIndex = 0;
        _btnMsgTimer = null;
        const label = generateBtn.querySelector('.btn-generate-label');
        if (label) {
            const key = _activeBtnLoadingKeys[0];
            label.textContent = window.__t(key, window.__t(BTN_LOADING_KEYS_DESKTOP[0]));
        }
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
        if (label) label.textContent = window.__t('generate_presentation', 'Generate presentation');
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
            modeToggleBtn.disabled = true;  // Disable mode toggle during generation
            if (sendIcon) sendIcon.classList.add('hidden');
            if (loaderIcon) loaderIcon.classList.remove('hidden');
            stopTypewriter();
            startBtnMessages();

            // Disable editor buttons/controls during generation
            editorControls.forEach(ctrl => { if (ctrl) ctrl.disabled = true; });
        } else {
            temaInput.disabled = false;
            generateBtn.disabled = temaInput.value.trim().length < 4;
            modeToggleBtn.disabled = false;  // Enable mode toggle after generation
            if (sendIcon) sendIcon.classList.remove('hidden');
            if (loaderIcon) loaderIcon.classList.add('hidden');
            if (typewriterCursor) typewriterCursor.style.display = '';
            stopBtnMessages();

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
            const cleanTitle = h1Match[1].replace(/<[^>]+>/g, '').trim();
            if (cleanTitle) return cleanTitle;
        }

        return fallbackTitle;
    }

    function openPreviewFromExistingHtml(html, title) {
        if (!html || typeof html !== 'string') {
            throw new Error('Debug HTML is empty or invalid.');
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
                    dbgStage.style.paddingLeft   = '165px';
                    dbgStage.style.paddingRight  = '30px';
                    dbgStage.style.paddingTop    = '64px';
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
        if (!debugLastGeneratedBtn) return;

        // Extra safety: Never show debug button on production domains
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (!isLocal) return;

        try {
            const response = await fetch('/__dev__/last-generated', { method: 'HEAD', cache: 'no-store' });
            if (!response.ok) return;

            debugLastGeneratedBtn.hidden = false;
            debugLastGeneratedBtn.addEventListener('click', () => openLastGeneratedDebugCanvas());

            const params = new URLSearchParams(window.location.search);
            if (params.get('debug') === 'last') {
                openLastGeneratedDebugCanvas();
            }
        } catch (error) {
            debugLastGeneratedBtn.hidden = true;
        }
    }

    async function handleGenerate() {
        // Abort any previous in-flight generation
        if (_activeGenController) {
            _activeGenController.abort();
            _activeGenController = null;
        }
        generatedHtml = ''; // Reset state for a fresh start
        currentSlide = 0;
        totalSlides = 0;
        const tema = temaInput.value.trim();
        if (!tema) {
            temaError.classList.add('visible');
            temaInput.focus();
            return;
        }
        temaError.classList.remove('visible');

        // Everything the AI needs comes from the raw chat text.
        // The prompt handles extraction of: slide count, metadata, style, colors, language, etc.
        const requestData = {
            tema: tema,
            ...(proModeEnabled ? { mode: 'pro' } : {})
        };

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

        // Immediately update preview label
        const previewLabel = document.getElementById('preview-topic-label');
        if (previewLabel) {
            if (previewLabel.tagName === 'INPUT') previewLabel.value = tema;
            else previewLabel.textContent = tema;
        }


        slideLabel.textContent = "1 / 1";
        updateMinimapSkeleton(1);

        try {
            const controller = new AbortController();
            _activeGenController = controller;
            const response = await fetch('/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData),
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

                        // Pipeline stage progress events
                        if (parsed.pipeline) {
                            pauseBtnMessages();
                            const label = generateBtn.querySelector('.btn-generate-label');
                            if (label) {
                                const stageLabels = {
                                    content: window.__t ? window.__t("stage_content", "Analyzing content...") : "Analyzing content...",
                                    design: window.__t ? window.__t("stage_design", "Resolving design...") : "Resolving design...",
                                    compositing: window.__t ? window.__t("stage_compositing", "Composing slides...") : "Composing slides..."
                                };
                                label.textContent = stageLabels[parsed.stage] || parsed.stage;
                            }
                            continue;
                        }

                        if (parsed.chunk) {
                            if (firstWrite) {
                                firstWrite = false;
                                _pendingTransitionFn = doTransitionToPreview;
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
                            left:   165,
                            right:   30,
                            top:     64,
                            bottom:  64,
                            duration: 1.2,
                            ease: "expo.out",
                            onUpdate: () => {
                                // Apply _editorInsets as stage padding so the flex container
                                // centers the slide within the panel-free area — no transform
                                // on the scrollable means no overflow-clipping bug.
                                const stageEl = document.getElementById('preview-stage');
                                if (stageEl) {
                                    stageEl.style.paddingLeft   = `${_editorInsets.left}px`;
                                    stageEl.style.paddingRight  = `${_editorInsets.right}px`;
                                    stageEl.style.paddingTop    = `${_editorInsets.top}px`;
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
                                fallbackStage.style.paddingLeft   = '165px';
                                fallbackStage.style.paddingRight  = '30px';
                                fallbackStage.style.paddingTop    = '64px';
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
            _stabilizeMinimapOnNextPreviewInit = false;

            // Ignore intentional user cancellations (Back button)
            if (error.name === 'AbortError') {
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

            if (msg.includes('DAILY_LIMIT_EXCEEDED_FLASH') || msg.includes('DAILY_LIMIT_EXCEEDED_PRO')) {
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
            // Clean up any in-progress chat→preview transition
            if (!_hasTransitioned) {
                chatScreen.style.cssText = '';
                chatScreen.classList.remove('hidden');
            }
            iframeDoc.close();
            // Show error overlay on top of whatever is visible; dismiss → go to chat
            showErrorModal(() => {
                previewContainer.classList.add('hidden');
                chatScreen.style.cssText = '';
                chatScreen.classList.remove('hidden');
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
            // Cancel any running generation stream
            if (_activeGenController) {
                _activeGenController.abort();
                _activeGenController = null;
            }
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
            if (_activeGenController) {
                _activeGenController.abort();
                _activeGenController = null;
            }
            previewContainer.classList.add('hidden');
            chatScreen.classList.remove('hidden');
            temaInput.focus();
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
            } catch (e) {}

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
            const L = _editorInsets.left,  R = _editorInsets.right;
            const T = _editorInsets.top,   B = _editorInsets.bottom;
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

            const fitScaleX = availableWidth  / iframeNativeWidth;
            const fitScaleY = availableHeight / iframeNativeHeight;
            const fitScale  = Math.min(fitScaleX, fitScaleY);

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
    const mobileSwipeHandlers =
        window.MobileRuntime && typeof window.MobileRuntime.createSlideSwipeHandlers === 'function'
            ? window.MobileRuntime.createSlideSwipeHandlers({
                threshold: 50,
                getCurrentSlide: () => currentSlide,
                getTotalSlides: () => totalSlides,
                onNavigate: (nextSlide) => scrollToSlide(nextSlide)
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
