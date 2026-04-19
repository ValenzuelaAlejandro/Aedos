(function () {
    const cfg = window.MobileConfig || {
        breakpoint: 850,
        modeTouchDebounceMs: 700,
        modeSelectionDebounceMs: 250,
        swipeThreshold: 50
    };

    const MOBILE_LOADING_KEYS = [
        'gen_loading_1_mobile', 'gen_loading_2_mobile', 'gen_loading_3_mobile', 'gen_loading_4_mobile',
        'gen_loading_5_mobile', 'gen_loading_6_mobile', 'gen_loading_7_mobile', 'gen_loading_8_mobile',
        'gen_loading_9_mobile', 'gen_loading_final_mobile'
    ];

    function isMobileLayout() {
        return window.innerWidth <= cfg.breakpoint;
    }

    function resetZoomState() {
        window._mobile_zoom = 1;
        window._pan = { x: 0, y: 0 };
    }

    function resolveLoadingKeys(desktopKeys) {
        return isMobileLayout() ? MOBILE_LOADING_KEYS : desktopKeys;
    }

    function createViewportModeSync(options = {}) {
        const onLeaveMobile = typeof options.onLeaveMobile === 'function' ? options.onLeaveMobile : null;
        let lastIsMobile = isMobileLayout();

        return function syncViewportMode() {
            const mobileNow = isMobileLayout();
            if (lastIsMobile && !mobileNow && onLeaveMobile) {
                onLeaveMobile();
            }
            lastIsMobile = mobileNow;
            return mobileNow;
        };
    }

    function createSlideSwipeHandlers(options = {}) {
        const threshold = Number.isFinite(options.threshold) ? options.threshold : cfg.swipeThreshold;
        const getCurrentSlide = typeof options.getCurrentSlide === 'function' ? options.getCurrentSlide : () => 0;
        const getTotalSlides = typeof options.getTotalSlides === 'function' ? options.getTotalSlides : () => 0;
        const onNavigate = typeof options.onNavigate === 'function' ? options.onNavigate : () => {};

        let touchStartX = 0;

        function onTouchStart(e) {
            if (!e || !e.changedTouches || !e.changedTouches[0]) return;
            touchStartX = e.changedTouches[0].screenX;
        }

        function onTouchEnd(e) {
            if (!e || !e.changedTouches || !e.changedTouches[0]) return;
            const touchEndX = e.changedTouches[0].screenX;
            const currentSlide = getCurrentSlide();
            const totalSlides = getTotalSlides();

            if (touchEndX < touchStartX - threshold) {
                if (currentSlide < totalSlides - 1) onNavigate(currentSlide + 1);
            } else if (touchEndX > touchStartX + threshold) {
                if (currentSlide > 0) onNavigate(currentSlide - 1);
            }
        }

        return { onTouchStart, onTouchEnd };
    }

    function blurFocusedTextControl() {
        const activeEl = document.activeElement;
        if (!activeEl) return;
        const isTextControl =
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'INPUT' ||
            activeEl.isContentEditable;
        if (isTextControl && typeof activeEl.blur === 'function') {
            activeEl.blur();
        }
    }

    function initModeToggleMobileController(options = {}) {
        const modeToggleBtn = options.modeToggleBtn;
        if (!modeToggleBtn) return null;

        const modeSelectMobile = options.modeSelectMobile || null;
        const getModeValue = typeof options.getModeValue === 'function'
            ? options.getModeValue
            : () => 'flash';
        const setModeValue = typeof options.setModeValue === 'function'
            ? options.setModeValue
            : () => {};
        const onModeChanged = typeof options.onModeChanged === 'function'
            ? options.onModeChanged
            : () => {};

        const MODES = [
            {
                value: 'flash',
                labelKey: 'mode_label_flash',
                labelDefault: 'Fast',
                subDefault: '~20s',
                icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>'
            },
            {
                value: 'pro',
                labelKey: 'mode_label_pro',
                labelDefault: 'High Quality',
                subDefault: '~2 min',
                icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>'
            }
        ];

        let modeDropdownEl = null;
        let dropdownOpen = false;
        let lastModeToggleTouchTs = 0;
        let lastModeSelectionTs = 0;

        function bindOutsideDropdownListeners() {
            document.addEventListener('pointerdown', outsideTap, true);
            document.addEventListener('click', outsideTap, true);
        }

        function unbindOutsideDropdownListeners() {
            document.removeEventListener('pointerdown', outsideTap, true);
            document.removeEventListener('click', outsideTap, true);
        }

        function closeModeDropdown() {
            if (!modeDropdownEl || !dropdownOpen) return;
            modeDropdownEl.classList.remove('is-open');
            modeDropdownEl.style.opacity = '';
            dropdownOpen = false;
            unbindOutsideDropdownListeners();
        }

        function selectModeValue(value) {
            const now = Date.now();
            if (now - lastModeSelectionTs < cfg.modeSelectionDebounceMs) return;
            lastModeSelectionTs = now;

            setModeValue(value);
            onModeChanged();

            if (modeDropdownEl) {
                modeDropdownEl.querySelectorAll('.mode-dropdown-option').forEach((opt) => {
                    opt.classList.toggle('is-selected', opt.dataset.value === value);
                });
            }
            if (modeSelectMobile) modeSelectMobile.value = value;
            closeModeDropdown();
        }

        function handleModeOptionActivation(e, value) {
            if (e) {
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();
            }
            selectModeValue(value);
        }

        function buildModeDropdown() {
            if (modeDropdownEl) return;

            const el = document.createElement('div');
            el.className = 'mode-dropdown-custom';
            el.setAttribute('role', 'listbox');

            MODES.forEach((mode) => {
                const fullLabel = window.__t
                    ? window.__t(mode.labelKey)
                    : mode.labelDefault + ' (' + mode.subDefault + ')';
                const parenIdx = fullLabel.indexOf('(');
                const labelText = parenIdx > -1 ? fullLabel.substring(0, parenIdx).trim() : fullLabel;
                const subText = parenIdx > -1 ? fullLabel.substring(parenIdx) : '';

                const opt = document.createElement('button');
                opt.type = 'button';
                opt.className = 'mode-dropdown-option' + (mode.value === getModeValue() ? ' is-selected' : '');
                opt.setAttribute('role', 'option');
                opt.dataset.value = mode.value;
                opt.innerHTML =
                    '<span class="mode-dropdown-option-icon">' + mode.icon + '</span>' +
                    '<span class="mode-dropdown-option-text">' +
                        '<span class="mode-dropdown-option-label">' + labelText + '</span>' +
                        (subText ? '<span class="mode-dropdown-option-sub">' + subText + '</span>' : '') +
                    '</span>' +
                    '<svg class="mode-dropdown-check" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

                opt.addEventListener('touchstart', (e) => handleModeOptionActivation(e, mode.value), { passive: false });
                opt.addEventListener('click', (e) => handleModeOptionActivation(e, mode.value));
                el.appendChild(opt);
            });

            document.body.appendChild(el);
            modeDropdownEl = el;
        }

        function openModeDropdown() {
            if (dropdownOpen) {
                closeModeDropdown();
                return;
            }
            buildModeDropdown();

            const btnRect = modeToggleBtn.getBoundingClientRect();
            const ddW = 210;
            let left = btnRect.left;
            if (left + ddW > window.innerWidth - 8) left = window.innerWidth - ddW - 8;

            modeDropdownEl.style.left = left + 'px';
            modeDropdownEl.style.top = (btnRect.bottom + 8) + 'px';

            const curVal = getModeValue();
            modeDropdownEl.querySelectorAll('.mode-dropdown-option').forEach((opt) => {
                opt.classList.toggle('is-selected', opt.dataset.value === curVal);
            });

            requestAnimationFrame(() => {
                modeDropdownEl.classList.add('is-open');
            });
            dropdownOpen = true;
            bindOutsideDropdownListeners();
        }

        function outsideTap(e) {
            const target = e.target;
            if (
                modeDropdownEl &&
                !modeDropdownEl.contains(target) &&
                !modeToggleBtn.contains(target)
            ) {
                closeModeDropdown();
            }
        }

        if (modeSelectMobile) {
            modeSelectMobile.addEventListener('change', (e) => {
                selectModeValue(e.target.value);
            });
            modeSelectMobile.addEventListener('click', (e) => e.stopPropagation());
        }

        modeToggleBtn.addEventListener('touchstart', (e) => {
            if (!isMobileLayout()) return;
            lastModeToggleTouchTs = Date.now();
            e.preventDefault();
            e.stopPropagation();
            blurFocusedTextControl();
            openModeDropdown();
        }, { passive: false });

        function handleToggleClick(e) {
            if (!isMobileLayout()) return false;
            if (Date.now() - lastModeToggleTouchTs < cfg.modeTouchDebounceMs) return true;

            if (e) {
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();
            }
            blurFocusedTextControl();
            openModeDropdown();
            return true;
        }

        return {
            handlesNativeSelect: true,
            closeModeDropdown,
            handleToggleClick
        };
    }

    window.MobileRuntime = Object.assign(window.MobileRuntime || {}, {
        isMobileLayout,
        resetZoomState,
        resolveLoadingKeys,
        createViewportModeSync,
        createSlideSwipeHandlers,
        initModeToggleMobileController
    });
})();
