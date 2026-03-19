/**
 * Eidoslab Visual Editor
 * Injected into the presentation iframe to allow Canva-like editing.
 */
function initEditor() {
    if (window._editorInitialized) return;
    window._editorInitialized = true;

    let _isLocked = false;
    window.eidosSetLocked = (locked) => {
        _isLocked = locked;
        if (locked) {
            document.body.classList.add('eidos-locked');
            deselectGroup();
            isDragging = false;
            isResizing = false;
        } else {
            document.body.classList.remove('eidos-locked');
        }
    };

    // Auto-lock if parent goes fullscreen
    const syncLockWithFullscreen = () => {
        const isFS = !!(document.fullscreenElement || window.parent.document.fullscreenElement || document.webkitFullscreenElement || window.parent.document.webkitFullscreenElement);
        window.eidosSetLocked(isFS);
    };
    document.addEventListener('fullscreenchange', syncLockWithFullscreen);
    window.parent.document.addEventListener('fullscreenchange', syncLockWithFullscreen);
    document.addEventListener('webkitfullscreenchange', syncLockWithFullscreen);
    window.parent.document.addEventListener('webkitfullscreenchange', syncLockWithFullscreen);

    // Basic state
    let selectedElement = null;
    let isDragging = false;
    let isResizing = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;
    let _justSelected = false; // Flag to prevent immediate deselection
    let startWidth = 0, startHeight = 0;
    let currentHandle = null;
    let snapLinesX = [];
    let snapLinesY = [];

    // History for Undo/Redo
    const history = [];
    let historyIndex = -1;

    // Clipboard for copy/paste
    let _clipboard = null;

    // Track which slides have been "frozen" into absolute layout to avoid reflows
    const _isFrozenMap = new WeakMap();
    let _isRestoring = false; // Flag to prevent state saving during undo/redo

    // Selection Observer to update box on property changes
    let selectionObserver = null;

    // UI Elements
    const selectionBox = document.createElement('div');
    selectionBox.className = 'eidos-selection-box';
    selectionBox.style.display = 'none';
    selectionBox.style.zIndex = '1000'; // Always on top


    // Resize handles
    const handles = ['nw', 'ne', 'sw', 'se', 'n', 'e', 's', 'w'];
    const handleEls = {};
    handles.forEach(pos => {
        const h = document.createElement('div');
        h.className = `eidos-resize-handle eidos-resize-${pos}`;
        h.dataset.handler = pos;
        selectionBox.appendChild(h);
        handleEls[pos] = h;
    });

    // Context Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'eidos-toolbar';
    toolbar.style.display = 'none';
    toolbar.style.zIndex = '1001'; // Above selection box


    // Snapping guides
    const guideH = document.createElement('div');
    guideH.className = 'eidos-guide eidos-guide-h';
    const guideV = document.createElement('div');
    guideV.className = 'eidos-guide eidos-guide-v';

    function ensureUI() {
        if (!selectionBox.parentElement) document.documentElement.appendChild(selectionBox);
        if (!toolbar.parentElement) document.documentElement.appendChild(toolbar);
        if (!guideH.parentElement) document.documentElement.appendChild(guideH);
        if (!guideV.parentElement) document.documentElement.appendChild(guideV);
    }
    ensureUI();

    // Deselect current element when navigating to another slide to prevent UI overlap
    const handleSlideChange = () => {
        if (selectedElement) deselectGroup();
    };

    window.addEventListener('eidos-navigate-prev', handleSlideChange);
    window.addEventListener('eidos-navigate-next', handleSlideChange);

    // Robust detection for any slide change (e.g., via pagination dots or parent UI)
    // by observing when a section starts being 'active'
    const slideActivationObserver = new MutationObserver((mutations) => {
        if (_isRestoring) return; // Silent during undo/redo
        mutations.forEach(m => {
            if (m.target.classList.contains('active') && selectedElement) {
                deselectGroup();
            }
        });
    });

    // Observe existing slides and any that might be added later
    function observeSlides() {
        document.querySelectorAll('section.s').forEach(s => {
            slideActivationObserver.observe(s, { attributes: true, attributeFilter: ['class'] });
        });
    }
    observeSlides();

    // Also watch for newly added slides (e.g. after undo/redo or dynamic generation)
    const slideStructureObserver = new MutationObserver(() => {
        if (_isRestoring) return; // Silent during undo/redo
        observeSlides();
    });
    slideStructureObserver.observe(document.body, { childList: true, subtree: true });


    // Toolbar content
    function getToolbarHTML() {
        if (!selectedElement) return '';

        const palette = getDynamicPalette().slice(0, 4);
        const quickColorsHTML = palette.map(color => `
            <div class="eidos-color-swatch" style="background:${color};" data-color="${color}"></div>
        `).join('');

        let dragGroup = [];

        const isImage = selectedElement.matches('img, .img-slot') || selectedElement.dataset.imageSlot !== undefined;
        const isText = selectedElement.matches('h1, h2, h3, h4, p, span, li, blockquote, .tag, .big-number, .big-label, cite');

        let toolsHTML = '';

        if (isText) {
            toolsHTML = `
                <div class="eidos-color-swatches-mini">${quickColorsHTML}</div>
                <div class="eidos-divider"></div>
                <div class="eidos-tb-size-wrap">
                    <button class="eidos-tb-btn" id="eidos-btn-size-down" title="${window.parent.__eidos_t('smaller', 'Smaller')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
                    <div class="eidos-tb-size-val" id="eidos-tb-size-val">16</div>
                    <button class="eidos-tb-btn" id="eidos-btn-size-up" title="${window.parent.__eidos_t('bigger', 'Bigger')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
                </div>
                <div class="eidos-divider"></div>
                <button class="eidos-tb-btn" id="eidos-btn-text-color" title="${window.parent.__eidos_t('text_color', 'Text Color')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16M6 16l6-12 6 12M8 12h8"></path></svg></button>
            `;
        } else if (isImage) {
            toolsHTML = `
                <button class="eidos-tb-btn" id="eidos-btn-replace-img" title="${window.parent.__eidos_t('replace_image', 'Replace Image')}" style="width: auto; padding: 0 10px; border-radius: 20px; gap: 6px; font-size: 12px; font-weight: 600;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                    ${window.parent.__eidos_t('replace', 'Replace')}
                </button>
            `;
        } else {
            // General shape / card
            toolsHTML = `
                <div class="eidos-color-swatches-mini">${quickColorsHTML}</div>
                <div class="eidos-divider"></div>
                <button class="eidos-tb-btn" id="eidos-btn-bg-color" title="${window.parent.__eidos_t('fill_color', 'Fill Color')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M3 9h18"></path></svg></button>
            `;
        }

        return `
            ${toolsHTML}
            <div class="eidos-divider"></div>
            <button class="eidos-tb-btn" id="eidos-btn-duplicate" title="${window.parent.__eidos_t('duplicate_element', 'Duplicate')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg></button>
            <button class="eidos-tb-btn" id="eidos-btn-delete" title="${window.parent.__eidos_t('delete_element', 'Delete')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg></button>
            <div id="eidos-color-picker" class="eidos-color-picker" style="display:none;"></div>
        `;
    }

    let activeColorAction = null; // 'text' or 'bg'

    function deleteElement(el) {
        if (!el) return;
        const slide = el.closest('.s') || el.closest('section') || document.body;
        freezeSlideLayout(slide);
        saveState();
        el.remove();
        deselectGroup();
    }

    function bindToolbarEvents() {
        const btnSizeDown = document.getElementById('eidos-btn-size-down');
        const btnSizeUp = document.getElementById('eidos-btn-size-up');
        const btnTextColor = document.getElementById('eidos-btn-text-color');
        const btnBgColor = document.getElementById('eidos-btn-bg-color');
        const btnDelete = document.getElementById('eidos-btn-delete');
        const btnDuplicate = document.getElementById('eidos-btn-duplicate');
        const btnReplaceImg = document.getElementById('eidos-btn-replace-img');

        if (btnSizeDown) {
            btnSizeDown.addEventListener('click', (e) => {
                e.stopPropagation();
                changeFontSize(-2);
            });
        }

        if (btnSizeUp) {
            btnSizeUp.addEventListener('click', (e) => {
                e.stopPropagation();
                changeFontSize(2);
            });
        }

        if (btnTextColor) {
            btnTextColor.addEventListener('click', (e) => {
                e.stopPropagation();
                activeColorAction = 'text';
                showColorPicker(e.currentTarget);
            });
        }

        if (btnBgColor) {
            btnBgColor.addEventListener('click', (e) => {
                e.stopPropagation();
                activeColorAction = 'bg';
                showColorPicker(e.currentTarget);
            });
        }

        if (btnReplaceImg) {
            btnReplaceImg.addEventListener('click', (e) => {
                e.stopPropagation();
                if (selectedElement) {
                    if (window.parent && window.parent._eidosTriggerImagePicker) {
                        window.parent._eidosTriggerImagePicker(selectedElement);
                    }
                }
            });
        }

        if (btnDelete) {
            btnDelete.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteElement(selectedElement);
            });
        }

        if (btnDuplicate) {
            btnDuplicate.addEventListener('click', (e) => {
                e.stopPropagation();
                if (selectedElement) duplicateElement(selectedElement);
            });
        }

        // Quick colors binding if they exist
        toolbar.querySelectorAll('.eidos-color-swatches-mini .eidos-color-swatch').forEach(swatch => {
            swatch.addEventListener('click', (e) => {
                e.stopPropagation();
                if (selectedElement) {
                    saveState();
                    const color = swatch.dataset.color;
                    if (selectedElement.matches('h1, h2, h3, h4, p, span, li, button, .tag, .big-number, .big-label, .subtitle, .step-num, .timeline-year, i, svg, [data-lucide], .lucide, .lucide-icon')) {
                        selectedElement.style.color = color;
                        selectedElement.style.webkitTextFillColor = color;
                        // For SVGs, also try setting fill and stroke if they don't use currentColor
                        if (selectedElement.tagName.toLowerCase() === 'svg' || selectedElement.querySelector('svg')) {
                            const svg = selectedElement.tagName.toLowerCase() === 'svg' ? selectedElement : selectedElement.querySelector('svg');
                            // Only apply if it's not a complex SVG with multiple colors? 
                            // For simplicity, we just set the color. Lucide will handle it via currentColor.
                        }
                    } else {
                        selectedElement.style.backgroundColor = color;
                    }
                    window.dispatchEvent(new CustomEvent('eidos-selection-changed', { detail: { element: selectedElement } }));
                }
            });
        });
    }

    bindToolbarEvents();

    function changeFontSize(delta) {
        if (!selectedElement) return;
        saveState();
        const style = window.getComputedStyle(selectedElement);
        const currentSize = parseFloat(style.fontSize) || 16;
        const newSize = Math.max(8, Math.min(200, currentSize + delta));
        selectedElement.style.fontSize = newSize + 'px';
        updateSizeDisplay();
    }

    function updateSizeDisplay() {
        const valEl = document.getElementById('eidos-tb-size-val');
        if (selectedElement && valEl) {
            const style = window.getComputedStyle(selectedElement);
            valEl.textContent = Math.round(parseFloat(style.fontSize)) || 16;
        }
    }

    function showColorPicker(anchorEl) {
        const picker = document.getElementById('eidos-color-picker');
        const isCurrentlyVisible = picker.style.display === 'grid';

        if (isCurrentlyVisible && picker.dataset.anchor === anchorEl.id) {
            picker.style.display = 'none';
            return;
        }

        // Generate dynamic palette
        const palette = getDynamicPalette();
        picker.innerHTML = palette.map(color => `
            <div class="eidos-color-swatch" style="background:${color};" data-color="${color}"></div>
        `).join('') + `
            <div class="eidos-color-swatch" style="background:transparent; border: 1px dashed #ccc; display:flex; align-items:center; justify-content:center; font-size:10px; color:#999;" data-color="transparent">✕</div>
        `;

        // Re-bind swatches
        picker.querySelectorAll('.eidos-color-swatch').forEach(swatch => {
            swatch.addEventListener('click', (e) => {
                e.stopPropagation();
                if (selectedElement && activeColorAction) {
                    saveState();
                    const color = swatch.dataset.color;
                    if (activeColorAction === 'text') {
                        selectedElement.style.color = color;
                        selectedElement.style.webkitTextFillColor = color;
                        const icons = selectedElement.querySelectorAll('svg, [data-lucide]');
                        if (icons) icons.forEach(i => i.style.color = color);
                    } else if (activeColorAction === 'bg') {
                        selectedElement.style.background = color;
                    }
                    picker.style.display = 'none';
                }
            });
        });

        picker.style.display = 'grid';
        picker.dataset.anchor = anchorEl.id;
    }

    function getDynamicPalette() {
        const colors = new Set();

        // 1. Extract from presentation variables (Priority)
        const rootStyle = window.getComputedStyle(document.documentElement);
        const vars = ['--presentation-accent', '--accent', '--accent-2', '--bg', '--surface'];
        vars.forEach(v => {
            const val = rootStyle.getPropertyValue(v).trim();
            if (val && val !== 'none' && val !== 'transparent') colors.add(val);
        });

        // 2. Extract from existing elements in the slide (to find actual theme colors used)
        const slide = selectedElement?.closest('.s') || document.body;
        const allInSlide = slide.querySelectorAll('*');
        allInSlide.forEach(el => {
            if (colors.size >= 8) return;
            const style = window.getComputedStyle(el);
            if (style.color && !style.color.includes('rgba(0, 0, 0, 0)') && style.color !== 'transparent') colors.add(style.color);
            if (style.backgroundColor && !style.backgroundColor.includes('rgba(0, 0, 0, 0)') && style.backgroundColor !== 'transparent') colors.add(style.backgroundColor);
        });

        // 3. Essential fallbacks
        colors.add('#FFFFFF');
        colors.add('#000000');
        colors.add('#5D5DFF');
        colors.add('#FF5D5D');
        colors.add('#5DFF5D');

        return Array.from(colors).slice(0, 16);
    }


    // Editable Elements Target Mapping
    const editableSelectors = 'h1, h2, h3, h4, p, span, li, blockquote, div.card, div.stat-box, div.step-item, div.timeline-item, .img-slot, .tag, .stat-box, .step-item, .quote-block, .timeline-item, .lucide-icon, svg[data-lucide], .big-number, .big-label, .accent-bar, .subtitle, .step-num, .timeline-year, [class*="card"], [class*="box"], [class*="item"]';
    const ignoreSelectors = '.img-replace-overlay, .img-replace-overlay *, .eidos-selection-box, .eidos-toolbar, .eidos-guide, .eidos-phantom';
    window.editableSelectors = editableSelectors; // Export for UI

    function freezeSlideLayout(slide) {
        if (!slide || _isFrozenMap.has(slide)) return;
        _isFrozenMap.set(slide, true);

        // Filter out system UI elements from the initial list
        const allEditables = getEditableElementsInSlide(slide);
        if (allEditables.length === 0) return;

        // Capture all positions FIRST before any element is moved
        const slideRect = slide.getBoundingClientRect();
        const data = allEditables.map(el => ({
            el,
            rect: el.getBoundingClientRect()
        }));

        // Save state ONCE for the whole batch
        saveState();

        // Normalize all elements using captured positions
        data.forEach(({ el, rect }) => {
            normalizeElement(el, slide, true, rect);
        });
    }

    function getInheritedStyles(el) {
        const style = window.getComputedStyle(el);
        return {
            fontSize: style.fontSize,
            fontFamily: style.fontFamily,
            color: style.color,
            lineHeight: style.lineHeight,
            textAlign: style.textAlign,
            fontWeight: style.fontWeight,
            letterSpacing: style.letterSpacing
        };
    }

    function normalizeElement(el, slide, silent = false, providedRect = null) {
        if (el._normalized) return;
        el._normalized = true;
        if (!silent) saveState();

        const rect = providedRect || el.getBoundingClientRect();
        const slideRect = slide.getBoundingClientRect();
        const inherited = getInheritedStyles(el);
        const style = window.getComputedStyle(el);

        const originalTransition = el.style.transition;
        el.style.transition = 'none';

        if (style.position !== 'absolute') {
            // Move to slide while maintaining z-index
            const currentZ = el.style.zIndex;
            if (el.parentElement !== slide) slide.appendChild(el);
            if (currentZ) el.style.zIndex = currentZ; // preserve

            const isText = el.matches('h1, h2, h3, h4, p, span, li, blockquote, .tag, .big-number, .big-label, cite');

            el.style.boxSizing = 'border-box';
            el.style.position = 'absolute';
            el.style.margin = '0';
            el.style.overflow = isText ? 'visible' : 'hidden'; // Allow text to grow/overflow if needed
            el.style.minHeight = '0';
            el.style.minWidth = '0';
            el.style.width = rect.width + 'px';
            el.style.height = isText ? 'auto' : (rect.height + 'px');
            el.style.minHeight = isText ? (rect.height + 'px') : '0'; // Maintain at least original height
            el.style.left = (rect.left - slideRect.left) + 'px';
            el.style.top = (rect.top - slideRect.top) + 'px';
            el.style.transform = 'none';
        } else {
            // Already absolute - DO NOT move in DOM, only update coordinates
            // Moving in DOM would break the z-order established by Send to Back/Front
            const isText = el.matches('h1, h2, h3, h4, p, span, li, blockquote, .tag, .big-number, .big-label, cite');
            el.style.boxSizing = 'border-box';
            el.style.margin = '0';
            el.style.overflow = isText ? 'visible' : 'hidden';
            el.style.minHeight = '0';
            el.style.minWidth = '0';
            el.style.width = rect.width + 'px';
            el.style.height = isText ? 'auto' : (rect.height + 'px');
            el.style.minHeight = isText ? (rect.height + 'px') : '0';
            el.style.left = (rect.left - slideRect.left) + 'px';
            el.style.top = (rect.top - slideRect.top) + 'px';
            el.style.transform = 'none';
        }

        el.style.fontSize = inherited.fontSize;
        el.style.fontFamily = inherited.fontFamily;
        el.style.color = inherited.color;
        el.style.lineHeight = inherited.lineHeight;

        const textElements = el.querySelectorAll('h1, h2, h3, h4, p, span, li, .big-number, .big-label, .tag');
        textElements.forEach(item => {
            const comp = window.getComputedStyle(item);
            item.style.fontSize = comp.fontSize;
        });

        setTimeout(() => {
            if (el) el.style.transition = originalTransition;
        }, 50);
    }

    /**
     * Helper to get all editable elements in the same slide, excluding the one being edited.
     */
    function getEditableElementsInSlide(slide, excludeEl) {
        if (!slide) return [];
        return Array.from(slide.querySelectorAll(window.editableSelectors || editableSelectors))
            .filter(el => {
                if (el === excludeEl) return false;
                if (el.style.display === 'none' || el.style.visibility === 'hidden') return false;
                if (el.matches(ignoreSelectors) || el.closest(ignoreSelectors)) return false;

                // Exclude children and ancestors of the current element
                if (excludeEl && (excludeEl.contains(el) || el.contains(excludeEl))) return false;

                return true;
            });
    }

    /**
     * Check if two rectangles intersect.
     */
    function rectIntersects(r1, r2) {
        const margin = 2; // tolerance minimum in px
        return !(r2.left >= r1.left + r1.width - margin ||
            r2.left + r2.width <= r1.left + margin ||
            r2.top >= r1.top + r1.height - margin ||
            r2.top + r2.height <= r1.top + margin);
    }

    /**
     * Get element position and size relative to its slide container.
     */
    function getElementRect(el, slide) {
        if (!el || !slide) return { left: 0, top: 0, width: 0, height: 0 };
        const r = el.getBoundingClientRect();
        const s = slide.getBoundingClientRect();
        return {
            left: r.left - s.left,
            top: r.top - s.top,
            width: r.width,
            height: r.height
        };
    }

    /**
     * Clamps element position to slide boundaries.
     */
    function resolveDragCollision(proposedRect, slide, excludeEl) {
        return {
            left: proposedRect.left,
            top: proposedRect.top,
        };
    }

    /**
     * Clamps resizing to slide boundaries and enforces minimum size.
     */
    function resolveResizeCollision(proposedRect, handle, slide, excludeEl, fixed = {}) {
        const minSize = 20;

        let res = { ...proposedRect };

        // Min size enforcement
        if (res.width < minSize) {
            res.width = minSize;
            if (handle.includes('w') && fixed.fixedRight !== undefined) {
                res.left = fixed.fixedRight - minSize;
            }
        }
        if (res.height < minSize) {
            res.height = minSize;
            if (handle.includes('n') && fixed.fixedBottom !== undefined) {
                res.top = fixed.fixedBottom - minSize;
            }
        }

        return res;
    }


    document.body.addEventListener('mousedown', (e) => {
        if (_isLocked) return;
        ensureUI();

        // Ignore if clicking on our own tools
        if (e.target.closest('.eidos-selection-box') || e.target.closest('.eidos-toolbar') || e.target.closest('.eidos-color-picker')) {
            return;
        }

        // Allow text cursor placement without dragging if already in edit mode
        if (e.target.closest('[contenteditable="true"]')) {
            return;
        }

        // Use elementsFromPoint to pierce z-index stacking
        // This allows selecting elements that are visually behind others
        const allUnderCursor = document.elementsFromPoint(e.clientX, e.clientY);

        // Find the best target: prefer the topmost editable that matches,
        // but if the user clicked directly on an editable (e.target), use that first.
        let target = e.target.closest(editableSelectors);

        // If no target found via native hit-test, scan all elements at this point
        if (!target) {
            for (const el of allUnderCursor) {
                if (el.closest('.eidos-selection-box') || el.closest('.eidos-toolbar')) continue;
                const match = el.closest(editableSelectors);
                if (match) {
                    target = match;
                    break;
                }
            }
        }

        if (target) {
            // Select it (visual only for now)
            selectElement(target);

            isDragging = true;
            dragGroup = [];
            startX = e.clientX;
            startY = e.clientY;

            // We don't normalize (rip out of DOM) immediately on click.
            // We wait until the mouse actually moves to avoid breaking layouts on simple clicks.
            const rect = target.getBoundingClientRect();
            const slide = target.closest('.s') || target.closest('section') || document.body;
            const slideRect = slide.getBoundingClientRect();

            startLeft = rect.left - slideRect.left;
            startTop = rect.top - slideRect.top;

            // Grouping Logic: Find elements inside this one
            const isContainer = target.matches('div.card, div.stat-box, div.step-item, div.timeline-item, .img-slot, [class*="card"], [class*="box"]');
            if (isContainer) {
                const others = getEditableElementsInSlide(slide, target);
                others.forEach(other => {
                    const otherRect = other.getBoundingClientRect();
                    if (otherRect.left >= rect.left &&
                        otherRect.right <= rect.right &&
                        otherRect.top >= rect.top &&
                        otherRect.bottom <= rect.bottom) {

                        dragGroup.push({
                            el: other,
                            startLeft: otherRect.left - slideRect.left,
                            startTop: otherRect.top - slideRect.top
                        });
                    }
                });
            }

            // Build snap targets
            snapLinesX = [];
            snapLinesY = [];
            if (slide) {
                const sRect = slide.getBoundingClientRect();
                snapLinesX.push({ val: sRect.width / 2 });
                snapLinesX.push({ val: 0 });
                snapLinesX.push({ val: sRect.width });
                snapLinesY.push({ val: sRect.height / 2 });
                snapLinesY.push({ val: 0 });
                snapLinesY.push({ val: sRect.height });

                const padding = 40;
                snapLinesX.push({ val: padding });
                snapLinesX.push({ val: sRect.width - padding });
                snapLinesY.push({ val: padding });
                snapLinesY.push({ val: sRect.height - padding });

                const others = slide.querySelectorAll(editableSelectors);
                others.forEach(el => {
                    if (el === target || el.classList.contains('eidos-phantom')) return;
                    const oRect = el.getBoundingClientRect();
                    const rL = oRect.left - sRect.left;
                    const rT = oRect.top - sRect.top;

                    snapLinesX.push({ val: rL });
                    snapLinesX.push({ val: rL + oRect.width / 2 });
                    snapLinesX.push({ val: rL + oRect.width });

                    snapLinesY.push({ val: rT });
                    snapLinesY.push({ val: rT + oRect.height / 2 });
                    snapLinesY.push({ val: rT + oRect.height });
                });
            }

            if (e.target.contentEditable !== 'true') {
                e.preventDefault();
            }
        } else {
            deselectGroup();
        }
    });

    // Cleanup _stateSavedSinceMousedown on mouseup
    document.addEventListener('mouseup', () => {
        isDragging = false;
        isResizing = false;
        currentHandle = null;
        dragGroup = [];
        guideH.style.display = 'none';
        guideV.style.display = 'none';

        if (selectedElement) {
            delete selectedElement._normalized;
            updateSelectionBox();
        }

        // Reset the flag for the next mousedown
        const allEditables = document.querySelectorAll(editableSelectors);
        allEditables.forEach(el => delete el._stateSavedSinceMousedown);
    });

    // Prevent click events on the selection UI from bubbling to the background deselect listener
    selectionBox.addEventListener('click', (e) => e.stopPropagation());
    toolbar.addEventListener('click', (e) => e.stopPropagation());

    // Handle double-click to edit text
    document.body.addEventListener('dblclick', (e) => {
        if (_isLocked) return;
        const textSelectors = 'h1, h2, h3, h4, p, span, li, blockquote, .tag, .big-number, .big-label, cite';
        const textTarget = e.target.closest(textSelectors);
        if (textTarget && (!textTarget.closest('.eidos-toolbar'))) {
            // Ensure element is normalized (absolute positioned) so it doesn't push other text
            if (!textTarget._normalized) {
                const slide = textTarget.closest('.s') || textTarget.closest('section') || document.body;
                normalizeElement(textTarget, slide);
            }

            textTarget.contentEditable = "true";
            textTarget.style.outline = "none"; // Hide browser focus box, use ours
            textTarget.style.boxShadow = "none";
            textTarget.style.height = "auto"; // Allow growth during editing
            textTarget.style.overflow = "visible";
            textTarget.focus();

            // Store current bottom point to grow upwards
            const rect = textTarget.getBoundingClientRect();
            const slide = textTarget.closest('.s') || document.body;
            const slideRect = slide.getBoundingClientRect();
            textTarget._baseBottom = rect.bottom - slideRect.top;

            // Make selection box non-interactive so we can edit text through it
            selectionBox.style.pointerEvents = "none";
            selectionBox.classList.add('eidos-editing-text');

            // Select all text
            const range = document.createRange();
            range.selectNodeContents(textTarget);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            e.stopPropagation();

            textTarget.addEventListener('blur', function onBlur() {
                textTarget.contentEditable = "false";
                textTarget.style.outline = "";
                // Use getBoundingClientRect for more accurate height after text change
                const newHeight = textTarget.getBoundingClientRect().height;
                textTarget.style.height = newHeight + "px";
                delete textTarget._baseBottom;
                textTarget.removeEventListener('blur', onBlur);
                window.getSelection().removeAllRanges();

                selectionBox.style.pointerEvents = "auto";
                selectionBox.classList.remove('eidos-editing-text');

                saveState(); // Save the new text to history
            }, { once: true });
        }
    });

    // Handle Paste as Plain Text (Clean & Safe version)
    document.addEventListener('paste', (e) => {
        const target = e.target.closest('[contenteditable="true"]');
        if (!target) return;

        e.preventDefault();
        const clipboardData = e.clipboardData || window.clipboardData;
        const text = clipboardData.getData('text/plain') || clipboardData.getData('text');

        if (text) {
            try {
                // This is the standard way to insert text into contenteditable
                // It maintains undo/redo history and works in most modern browsers.
                document.execCommand('insertText', false, text);
            } catch (err) {
                // Minimal fallback for restricted environments
                const selection = window.getSelection();
                if (selection.rangeCount) {
                    const range = selection.getRangeAt(0);
                    range.deleteContents();
                    range.insertNode(document.createTextNode(text));
                    range.collapse(false); // Move cursor to end of inserted text
                }
            }
        }
    });

    selectionBox.addEventListener('dblclick', (e) => {
        if (_isLocked) return;
        e.stopPropagation();
        if (!selectedElement) return;

        // If it's an image slot, trigger the picker in the parent
        if (selectedElement.dataset.imageSlot !== undefined) {
            if (window.parent && window.parent._eidosTriggerImagePicker) {
                window.parent._eidosTriggerImagePicker(selectedElement);
            } else {
                // Fallback to event if direct call fails
                document.dispatchEvent(new CustomEvent('eidos-trigger-image-picker', {
                    detail: { element: selectedElement },
                    bubbles: true
                }));
            }
            return;
        }

        // Find if the selected element is editable text or contains editable text
        const isEditable = (el) => el && el.matches('h1, h2, h3, h4, p, span, li, blockquote, .tag, .big-number, .big-label, cite');
        let textTarget = isEditable(selectedElement) ? selectedElement : selectedElement.querySelector('h1, h2, h3, h4, p, span, li, blockquote, .tag, .big-number, .big-label, cite');

        if (textTarget && !textTarget.closest('.eidos-toolbar')) {
            // Ensure element is normalized
            if (!textTarget._normalized) {
                const slide = textTarget.closest('.s') || textTarget.closest('section') || document.body;
                normalizeElement(textTarget, slide);
            }

            // DO NOT hide selection box anymore, we want it to guide the user
            // selectionBox.style.display = 'none';
            // toolbar.style.display = 'none';

            textTarget.contentEditable = "true";
            textTarget.style.outline = "none";
            textTarget.style.boxShadow = "none";
            textTarget.style.height = "auto";
            textTarget.style.overflow = "visible";
            textTarget.focus();

            // Store current bottom point to grow upwards
            const rect = textTarget.getBoundingClientRect();
            const slide = textTarget.closest('.s') || document.body;
            const slideRect = slide.getBoundingClientRect();
            textTarget._baseBottom = rect.bottom - slideRect.top;

            selectionBox.style.pointerEvents = "none";
            selectionBox.classList.add('eidos-editing-text');

            // Select all text
            const range = document.createRange();
            range.selectNodeContents(textTarget);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            textTarget.addEventListener('blur', function onBlur() {
                textTarget.contentEditable = "false";
                textTarget.style.outline = "";
                const newHeight = textTarget.getBoundingClientRect().height;
                textTarget.style.height = newHeight + "px";
                delete textTarget._baseBottom;
                textTarget.removeEventListener('blur', onBlur);
                window.getSelection().removeAllRanges();

                selectionBox.style.pointerEvents = "auto";
                selectionBox.classList.remove('eidos-editing-text');

                saveState(); // Save the new text to history

                // restore selection box interaction
                selectElement(selectedElement);
            }, { once: true });
        }
    });

    selectionBox.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('eidos-resize-handle')) {
            e.stopPropagation();
            if (!selectedElement) return;

            saveState(); // Save state before resize

            isResizing = true;
            currentHandle = e.target.dataset.handler;
            startX = e.clientX;
            startY = e.clientY;

            const rect = selectedElement.getBoundingClientRect();
            const slide = selectedElement.closest('.s') || selectedElement.closest('section') || document.body;
            const slideRect = slide.getBoundingClientRect();

            startWidth = rect.width;
            startHeight = rect.height;
            startLeft = rect.left - slideRect.left;
            startTop = rect.top - slideRect.top;
            e.preventDefault();
        } else if (!e.target.classList.contains('eidos-resize-handle')) {
            // Drag via selection box proxy (anywhere that isn't a handle)
            e.stopPropagation();
            if (!selectedElement) return;

            saveState(); // Save state before drag

            isDragging = true;
            dragGroup = [];
            startX = e.clientX;
            startY = e.clientY;

            const rect = selectedElement.getBoundingClientRect();
            const slide = selectedElement.closest('.s') || selectedElement.closest('section') || document.body;
            const slideRect = slide.getBoundingClientRect();

            startLeft = rect.left - slideRect.left;
            startTop = rect.top - slideRect.top;

            // Grouping Logic for Proxy Drag
            const isContainer = selectedElement.matches('div.card, div.stat-box, div.step-item, div.timeline-item, .img-slot, [class*="card"], [class*="box"]');
            if (isContainer) {
                const others = getEditableElementsInSlide(slide, selectedElement);
                others.forEach(other => {
                    const otherRect = other.getBoundingClientRect();
                    if (otherRect.left >= rect.left &&
                        otherRect.right <= rect.right &&
                        otherRect.top >= rect.top &&
                        otherRect.bottom <= rect.bottom) {

                        dragGroup.push({
                            el: other,
                            startLeft: otherRect.left - slideRect.left,
                            startTop: otherRect.top - slideRect.top
                        });
                    }
                });
            }

            e.preventDefault();
        }
    });


    document.addEventListener('mousemove', (e) => {
        if (!selectedElement) return;

        const slide = selectedElement.closest('.s') || selectedElement.closest('section') || document.body;

        if (isDragging || isResizing) {
            const dx = (e.clientX - startX);
            const dy = (e.clientY - startY);

            // NORMALIZATION ON DEMAND: Rip out of DOM when user actually starts transforming.
            if (!selectedElement._normalized && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
                normalizeElement(selectedElement, slide);

                // Also normalize everything in the group
                dragGroup.forEach(item => {
                    if (!item.el._normalized) normalizeElement(item.el, slide);
                });

                // After normalization, we MUST reset the base values because style.left/top
                // might differ from the visual start coordinates captured in mousedown.
                startWidth = parseFloat(selectedElement.style.width);
                startHeight = parseFloat(selectedElement.style.height);
                startLeft = parseFloat(selectedElement.style.left);
                startTop = parseFloat(selectedElement.style.top);

                // Update start group positions based on normalized state
                dragGroup.forEach(item => {
                    item.startLeft = parseFloat(item.el.style.left);
                    item.startTop = parseFloat(item.el.style.top);
                });

                startX = e.clientX;
                startY = e.clientY;
            }
        }

        if (isDragging) {
            if (!selectedElement._normalized) return;

            let newLeft = startLeft + (e.clientX - startX);
            let newTop = startTop + (e.clientY - startY);

            // 1. Resolve Collision
            const eRect = selectedElement.getBoundingClientRect();
            const resolved = resolveDragCollision({
                left: newLeft,
                top: newTop,
                width: eRect.width,
                height: eRect.height
            }, slide, selectedElement);

            newLeft = resolved.left;
            newTop = resolved.top;

            // 2. Snapping Logic
            if (slide) {
                const sRect = slide.getBoundingClientRect();
                // Use updated rect for snapping
                const myLinesX = [newLeft, newLeft + eRect.width / 2, newLeft + eRect.width];
                const myLinesY = [newTop, newTop + eRect.height / 2, newTop + eRect.height];

                const snapTolerance = 8;
                let bestSnapX = null, bestDiffX = 0, minDistX = snapTolerance;

                for (let mx of myLinesX) {
                    for (let tg of snapLinesX) {
                        const dist = Math.abs(mx - tg.val);
                        if (dist < minDistX) {
                            minDistX = dist;
                            bestSnapX = tg.val;
                            bestDiffX = tg.val - mx;
                        }
                    }
                }

                if (bestSnapX !== null) {
                    newLeft += bestDiffX;
                    // Guides are in document.body, so add slide offset
                    guideV.style.left = (sRect.left + bestSnapX) + 'px';
                    guideV.style.top = '0px';
                    guideV.style.height = '100%';
                    guideV.style.display = 'block';
                } else {
                    guideV.style.display = 'none';
                }

                let bestSnapY = null, bestDiffY = 0, minDistY = snapTolerance;

                for (let my of myLinesY) {
                    for (let tg of snapLinesY) {
                        const dist = Math.abs(my - tg.val);
                        if (dist < minDistY) {
                            minDistY = dist;
                            bestSnapY = tg.val;
                            bestDiffY = tg.val - my;
                        }
                    }
                }

                if (bestSnapY !== null) {
                    newTop += bestDiffY;
                    // Guides are in document.body, so add slide offset
                    guideH.style.top = (sRect.top + bestSnapY) + 'px';
                    guideH.style.left = '0px';
                    guideH.style.width = '100%';
                    guideH.style.display = 'block';
                } else {
                    guideH.style.display = 'none';
                }
            }

            selectedElement.style.left = `${newLeft}px`;
            selectedElement.style.top = `${newTop}px`;

            // Apply same offset to drag group
            const groupDx = newLeft - startLeft;
            const groupDy = newTop - startTop;
            dragGroup.forEach(item => {
                item.el.style.left = (item.startLeft + groupDx) + 'px';
                item.el.style.top = (item.startTop + groupDy) + 'px';
            });

            updateSelectionBox();

        } else if (isResizing) {
            if (!selectedElement._normalized) return;

            const dx = (e.clientX - startX);
            const dy = (e.clientY - startY);

            let newWidth = startWidth;
            let newHeight = startHeight;
            let newLeft = startLeft;
            let newTop = startTop;

            if (currentHandle.includes('e')) newWidth = startWidth + dx;
            if (currentHandle.includes('s')) newHeight = startHeight + dy;
            if (currentHandle.includes('w')) {
                newWidth = startWidth - dx;
                newLeft = startLeft + dx;
            }
            if (currentHandle.includes('n')) {
                newHeight = startHeight - dy;
                newTop = startTop + dy;
            }

            const fixedRight = startLeft + startWidth;
            const fixedBottom = startTop + startHeight;

            const resolved = resolveResizeCollision({
                left: newLeft, top: newTop, width: newWidth, height: newHeight
            }, currentHandle, slide, selectedElement, { fixedRight, fixedBottom });

            newLeft = resolved.left;
            newTop = resolved.top;
            newWidth = resolved.width;
            newHeight = resolved.height;

            const sRect = slide.getBoundingClientRect();

            // 2. Snapping for Resize
            if (slide) {
                const snapTolerance = 8;

                // Snap X (left or right edge depending on handle)
                if (currentHandle.includes('w')) {
                    let bestSnapX = null, bestDiffX = 0, minDistX = snapTolerance;
                    for (let tg of snapLinesX) {
                        const dist = Math.abs(newLeft - tg.val);
                        if (dist < minDistX) {
                            minDistX = dist;
                            bestSnapX = tg.val;
                            bestDiffX = tg.val - newLeft;
                        }
                    }
                    if (bestSnapX !== null) {
                        newLeft += bestDiffX;
                        newWidth -= bestDiffX;
                        guideV.style.left = (sRect.left + bestSnapX) + 'px';
                        guideV.style.top = '0px';
                        guideV.style.height = '100%';
                        guideV.style.display = 'block';
                    } else {
                        guideV.style.display = 'none';
                    }
                } else if (currentHandle.includes('e')) {
                    let rightEdge = newLeft + newWidth;
                    let bestSnapX = null, bestDiffX = 0, minDistX = snapTolerance;
                    for (let tg of snapLinesX) {
                        const dist = Math.abs(rightEdge - tg.val);
                        if (dist < minDistX) {
                            minDistX = dist;
                            bestSnapX = tg.val;
                            bestDiffX = tg.val - rightEdge;
                        }
                    }
                    if (bestSnapX !== null) {
                        newWidth += bestDiffX;
                        guideV.style.left = (sRect.left + bestSnapX) + 'px';
                        guideV.style.top = '0px';
                        guideV.style.height = '100%';
                        guideV.style.display = 'block';
                    } else {
                        guideV.style.display = 'none';
                    }
                }

                // Snap Y (top or bottom edge depending on handle)
                if (currentHandle.includes('n')) {
                    let bestSnapY = null, bestDiffY = 0, minDistY = snapTolerance;
                    for (let tg of snapLinesY) {
                        const dist = Math.abs(newTop - tg.val);
                        if (dist < minDistY) {
                            minDistY = dist;
                            bestSnapY = tg.val;
                            bestDiffY = tg.val - newTop;
                        }
                    }
                    if (bestSnapY !== null) {
                        newTop += bestDiffY;
                        newHeight -= bestDiffY;
                        guideH.style.top = (sRect.top + bestSnapY) + 'px';
                        guideH.style.left = '0px';
                        guideH.style.width = '100%';
                        guideH.style.display = 'block';
                    } else {
                        guideH.style.display = 'none';
                    }
                } else if (currentHandle.includes('s')) {
                    let bottomEdge = newTop + newHeight;
                    let bestSnapY = null, bestDiffY = 0, minDistY = snapTolerance;
                    for (let tg of snapLinesY) {
                        const dist = Math.abs(bottomEdge - tg.val);
                        if (dist < minDistY) {
                            minDistY = dist;
                            bestSnapY = tg.val;
                            bestDiffY = tg.val - bottomEdge;
                        }
                    }
                    if (bestSnapY !== null) {
                        newHeight += bestDiffY;
                        guideH.style.top = (sRect.top + bestSnapY) + 'px';
                        guideH.style.left = '0px';
                        guideH.style.width = '100%';
                        guideH.style.display = 'block';
                    } else {
                        guideH.style.display = 'none';
                    }
                }
            }

            // 3. Apply changes (Min sizes are already enforced by resolveResizeCollision)
            selectedElement.style.minHeight = '0';
            selectedElement.style.minWidth = '0';
            selectedElement.style.overflow = 'hidden';

            selectedElement.style.width = `${newWidth}px`;
            selectedElement.style.height = `${newHeight}px`;
            selectedElement.style.left = `${newLeft}px`;
            selectedElement.style.top = `${newTop}px`;

            updateSelectionBox();

        }
    });

    function selectElement(el) {
        if (!el || selectedElement === el) return;
        if (_isLocked) return;

        const slide = el.closest('.s') || el.closest('section') || document.body;

        // Freeze layout of the whole slide immediately to prevent reflows during editing
        freezeSlideLayout(slide);

        if (selectionObserver) selectionObserver.disconnect();

        // Ensure the iframe has focus so keyboard shortcuts (Ctrl+C/V/D) work immediately
        window.focus();

        selectedElement = el;

        // CRITICAL FIX: Keep UI tools in document body to avoid 'overflow: hidden' clipping in slides.
        // We ensure they are always present and visible.
        ensureUI();

        // Refresh toolbar content
        toolbar.innerHTML = getToolbarHTML();
        bindToolbarEvents();

        // Ensure tools are always above everything else
        selectionBox.style.zIndex = '10000';
        toolbar.style.zIndex = '10001';


        updateSelectionBox();
        updateSizeDisplay();
        const colorPicker = document.getElementById('eidos-color-picker');
        if (colorPicker) colorPicker.style.display = 'none';

        // Observe changes to the element (like style or classes) to update the selection box automatically
        selectionObserver = new MutationObserver((mutations) => {
            updateSelectionBox();

            // If the element's Z-index changed or it was moved in DOM, refresh tool z-index
            const elStyle = window.getComputedStyle(el);
            const elZ = parseInt(elStyle.zIndex) || 1;
            selectionBox.style.zIndex = Math.max(1000, elZ + 1);
            toolbar.style.zIndex = Math.max(1001, elZ + 2);
        });
        selectionObserver.observe(el, {
            attributes: true,
            attributeFilter: ['style', 'class'],
            characterData: true,
            subtree: true
        });

        // Add ResizeObserver for robust layout tracking (growth, text wrapping, etc)
        if (window.ResizeObserver) {
            const resizeObs = new ResizeObserver(() => {
                // If editing and we want to grow upwards, adjust 'top' based on new height
                if (el.isContentEditable && el._baseBottom !== undefined) {
                    const rect = el.getBoundingClientRect();
                    const slide = el.closest('.s') || document.body;
                    const slideRect = slide.getBoundingClientRect();
                    const currentHeight = rect.height;
                    const newTop = el._baseBottom - currentHeight;
                    el.style.top = newTop + "px";
                }
                updateSelectionBox();
            });
            resizeObs.observe(el);
            selectionObserver._resizeObs = resizeObs;
        }

        // Notify parent UI
        window.dispatchEvent(new CustomEvent('eidos-selection-changed', { detail: { element: el } }));

        // Mark as just selected to prevent immediate deselection by trailing click events
        _justSelected = true;
        setTimeout(() => { _justSelected = false; }, 250);
    }

    function deselectGroup(silent = false) {
        if (selectionObserver) {
            if (selectionObserver._parentObs) selectionObserver._parentObs.disconnect();
            if (selectionObserver._resizeObs) selectionObserver._resizeObs.disconnect();
            selectionObserver.disconnect();
            selectionObserver = null;
        }

        selectedElement = null;
        selectionBox.style.display = 'none';
        toolbar.style.display = 'none';

        const colorPicker = document.getElementById('eidos-color-picker');
        if (colorPicker) colorPicker.style.display = 'none';

        // Notify parent UI only if not silent
        if (!silent) {
            window.dispatchEvent(new CustomEvent('eidos-selection-changed', { detail: { element: null } }));
        }
    }

    function updateSelectionBox() {
        if (!selectedElement) return;
        const rect = selectedElement.getBoundingClientRect();

        // Tools are now in document.body, so use absolute viewport coordinates
        // rect.left/top are already correct relative to the document viewport inside the iframe.
        const left = rect.left;
        const top = rect.top;

        selectionBox.style.left = `${left}px`;
        selectionBox.style.top = `${top}px`;
        selectionBox.style.width = `${rect.width}px`;
        selectionBox.style.height = `${rect.height}px`;

        if (rect.width < 50 || rect.height < 50) {
            selectionBox.classList.add('eidos-small-selection');
        } else {
            selectionBox.classList.remove('eidos-small-selection');
        }

        if (!isDragging && !isResizing) {
            toolbar.style.display = 'flex';
            selectionBox.style.display = 'block';
        } else {
            toolbar.style.display = 'none';
        }

        // SMART POSITIONING: Keep toolbar within window boundaries
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        const tbWidth = toolbar.offsetWidth || 340;

        let toolbarTop = top - 56;
        let toolbarLeft = left;

        // 1. Vertical check
        if (toolbarTop < 10) {
            toolbarTop = top + rect.height + 12;
        }

        // 2. Vertical check bottom
        if (toolbarTop + 46 > winH - 10) {
            toolbarTop = top - 56;
            if (toolbarTop < 0) toolbarTop = 10;
        }

        // 3. Horizontal check
        if (toolbarLeft + tbWidth > winW - 12) {
            toolbarLeft = winW - tbWidth - 12;
        }
        if (toolbarLeft < 12) toolbarLeft = 12;

        toolbar.style.left = `${toolbarLeft}px`;
        toolbar.style.top = `${toolbarTop}px`;

        if (!isDragging && !isResizing) {
            toolbar.style.opacity = '1';
            toolbar.style.transform = 'translateY(0)';
        }
    }

    // --- UNDO / REDO LOGIC ---
    function getCleanHTML() {
        // Optimization: Use cloneNode instead of innerHTML parsing for cloning.
        // Also avoid double-pass by serializing only once at the end.
        const bodyClone = document.body.cloneNode(true);

        // Remove system UI elements that shouldn't be in the state history
        // NOTE: We keep .img-replace-overlay (tooltips) in the history to prevent flicker.
        // Final exports (PPTX/PDF) clean them up separately anyway.
        const toRemove = bodyClone.querySelectorAll('.eidos-selection-box, .eidos-toolbar, .eidos-guide, .eidos-color-picker');
        toRemove.forEach(el => el.remove());

        return bodyClone.innerHTML;
    }

    function getCurrentSlideIndex() {
        const slides = Array.from(document.querySelectorAll('section, .s, [class*="slide"]'));
        if (slides.length === 0) return 0;

        // 1. Check parent state first
        try {
            if (window.parent && window.parent.eidosCurrentSlide !== undefined) {
                return window.parent.eidosCurrentSlide;
            }
        } catch (e) { }

        // 2. Check for .active class
        const activeIdx = slides.findIndex(s => s.classList.contains('active'));
        if (activeIdx !== -1) return activeIdx;

        // 3. Calculation based on container transform (most robust)
        const container = slides[0].parentElement;
        if (container) {
            const transform = window.getComputedStyle(container).transform;
            if (transform && transform !== 'none') {
                const matrix = new DOMMatrix(transform);
                const x = Math.abs(matrix.e); // The horizontal translation
                // Slide width is usually 1122px in this app
                const slideWidth = 1122;
                return Math.round(x / slideWidth);
            }
        }

        return 0;
    }

    function saveState() {
        if (_isRestoring) return;
        // Performance: Optimization to avoid getCleanHTML() on every save call.
        // We only serialize if we're not likely at the current state.
        const state = getCleanHTML();

        // Always try to get the current index from parent (most reliable)
        const slideIndex = (window.parent && window.parent.eidosCurrentSlide !== undefined)
            ? window.parent.eidosCurrentSlide
            : getCurrentSlideIndex();

        // Don't save if it's identical HTML to avoid duplicate history points
        if (historyIndex !== -1 && history[historyIndex].html === state) {
            return;
        }

        // Truncate history forward if we are in the middle of it
        history.splice(historyIndex + 1);
        history.push({ html: state, slideIndex: slideIndex });

        // Limit history size to 50
        if (history.length > 50) history.shift();
        historyIndex = history.length - 1;
    }

    // Initial Save!
    setTimeout(saveState, 500);

    function undo() {
        if (historyIndex > 0) {
            // Only save if index is at the tail
            if (historyIndex === history.length - 1) saveState();
            historyIndex--;
            restoreState(history[historyIndex]);
        }
    }

    function redo() {
        if (historyIndex < history.length - 1) {
            historyIndex++;
            restoreState(history[historyIndex]);
        }
    }

    function restoreState(entry) {
        if (!entry || !entry.html) return;

        // Fast-path: don't restore if already there
        if (document.body.innerHTML === entry.html) return;

        _isRestoring = true;
        deselectGroup(true); // SILENT deselect during restoration

        document.body.innerHTML = entry.html;

        // Re-inject UI and bindings into documentElement (outside body transform context)
        ensureUI();

        // Re-init lucide icons ONLY if they are likely present as original i tags
        if (window.lucide && document.body.querySelector('i[data-lucide]')) {
            window.lucide.createIcons();
        }

        // Notify parent that state changed significantly (slides might have been added/removed)
        // Pass 'needsOverlayRebuild' so app.js can re-inject image slot overlays
        // Pass 'slideIndex' to restore scroll position
        window.dispatchEvent(new CustomEvent('eidos-state-restored', {
            detail: {
                needsOverlayRebuild: true
            }
        }));

        // Brief timeout to allow observers to settle before unlocking state saves
        setTimeout(() => { _isRestoring = false; }, 100);
    }


    function duplicateElement(el) {
        saveState();
        const slide = el.closest('.s') || el.closest('section') || document.body;
        normalizeElement(el, slide);

        const clone = el.cloneNode(true);
        // remove any tracking state inside clone if needed
        delete clone._stateSavedSinceMousedown;

        const currentLeft = parseFloat(clone.style.left) || 0;
        const currentTop = parseFloat(clone.style.top) || 0;
        clone.style.left = (currentLeft + 20) + 'px';
        clone.style.top = (currentTop + 20) + 'px';

        // Since it's normalized, it should be appended to the slide to maintain absolute coordinates
        slide.appendChild(clone);
        selectElement(clone);
    }

    document.addEventListener('keydown', (e) => {
        // Support arrow navigation even when locked (for presentation mode)
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
            const isEditingText = activeTag === 'input' || activeTag === 'textarea' || (document.activeElement && document.activeElement.isContentEditable);

            // If nothing is selected or locked, we let it bubble out or handle it as slide navigation
            if (!isEditingText && (!selectedElement || _isLocked)) {
                if (e.key === 'ArrowLeft') {
                    window.dispatchEvent(new CustomEvent('eidos-navigate-prev'));
                } else {
                    window.dispatchEvent(new CustomEvent('eidos-navigate-next'));
                }
                e.preventDefault();
                return;
            }
        }

        if (_isLocked) return;
        // Ignore if native text editing
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        const isEditingText = activeTag === 'input' || activeTag === 'textarea' || (document.activeElement && document.activeElement.isContentEditable);

        if (e.ctrlKey || e.metaKey) {
            if (e.key.toLowerCase() === 'z') {
                if (e.shiftKey) {
                    redo();
                } else {
                    undo();
                }
                e.preventDefault();
            } else if (e.key.toLowerCase() === 'y') {
                redo();
                e.preventDefault();
            } else if (e.key.toLowerCase() === 'c' && !isEditingText) {
                if (selectedElement) {
                    const slide = selectedElement.closest('.s') || selectedElement.closest('section') || document.body;
                    normalizeElement(selectedElement, slide);
                    _clipboard = selectedElement.cloneNode(true);
                    // Show brief visual feedback
                    selectedElement.style.outline = '2px solid rgba(255,255,255,0.6)';
                    setTimeout(() => { if (selectedElement) selectedElement.style.outline = ''; }, 300);
                    e.preventDefault();
                }
            } else if (e.key.toLowerCase() === 'x' && !isEditingText) {
                if (selectedElement) {
                    const slide = selectedElement.closest('.s') || selectedElement.closest('section') || document.body;
                    normalizeElement(selectedElement, slide);
                    _clipboard = selectedElement.cloneNode(true);
                    deleteElement(selectedElement);
                    e.preventDefault();
                }
            } else if (e.key.toLowerCase() === 'v' && !isEditingText) {
                if (_clipboard) {
                    saveState();
                    const clone = _clipboard.cloneNode(true);
                    // Offset slightly so it's visible
                    const curLeft = parseFloat(clone.style.left) || 0;
                    const curTop = parseFloat(clone.style.top) || 0;
                    clone.style.left = (curLeft + 20) + 'px';
                    clone.style.top = (curTop + 20) + 'px';
                    // Paste into the current active slide
                    const activeSlide = document.querySelector('section.active') || document.querySelector('section') || document.body;
                    activeSlide.appendChild(clone);
                    selectElement(clone);
                    e.preventDefault();
                }
            } else if (e.key.toLowerCase() === 'd') {
                e.preventDefault();
                if (isEditingText) return;

                if (selectedElement) {
                    duplicateElement(selectedElement);
                } else {
                    window.dispatchEvent(new CustomEvent('eidos-duplicate-slide'));
                }
            }
        } else if (!isEditingText) {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedElement) {
                    deleteElement(selectedElement);
                    e.preventDefault();
                }
            } else if (e.key.startsWith('Arrow')) {
                if (selectedElement) {
                    e.preventDefault();
                    if (!selectedElement._undoSavingArrow) {
                        saveState();
                        selectedElement._undoSavingArrow = true;
                        setTimeout(() => selectedElement._undoSavingArrow = false, 500);
                    }
                    let newLeft = parseFloat(selectedElement.style.left) || 0;
                    let newTop = parseFloat(selectedElement.style.top) || 0;
                    const amount = e.shiftKey ? 10 : 1;

                    if (e.key === 'ArrowUp') newTop -= amount;
                    if (e.key === 'ArrowDown') newTop += amount;
                    if (e.key === 'ArrowLeft') newLeft -= amount;
                    if (e.key === 'ArrowRight') newLeft += amount;

                    const slide = selectedElement.closest('.s') || selectedElement.closest('section') || document.body;
                    const eRect = selectedElement.getBoundingClientRect();
                    const resolved = resolveDragCollision({
                        left: newLeft,
                        top: newTop,
                        width: eRect.width,
                        height: eRect.height
                    }, slide, selectedElement);

                    selectedElement.style.left = `${resolved.left}px`;
                    selectedElement.style.top = `${resolved.top}px`;

                    updateSelectionBox();
                }
            }
        }
    });

    // Save initial state
    saveState();

    // Expose actions to parent
    window.eidosUndo = undo;
    window.eidosRedo = redo;
    window.eidosSaveState = saveState;
    window.eidosDeselect = deselectGroup;
    window.eidosUpdateSelection = updateSelectionBox;
    window.eidosGetSelection = () => selectedElement;
    window.eidosSelect = selectElement;
    window.eidosIsJustSelected = () => _justSelected;
    window.eidosIsDragging = () => isDragging || isResizing;
    window.eidosDuplicateSelection = () => { if (selectedElement) duplicateElement(selectedElement); };
    window.eidosDeleteSelection = () => deleteElement(selectedElement);
    window.eidosToFront = () => {
        if (!selectedElement) return;
        saveState();
        const parent = selectedElement.parentElement;

        // Strategy: Max z-index among siblings (excluding self) + 1
        const siblings = Array.from(parent.children).filter(s => s !== selectedElement);
        let maxZ = 1;
        siblings.forEach(s => {
            const style = window.getComputedStyle(s);
            let z = parseInt(style.zIndex);
            if (isNaN(z) && style.position !== 'static') z = 1;
            if (!isNaN(z) && z > maxZ) maxZ = z;
        });
        selectedElement.style.zIndex = maxZ + 1;

        parent.appendChild(selectedElement); // Physical move to end of DOM (front)
        updateSelectionBox();
    };
    window.eidosToBack = () => {
        if (!selectedElement) return;
        saveState();
        const parent = selectedElement.parentElement;

        // Strategy: Min z-index among siblings (excluding self) - 1
        const siblings = Array.from(parent.children).filter(s => s !== selectedElement);
        let minZ = 1000;
        let foundAny = false;
        siblings.forEach(s => {
            const style = window.getComputedStyle(s);
            let z = parseInt(style.zIndex);
            if (isNaN(z) && style.position !== 'static') z = 1;
            if (!isNaN(z)) {
                if (z < minZ) minZ = z;
                foundAny = true;
            }
        });
        if (!foundAny) minZ = 1;

        // Never go below 1 to avoid disappearing behind the section background
        selectedElement.style.zIndex = Math.max(1, minZ - 1);

        parent.prepend(selectedElement); // Physical move to start of DOM (back)
        updateSelectionBox();
    };
    window.eidosArrowMove = (key, shift) => {

        if (!selectedElement) return;
        if (!selectedElement._undoSavingArrow) {
            saveState();
            selectedElement._undoSavingArrow = true;
            setTimeout(() => selectedElement._undoSavingArrow = false, 500);
        }
        const amount = shift ? 10 : 1;
        let newLeft = parseFloat(selectedElement.style.left) || 0;
        let newTop = parseFloat(selectedElement.style.top) || 0;

        if (key === 'ArrowUp') newTop -= amount;
        if (key === 'ArrowDown') newTop += amount;
        if (key === 'ArrowLeft') newLeft -= amount;
        if (key === 'ArrowRight') newLeft += amount;

        const slide = selectedElement.closest('.s') || selectedElement.closest('section') || document.body;
        const eRect = selectedElement.getBoundingClientRect();
        const resolved = resolveDragCollision({
            left: newLeft,
            top: newTop,
            width: eRect.width,
            height: eRect.height
        }, slide, selectedElement);

        selectedElement.style.left = `${resolved.left}px`;
        selectedElement.style.top = `${resolved.top}px`;
        updateSelectionBox();
    };
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEditor);
} else {
    initEditor();
}
