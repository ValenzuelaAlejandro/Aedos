/**
 * Aedos Visual Editor
 * Injected into the presentation iframe to allow Canva-like editing.
 */
import { createAedosEditorSemantics } from '../features/editor/semantics.js';
import { createEditorHistory } from '../features/editor/history.js';
import { calculateEditorSelectionGeometry } from '../features/editor/selection-geometry.js';
import { resolveDragCollision, resolveResizeCollision } from '../features/editor/collision-geometry.js';
import { createEditorTargeting } from '../features/editor/targeting.js';
import { createEditorStyleSnapshot } from '../features/editor/style-snapshot.js';
import { createEditorSelectionUi } from '../features/editor/selection-ui.js';
import { createEditorSlideFreeze, createEditorElementNormalizer } from '../features/editor/slide-freeze.js';
import { createEditorSelectionLifecycle } from '../features/editor/selection-lifecycle.js';
import { createEditorKeyboardHandler } from '../features/editor/keyboard.js';
import { createEditorPasteHandler, createEditorTextEditingHandler } from '../features/editor/content-editing.js';
import { installEditorCompatibilityFacade } from '../features/editor/compatibility-facade.js';

function initEditor() {
    if (window._editorInitialized) return;
    window._editorInitialized = true;

    let _isLocked = false;
    window.setLocked = (locked) => {
        _isLocked = locked;
        if (locked) {
            document.body.classList.add('editor-locked');
            deselectGroup();
            isDragging = false;
            isResizing = false;
        } else {
            document.body.classList.remove('editor-locked');
        }
    };

    // Auto-lock if parent goes fullscreen
    const syncLockWithFullscreen = () => {
        const isFS = !!(document.fullscreenElement || window.parent.document.fullscreenElement || document.webkitFullscreenElement || window.parent.document.webkitFullscreenElement);
        window.setLocked(isFS);
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
    let activeDragTarget = null;

    let dragGroup = [];

    // Track which slides have been "frozen" into absolute layout to avoid reflows
    const _isFrozenMap = new WeakMap();
    let _isRestoring = false; // Flag to prevent state saving during undo/redo

    // Selection Observer to update box on property changes

    /**
     * Grouping Helper: Finds elements visually inside a container to treat them as a unit
     */
    function collectGroup(target) {
        const group = [];
        const slide = target.closest('.s') || target.closest('section') || document.body;
        const isContainer = isSemanticContainer(target, slide);
        if (!isContainer) return group;

        const rect = target.getBoundingClientRect();
        const slideRect = slide.getBoundingClientRect();
        const others = getEditableElementsInSlide(slide, target);

        others.forEach(other => {
            const otherRect = other.getBoundingClientRect();
            // Intersection with tolerance
            if (otherRect.left >= rect.left - 2 &&
                otherRect.right <= rect.right + 2 &&
                otherRect.top >= rect.top - 2 &&
                otherRect.bottom <= rect.bottom + 2) {
                group.push({
                    el: other,
                    startLeft: otherRect.left - slideRect.left,
                    startTop: otherRect.top - slideRect.top
                });
            }
        });
        return group;
    }

    // UI Elements
    const selectionBox = document.createElement('div');
    selectionBox.className = 'editor-selection-box';
    selectionBox.style.display = 'none';
    selectionBox.style.zIndex = '1000'; // Always on top


    // Resize handles
    const handles = ['nw', 'ne', 'sw', 'se', 'n', 'e', 's', 'w'];
    const handleEls = {};
    handles.forEach(pos => {
        const h = document.createElement('div');
        h.className = `editor-resize-handle editor-resize-${pos}`;
        h.dataset.handler = pos;
        selectionBox.appendChild(h);
        handleEls[pos] = h;
    });

    // Context Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';
    toolbar.style.display = 'none';
    toolbar.style.zIndex = '1001'; // Above selection box


    // Snapping guides
    const guideH = document.createElement('div');
    guideH.className = 'editor-guide editor-guide-h';
    const guideV = document.createElement('div');
    guideV.className = 'editor-guide editor-guide-v';

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

    window.addEventListener('navigate-prev', handleSlideChange);
    window.addEventListener('navigate-next', handleSlideChange);

    // Robust detection for any slide change (e.g., via pagination dots or parent UI)
    // by observing when a section starts being 'active'
    const slideActivationObserver = new MutationObserver((mutations) => {
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
        observeSlides();
    });
    // The script can be injected while the generated document is still being
    // parsed.  Guard the target so a missing body does not abort the entire
    // editor bootstrap with "parameter 1 is not of type Node".
    const structureObservationTarget = document.body || document.documentElement;
    if (structureObservationTarget) {
        slideStructureObserver.observe(structureObservationTarget, { childList: true, subtree: true });
    }


    // Toolbar content
    function getToolbarHTML() {
        if (!selectedElement) return '';

        const palette = getDynamicPalette().slice(0, 4);
        const quickColorsHTML = palette.map(color => `
            <div class="editor-color-swatch" style="background:${color};" data-color="${color}"></div>
        `).join('');

        let dragGroup = [];

        const isImage = selectedElement.matches('img') || isImageSlotElement(selectedElement);
        const isText = isTextEditableElement(selectedElement);

        let toolsHTML = '';

        if (isText) {
            toolsHTML = `
                <div class="editor-color-swatches-mini">${quickColorsHTML}</div>
                <div class="editor-divider"></div>
                <div class="editor-tb-size-wrap">
                    <button class="editor-tb-btn" id="editor-btn-size-down" title="${window.parent.__t('smaller', 'Smaller')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
                    <div class="editor-tb-size-val" id="editor-tb-size-val">16</div>
                    <button class="editor-tb-btn" id="editor-btn-size-up" title="${window.parent.__t('bigger', 'Bigger')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
                </div>
                <div class="editor-divider"></div>
                <button class="editor-tb-btn" id="editor-btn-text-color" title="${window.parent.__t('text_color', 'Text Color')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16M6 16l6-12 6 12M8 12h8"></path></svg></button>
            `;
        } else if (isImage) {
            toolsHTML = `
                <button class="editor-tb-btn" id="editor-btn-replace-img" title="${window.parent.__t('replace_image', 'Replace Image')}" style="width: auto; padding: 0 10px; border-radius: 20px; gap: 6px; font-size: 12px; font-weight: 600;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                    ${window.parent.__t('replace', 'Replace')}
                </button>
            `;
        } else {
            // General shape / card
            toolsHTML = `
                <div class="editor-color-swatches-mini">${quickColorsHTML}</div>
                <div class="editor-divider"></div>
                <button class="editor-tb-btn" id="editor-btn-bg-color" title="${window.parent.__t('fill_color', 'Fill Color')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M3 9h18"></path></svg></button>
            `;
        }

        return `
            ${toolsHTML}
            <div class="editor-divider"></div>
            <button class="editor-tb-btn" id="editor-btn-duplicate" title="${window.parent.__t('duplicate_element', 'Duplicate')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg></button>
            <button class="editor-tb-btn" id="editor-btn-delete" title="${window.parent.__t('delete_element', 'Delete')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg></button>
            <div id="editor-color-picker" class="editor-color-picker" style="display:none;"></div>
        `;
    }

    let activeColorAction = null; // 'text' or 'bg'

    function deleteElement(el) {
        if (!el) return;
        const slide = el.closest('.s') || el.closest('section') || document.body;
        freezeSlideLayout(slide);
        saveState();
        
        // Also delete visual group members
        const group = collectGroup(el);
        group.forEach(item => item.el.remove());
        
        el.remove();
        deselectGroup();
    }

    function bindToolbarEvents() {
        const btnSizeDown = document.getElementById('editor-btn-size-down');
        const btnSizeUp = document.getElementById('editor-btn-size-up');
        const btnTextColor = document.getElementById('editor-btn-text-color');
        const btnBgColor = document.getElementById('editor-btn-bg-color');
        const btnDelete = document.getElementById('editor-btn-delete');
        const btnDuplicate = document.getElementById('editor-btn-duplicate');
        const btnReplaceImg = document.getElementById('editor-btn-replace-img');

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
                    if (window.parent && window.parent._triggerImagePicker) {
                        window.parent._triggerImagePicker(selectedElement);
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
        toolbar.querySelectorAll('.editor-color-swatches-mini .editor-color-swatch').forEach(swatch => {
            swatch.addEventListener('click', (e) => {
                e.stopPropagation();
                if (selectedElement) {
                    saveState();
                    const color = swatch.dataset.color;
                    if (isTextEditableElement(selectedElement) || selectedElement.matches('button, i, svg, [data-lucide], .lucide, .lucide-icon')) {
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
                    window.dispatchEvent(new CustomEvent('selection-changed', { detail: { element: selectedElement } }));
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
        const valEl = document.getElementById('editor-tb-size-val');
        if (selectedElement && valEl) {
            const style = window.getComputedStyle(selectedElement);
            valEl.textContent = Math.round(parseFloat(style.fontSize)) || 16;
        }
    }

    function showColorPicker(anchorEl) {
        const picker = document.getElementById('editor-color-picker');
        const isCurrentlyVisible = picker.style.display === 'grid';

        if (isCurrentlyVisible && picker.dataset.anchor === anchorEl.id) {
            picker.style.display = 'none';
            return;
        }

        // Generate dynamic palette
        const palette = getDynamicPalette();
        picker.innerHTML = palette.map(color => `
            <div class="editor-color-swatch" style="background:${color};" data-color="${color}"></div>
        `).join('') + `
            <div class="editor-color-swatch" style="background:transparent; border: 1px dashed #ccc; display:flex; align-items:center; justify-content:center; font-size:10px; color:#999;" data-color="transparent">✕</div>
        `;

        // Re-bind swatches
        picker.querySelectorAll('.editor-color-swatch').forEach(swatch => {
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
    const editorSemantics = createAedosEditorSemantics();
    const {
        editableSelectors,
        textEditableSelectors: TEXT_EDITABLE_SELECTORS,
        ignoreSelectors,
        getSlideRoot,
        isIgnoredElement,
        isTextEditableElement,
        isHeadingLikeElement,
        isTextContainerElement,
        isImageSlotElement,
        isVisualLeafElement,
        isSemanticContainer,
        getNearestSemanticContainerAncestor,
        isEditableElement,
    } = editorSemantics;
    window.editableSelectors = editableSelectors; // Export for UI

    const {
        getEditableElementsInNode,
        getTopLevelEditableElements,
        getAllEditableElements,
        findEditableTarget,
        getStableDragTarget,
    } = createEditorTargeting({ document, Element, Node, semantics: editorSemantics });

    const freezeSlideLayout = createEditorSlideFreeze({
        frozenSlides: _isFrozenMap,
        saveState: () => saveState(),
        getEditableElementsInSlide: (slide, excludeEl) => getEditableElementsInSlide(slide, excludeEl),
        getTopLevelEditableElements: (root, excludeEl, includeRoot) =>
            getTopLevelEditableElements(root, excludeEl, includeRoot),
        normalizeElement: (element, slide, silent, rect) => normalizeElement(element, slide, silent, rect),
    });

    // Exposed for parent frame: freeze all slides before PDF export without
    // polluting the undo history. Slides already frozen are skipped.
    window.freezeAllSlides = function () {
        document.querySelectorAll('section.s').forEach(slide => {
            if (_isFrozenMap.has(slide)) return;
            _isFrozenMap.set(slide, true);

            const allEditables = getEditableElementsInSlide(slide);
            if (allEditables.length === 0) return;

            const topLevel = getTopLevelEditableElements(slide);
            if (topLevel.length === 0) return;

            // Capture positions before any DOM mutation
            const data = topLevel.map(el => ({ el, rect: el.getBoundingClientRect() }));
            // Normalize silently — do NOT call saveState() to avoid polluting undo history
            data.forEach(({ el, rect }) => normalizeElement(el, slide, true, rect));
        });
    };

    const getInheritedStyles = createEditorStyleSnapshot(window.getComputedStyle.bind(window));

    const normalizeElement = createEditorElementNormalizer({
        window,
        setTimeout,
        saveState: () => saveState(),
        getNearestSemanticContainerAncestor,
        isTextEditableElement,
        isTextContainerElement,
        isHeadingLikeElement,
        textEditableSelectors: editorSemantics.textEditableSelectors,
        getInheritedStyles,
    });

    /**
     * Helper to get all editable elements in the same slide, excluding the one being edited.
     */
    function getEditableElementsInSlide(slide, excludeEl) {
        if (!slide) return [];
        return getEditableElementsInNode(slide, excludeEl)
            .filter(el => {
                if (el === excludeEl) return false;
                if (el.style.display === 'none' || el.style.visibility === 'hidden') return false;
                if (el.matches(ignoreSelectors) || el.closest(ignoreSelectors)) return false;

                // Exclude children and ancestors of the current element
                if (excludeEl && (excludeEl.contains(el) || el.contains(excludeEl))) return false;

                return true;
            });
    }



    document.body.addEventListener('mousedown', (e) => {
        if (_isLocked) return;
        ensureUI();

        // Ignore if clicking on our own tools
        if (e.target.closest('.editor-selection-box') || e.target.closest('.editor-toolbar') || e.target.closest('.editor-color-picker')) {
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
        let target = findEditableTarget(e.target);

        // Special case: img-slots used as full-bleed backgrounds sit beneath
        // content wrappers (z-index:3), so findEditableTarget never reaches them.
        // If the direct click didn't land on a text element or an img-slot, scan
        // allUnderCursor and prefer any img-slot found there.
        if (!isImageSlotElement(target) && !isTextEditableElement(e.target)) {
            for (const el of allUnderCursor) {
                if (el.closest('.editor-selection-box') || el.closest('.editor-toolbar')) continue;
                if (isImageSlotElement(el)) {
                    target = el;
                    break;
                }
            }
        }

        // If no target found via native hit-test, scan all elements at this point
        if (!target) {
            for (const el of allUnderCursor) {
                if (el.closest('.editor-selection-box') || el.closest('.editor-toolbar')) continue;
                const match = findEditableTarget(el);
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
            activeDragTarget = getStableDragTarget(target);

            // We don't normalize (rip out of DOM) immediately on click.
            // We wait until the mouse actually moves to avoid breaking layouts on simple clicks.
            const rect = activeDragTarget.getBoundingClientRect();
            const slide = activeDragTarget.closest('.s') || activeDragTarget.closest('section') || document.body;
            const slideRect = slide.getBoundingClientRect();

            startX = e.clientX;
            startY = e.clientY;

            startLeft = rect.left - slideRect.left;
            startTop = rect.top - slideRect.top;

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

                const others = getEditableElementsInSlide(slide, activeDragTarget);
                others.forEach(el => {
                    if (el === activeDragTarget || el.classList.contains('editor-phantom')) return;
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
        activeDragTarget = null;
        guideH.style.display = 'none';
        guideV.style.display = 'none';

        if (selectedElement) {
            delete selectedElement._normalized;
            updateSelectionBox();
        }

        // Reset the flag for the next mousedown
        const allEditables = getAllEditableElements();
        allEditables.forEach(el => delete el._stateSavedSinceMousedown);
    });

    // Prevent click events on the selection UI from bubbling to the background deselect listener
    selectionBox.addEventListener('click', (e) => e.stopPropagation());
    toolbar.addEventListener('click', (e) => e.stopPropagation());

    // Handle double-click to edit text
    document.body.addEventListener('dblclick', (e) => {
        if (_isLocked) return;
        const textSelectors = TEXT_EDITABLE_SELECTORS;
        const textTarget = e.target.closest(textSelectors);
        if (textTarget && (!textTarget.closest('.editor-toolbar'))) {
            // Normalize only if not yet done and only for standalone (non-container) elements.
            if (!textTarget._normalized) {
                const slide = textTarget.closest('.s') || textTarget.closest('section') || document.body;
                normalizeElement(textTarget, slide);
            }

            // Whether this element is a standalone absolute element (direct child of
            // the slide) vs. a flow element nested inside a card/container.
            // height:auto and grow-upwards logic must ONLY apply to absolute elements:
            // setting them on flow elements pushes siblings and jumps the selection box.
            const isAbsoluteEl = textTarget.style.position === 'absolute';

            textTarget.contentEditable = "true";
            textTarget.style.outline = "none";
            textTarget.style.boxShadow = "none";
            if (isAbsoluteEl) {
                textTarget.style.height = "auto"; // allow upward growth
                textTarget.style.overflow = "visible";
            }
            textTarget.focus();

            // Grow-upwards anchor: only for standalone absolute elements
            if (isAbsoluteEl) {
                const rect = textTarget.getBoundingClientRect();
                const slide = textTarget.closest('.s') || document.body;
                const slideRect = slide.getBoundingClientRect();
                textTarget._baseBottom = rect.bottom - slideRect.top;
            }

            // Make selection box non-interactive so we can edit text through it
            selectionBox.style.pointerEvents = "none";
            selectionBox.classList.add('editor-editing-text');

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
                // Only fix the height for standalone absolute elements.
                // For container children, leave their CSS height untouched.
                if (textTarget.style.position === 'absolute') {
                    const newHeight = textTarget.getBoundingClientRect().height;
                    textTarget.style.height = newHeight + "px";
                }
                delete textTarget._baseBottom;
                textTarget.removeEventListener('blur', onBlur);
                window.getSelection().removeAllRanges();

                selectionBox.style.pointerEvents = "auto";
                selectionBox.classList.remove('editor-editing-text');

                saveState();
            }, { once: true });
        }
    });

    document.addEventListener('paste', createEditorPasteHandler({ document, window }));

    selectionBox.addEventListener('dblclick', createEditorTextEditingHandler({
        document,
        window,
        CustomEvent,
        selectionBox,
        getSelectedElement: () => selectedElement,
        getIsLocked: () => _isLocked,
        isTextEditableElement,
        normalizeElement,
        textEditableSelectors: TEXT_EDITABLE_SELECTORS,
        saveState: () => saveState(),
        selectElement: element => selectElement(element),
    }));

    selectionBox.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('editor-resize-handle')) {
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
        } else if (!e.target.classList.contains('editor-resize-handle')) {
            // Drag via selection box proxy (anywhere that isn't a handle)
            e.stopPropagation();
            if (!selectedElement) return;

            saveState(); // Save state before drag

            isDragging = true;
            dragGroup = [];
            activeDragTarget = getStableDragTarget(selectedElement);

            const rect = activeDragTarget.getBoundingClientRect();
            const slide = activeDragTarget.closest('.s') || activeDragTarget.closest('section') || document.body;
            const slideRect = slide.getBoundingClientRect();

            startX = e.clientX;
            startY = e.clientY;

            startLeft = rect.left - slideRect.left;
            startTop = rect.top - slideRect.top;

            e.preventDefault();
        }
    });


    document.addEventListener('mousemove', (e) => {
        const currentElement = activeDragTarget || selectedElement;
        if (!currentElement) return;

        const slide = currentElement.closest('.s') || currentElement.closest('section') || document.body;

        if (isDragging || isResizing) {
            const dx = (e.clientX - startX);
            const dy = (e.clientY - startY);

            // NORMALIZATION ON DEMAND: Rip out of DOM when user actually starts transforming.
            if (!currentElement._normalized && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
                if (isDragging && activeDragTarget && activeDragTarget !== selectedElement) {
                    selectElement(activeDragTarget);
                }

                normalizeElement(currentElement, slide);

                // If the chosen drag target still isn't absolutely positioned, abort the drag.
                // This keeps unrelated elements untouched instead of extracting siblings.
                if (currentElement.style.position !== 'absolute') {
                    isDragging = false;
                    activeDragTarget = null;
                    updateSelectionBox();
                    return;
                }

                // After normalization, we MUST reset the base values because style.left/top
                // might differ from the visual start coordinates captured in mousedown.
                startWidth = parseFloat(currentElement.style.width);
                const _rawH = parseFloat(currentElement.style.height);
                startHeight = isNaN(_rawH) ? currentElement.getBoundingClientRect().height : _rawH;
                startLeft = parseFloat(currentElement.style.left);
                startTop = parseFloat(currentElement.style.top);

                startX = e.clientX;
                startY = e.clientY;
            }
        }

        if (isDragging) {
            if (!currentElement._normalized) return;

            let newLeft = startLeft + (e.clientX - startX);
            let newTop = startTop + (e.clientY - startY);

            // 1. Resolve Collision
            const eRect = currentElement.getBoundingClientRect();
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

            currentElement.style.left = `${newLeft}px`;
            currentElement.style.top = `${newTop}px`;

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

    const updateSelectionBox = createEditorSelectionUi({
        getSelectedElement: () => selectedElement,
        selectionBox,
        toolbar,
        window,
        getIsDragging: () => isDragging,
        getIsResizing: () => isResizing,
        calculateGeometry: calculateEditorSelectionGeometry,
    });

    const { selectElement, deselectGroup } = createEditorSelectionLifecycle({
        document,
        window,
        MutationObserver,
        ResizeObserver,
        CustomEvent,
        setTimeout,
        getSelectedElement: () => selectedElement,
        setSelectedElement: element => { selectedElement = element; },
        getIsLocked: () => _isLocked,
        setJustSelected: value => { _justSelected = value; },
        freezeSlideLayout,
        ensureUI,
        getToolbarHTML,
        bindToolbarEvents,
        updateSelectionBox,
        updateSizeDisplay,
        selectionBox,
        toolbar,
    });

    // --- UNDO / REDO LOGIC ---
    const editorHistory = createEditorHistory({
        getIsRestoring: () => _isRestoring,
        setIsRestoring: value => { _isRestoring = value; },
        deselectGroup,
        ensureUI
    });
    const { saveState, undo, redo } = editorHistory;

    // Initial Save!
    setTimeout(saveState, 500);


    function duplicateElement(el) {
        saveState();
        const slide = el.closest('.s') || el.closest('section') || document.body;
        normalizeElement(el, slide);

        // Identify children to duplicate as well
        const group = collectGroup(el);
        const clones = [];

        const mainClone = el.cloneNode(true);
        delete mainClone._stateSavedSinceMousedown;
        clones.push({ original: el, clone: mainClone });

        group.forEach(item => {
            normalizeElement(item.el, slide);
            const childClone = item.el.cloneNode(true);
            delete childClone._stateSavedSinceMousedown;
            clones.push({ original: item.el, clone: childClone });
        });

        // Offset all together
        clones.forEach(pair => {
            const currentLeft = parseFloat(pair.original.style.left) || 0;
            const currentTop = parseFloat(pair.original.style.top) || 0;
            pair.clone.style.left = (currentLeft + 20) + 'px';
            pair.clone.style.top = (currentTop + 20) + 'px';
            slide.appendChild(pair.clone);
        });

        selectElement(mainClone);
    }

    document.addEventListener('keydown', createEditorKeyboardHandler({
        document,
        window,
        CustomEvent,
        setTimeout,
        getSelectedElement: () => selectedElement,
        getIsLocked: () => _isLocked,
        undo,
        redo,
        saveState,
        collectGroup,
        getInheritedStyles,
        getStableDragTarget,
        normalizeElement,
        deleteElement,
        selectElement,
        duplicateElement,
        resolveDragCollision,
        updateSelectionBox,
    }));

    // Save initial state
    saveState();

    function moveSelectedElementByArrow(key, shift) {
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
    }

    installEditorCompatibilityFacade({
        window,
        getSelectedElement: () => selectedElement,
        getIsJustSelected: () => _justSelected,
        getIsDragging: () => isDragging,
        getIsResizing: () => isResizing,
        undo,
        redo,
        saveState,
        deselect: deselectGroup,
        updateSelection: updateSelectionBox,
        selectElement,
        duplicate: duplicateElement,
        deleteElement,
        arrowMove: moveSelectedElementByArrow,
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEditor);
} else {
    initEditor();
}
