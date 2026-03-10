/**
 * Eidoslab Visual Editor
 * Injected into the presentation iframe to allow Canva-like editing.
 */
function initEditor() {
    if (window._editorInitialized) return;
    window._editorInitialized = true;

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
        if (!selectionBox.parentElement) document.body.appendChild(selectionBox);
        if (!toolbar.parentElement) document.body.appendChild(toolbar);
    }
    ensureUI();

    // Toolbar content
    toolbar.innerHTML = `
        <button class="eidos-tb-btn" id="eidos-btn-text-color" title="Text Color">T</button>
        <button class="eidos-tb-btn" id="eidos-btn-bg-color" title="Background Color">B</button>
        <div class="eidos-divider"></div>
        <button class="eidos-tb-btn" id="eidos-btn-delete" title="Delete">🗑</button>
        
        <div id="eidos-color-picker" class="eidos-color-picker" style="display:none;">
            <div class="eidos-color-swatch" style="background:var(--accent);" data-color="var(--accent)"></div>
            <div class="eidos-color-swatch" style="background:var(--accent-2);" data-color="var(--accent-2)"></div>
            <div class="eidos-color-swatch" style="background:var(--bg);" data-color="var(--bg)"></div>
            <div class="eidos-color-swatch" style="background:var(--surface);" data-color="var(--surface)"></div>
            <div class="eidos-color-swatch" style="background:var(--white);" data-color="var(--white)"></div>
            <div class="eidos-color-swatch" style="background:var(--white-dim);" data-color="var(--white-dim)"></div>
            <div class="eidos-color-swatch" style="background:transparent; border: 1px solid #ccc; width:18px; height:18px; border-radius:50%;" data-color="transparent"></div>
        </div>
    `;

    let activeColorAction = null; // 'text' or 'bg'

    document.getElementById('eidos-btn-text-color').addEventListener('click', (e) => {
        e.stopPropagation();
        activeColorAction = 'text';
        toggleColorPicker();
    });

    document.getElementById('eidos-btn-bg-color').addEventListener('click', (e) => {
        e.stopPropagation();
        activeColorAction = 'bg';
        toggleColorPicker();
    });

    document.getElementById('eidos-btn-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectedElement) {
            saveState();
            selectedElement.remove();
            deselectGroup();
        }
    });

    // Setup color swatches
    toolbar.querySelectorAll('.eidos-color-swatch').forEach(swatch => {
        swatch.addEventListener('click', (e) => {
            e.stopPropagation();
            if (selectedElement && activeColorAction) {
                saveState();
                const color = swatch.dataset.color;
                if (activeColorAction === 'text') {
                    selectedElement.style.color = color;
                    // also handle icon colors if any
                    const icons = selectedElement.querySelectorAll('svg, [data-lucide]');
                    if (icons) icons.forEach(i => i.style.color = color);
                } else if (activeColorAction === 'bg') {
                    selectedElement.style.background = color;
                }
                document.getElementById('eidos-color-picker').style.display = 'none';
            }
        });
    });

    function toggleColorPicker() {
        const picker = document.getElementById('eidos-color-picker');
        picker.style.display = picker.style.display === 'none' ? 'flex' : 'none';
    }


    // Editable Elements Target Mapping
    const editableSelectors = 'h1, h2, h3, h4, p, span, li, blockquote, div.card, div.stat-box, div.step-item, div.timeline-item, .img-slot, .tag, .stat-box, .step-item, .quote-block, .timeline-item, .lucide-icon, svg[data-lucide], .big-number, .big-label, .accent-bar, .subtitle, .step-num, .timeline-year, [class*="card"], [class*="box"], [class*="item"]';
    window.editableSelectors = editableSelectors; // Export for UI

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

    document.body.addEventListener('mousedown', (e) => {
        ensureUI();

        // Ignore if clicking on our own tools
        if (e.target.closest('.eidos-selection-box') || e.target.closest('.eidos-toolbar') || e.target.closest('.eidos-color-picker')) {
            return;
        }

        // Allow text cursor placement without dragging if already in edit mode
        if (e.target.closest('[contenteditable="true"]')) {
            return;
        }

        const target = e.target.closest(editableSelectors);

        if (target) {
            // Find the slide this element belongs to
            const targetSlide = target.closest('.s') || target.closest('section') || document.body;

            // Start drag logic
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            // Normalize coordinates for dragging: Convert percentages or transforms to pixels
            // We want everything we select to behave as a box (absolute position)
            const style = window.getComputedStyle(target);
            // We want everything to be absolute in pixels for consistent behavior
            const isAbsolute = style.position === 'absolute';
            const isPixels = !target.style.left.includes('%') && !target.style.top.includes('%') && target.style.left !== '' && target.style.top !== '';
            const hasTransform = style.transform && style.transform !== 'none';

            const needsNormalization = !isAbsolute || !isPixels || hasTransform;

            if (needsNormalization) {
                saveState();

                const rect = target.getBoundingClientRect();
                const slide = targetSlide;
                const slideRect = slide.getBoundingClientRect();

                // CRITICAL: Capture inherited styles before moving, so we don't lose them
                const inherited = getInheritedStyles(target);

                // To avoid parent layouts collapsing and shifting other elements, leave a phantom clone
                if (style.position !== 'absolute') {
                    const clone = target.cloneNode(true);
                    clone.style.visibility = 'hidden';
                    clone.style.pointerEvents = 'none';
                    clone.classList.add('eidos-phantom');
                    clone.removeAttribute('id');
                    target.parentNode.insertBefore(clone, target);
                }

                // Move to slide root
                if (target.parentElement !== slide) slide.appendChild(target);

                // Apply styles to lock it in place
                target.style.position = 'absolute';
                target.style.boxSizing = 'border-box'; // Ensure width includes padding/border
                target.style.margin = '0';
                target.style.transform = 'none';

                // Explicitly set inherited styles to avoid changes after move
                target.style.fontSize = inherited.fontSize;
                target.style.fontFamily = inherited.fontFamily;
                target.style.color = inherited.color;
                target.style.lineHeight = inherited.lineHeight;
                target.style.textAlign = inherited.textAlign;
                target.style.fontWeight = inherited.fontWeight;
                target.style.letterSpacing = inherited.letterSpacing;

                target.style.width = rect.width + 'px';
                target.style.height = rect.height + 'px';

                target.style.left = (rect.left - slideRect.left) + 'px';
                target.style.top = (rect.top - slideRect.top) + 'px';
            } else {
                // If already absolute, just ensure it's on top and has fixed units
                if (!target._stateSavedSinceMousedown) {
                    saveState();
                    target._stateSavedSinceMousedown = true;
                }


                // Ensure dimensions are in pixels for resizing consistency
                const rect = target.getBoundingClientRect();
                if (!target.style.width) target.style.width = rect.width + 'px';
                if (!target.style.height) target.style.height = rect.height + 'px';

                // Even if already absolute, ensure it's a direct child of its parent slide
                if (target.parentElement !== targetSlide && targetSlide !== document.body) {
                    const inherited = getInheritedStyles(target);
                    const rect = target.getBoundingClientRect();
                    const slideRect = targetSlide.getBoundingClientRect();

                    targetSlide.appendChild(target);

                    target.style.boxSizing = 'border-box';
                    target.style.fontSize = inherited.fontSize;
                    target.style.fontFamily = inherited.fontFamily;
                    target.style.color = inherited.color;

                    target.style.left = (rect.left - slideRect.left) + 'px';
                    target.style.top = (rect.top - slideRect.top) + 'px';
                }
            }

            // Select it
            selectElement(target);

            startLeft = parseFloat(target.style.left) || 0;
            startTop = parseFloat(target.style.top) || 0;

            // Build snap targets
            snapLinesX = [];
            snapLinesY = [];
            const slide = target.closest('.s') || target.closest('section');
            if (slide) {
                const sRect = slide.getBoundingClientRect();
                snapLinesX.push({ val: sRect.width / 2 });
                snapLinesX.push({ val: 0 });
                snapLinesX.push({ val: sRect.width });
                snapLinesY.push({ val: sRect.height / 2 });
                snapLinesY.push({ val: 0 });
                snapLinesY.push({ val: sRect.height });

                // Inner borders (padding 40px for precise aesthetics)
                const padding = 40;
                snapLinesX.push({ val: padding });
                snapLinesX.push({ val: sRect.width - padding });
                snapLinesY.push({ val: padding });
                snapLinesY.push({ val: sRect.height - padding });

                slide.appendChild(guideH);
                slide.appendChild(guideV);

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
            // Clicked on background/container. 
            // If it's not an editable element and not our tools, it's a deselect/background action.
            deselectGroup();
        }
    });

    // Cleanup _stateSavedSinceMousedown on mouseup
    document.addEventListener('mouseup', () => {
        isDragging = false;
        isResizing = false;
        currentHandle = null;
        guideH.style.display = 'none';
        guideV.style.display = 'none';

        // Reset the flag for the next mousedown
        const allEditables = document.querySelectorAll(editableSelectors);
        allEditables.forEach(el => delete el._stateSavedSinceMousedown);

        if (selectedElement) {
            updateSelectionBox(); // Final update
        }
    });

    // Prevent click events on the selection UI from bubbling to the background deselect listener
    selectionBox.addEventListener('click', (e) => e.stopPropagation());
    toolbar.addEventListener('click', (e) => e.stopPropagation());

    // Handle double-click to edit text
    document.body.addEventListener('dblclick', (e) => {
        const textSelectors = 'h1, h2, h3, h4, p, span, li, blockquote, .tag, .big-number, .big-label, cite';
        const textTarget = e.target.closest(textSelectors);
        if (textTarget && (!textTarget.closest('.eidos-toolbar'))) {
            textTarget.contentEditable = "true";
            textTarget.focus();

            // Select all text
            const range = document.createRange();
            range.selectNodeContents(textTarget);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            e.stopPropagation();

            textTarget.addEventListener('blur', function onBlur() {
                textTarget.contentEditable = "false";
                textTarget.removeEventListener('blur', onBlur);
                window.getSelection().removeAllRanges();
                saveState(); // Save the new text to history
            }, { once: true });
        }
    });

    selectionBox.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (!selectedElement) return;

        // Find if the selected element is editable text or contains editable text
        const isEditable = (el) => el && el.matches('h1, h2, h3, h4, p, span, li, blockquote, .tag, .big-number, .big-label, cite');
        let textTarget = isEditable(selectedElement) ? selectedElement : selectedElement.querySelector('h1, h2, h3, h4, p, span, li, blockquote, .tag, .big-number, .big-label, cite');

        if (textTarget && !textTarget.closest('.eidos-toolbar')) {
            // Hide selection tools so we can interact with text
            selectionBox.style.display = 'none';
            toolbar.style.display = 'none';

            textTarget.contentEditable = "true";
            textTarget.focus();

            // Select all text
            const range = document.createRange();
            range.selectNodeContents(textTarget);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            textTarget.addEventListener('blur', function onBlur() {
                textTarget.contentEditable = "false";
                textTarget.removeEventListener('blur', onBlur);
                window.getSelection().removeAllRanges();
                saveState(); // Save the new text to history

                // restore selection box
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
            startWidth = rect.width;
            startHeight = rect.height;
            startLeft = parseFloat(selectedElement.style.left) || 0;
            startTop = parseFloat(selectedElement.style.top) || 0;
            e.preventDefault();
        } else if (e.target === selectionBox) {
            // Drag via selection box proxy
            e.stopPropagation();
            if (!selectedElement) return;

            saveState(); // Save state before drag

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = parseFloat(selectedElement.style.left) || 0;
            startTop = parseFloat(selectedElement.style.top) || 0;
            e.preventDefault();
        }
    });


    document.addEventListener('mousemove', (e) => {
        if (!selectedElement) return;

        if (isDragging) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            let newLeft = startLeft + dx;
            let newTop = startTop + dy;

            // Snapping Logic Variables
            const slide = selectedElement.closest('.s') || selectedElement.closest('section');
            if (slide) {
                const sRect = slide.getBoundingClientRect();
                const eRect = selectedElement.getBoundingClientRect();

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
                    guideV.style.left = bestSnapX + 'px';
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
                    guideH.style.top = bestSnapY + 'px';
                    guideH.style.left = '0px';
                    guideH.style.width = '100%';
                    guideH.style.display = 'block';
                } else {
                    guideH.style.display = 'none';
                }
            }

            selectedElement.style.left = `${newLeft}px`;
            selectedElement.style.top = `${newTop}px`;
            updateSelectionBox();

        } else if (isResizing) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

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

            // Snapping for Resize
            const slide = selectedElement.closest('.s') || selectedElement.closest('section');
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
                        guideV.style.left = bestSnapX + 'px';
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
                        guideV.style.left = bestSnapX + 'px';
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
                        guideH.style.top = bestSnapY + 'px';
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
                        guideH.style.top = bestSnapY + 'px';
                        guideH.style.left = '0px';
                        guideH.style.width = '100%';
                        guideH.style.display = 'block';
                    } else {
                        guideH.style.display = 'none';
                    }
                }
            }

            // Min sizes
            if (newWidth > 20) {
                selectedElement.style.width = `${newWidth}px`;
                if (currentHandle.includes('w')) selectedElement.style.left = `${newLeft}px`;
            }
            if (newHeight > 20) {
                selectedElement.style.height = `${newHeight}px`;
                if (currentHandle.includes('n')) selectedElement.style.top = `${newTop}px`;
            }

            updateSelectionBox();

        }
    });

    function selectElement(el) {
        if (selectionObserver) selectionObserver.disconnect();

        selectedElement = el;

        // Move UI to the same slide as the element for better stacking and sync
        const slide = el.closest('.s') || el.closest('section') || document.body;
        if (selectionBox.parentElement !== slide) slide.appendChild(selectionBox);
        if (toolbar.parentElement !== slide) slide.appendChild(toolbar);
        
        // Ensure tools are always above the selected element
        const elStyle = window.getComputedStyle(el);
        const elZ = parseInt(elStyle.zIndex) || 1;
        selectionBox.style.zIndex = Math.max(1000, elZ + 1);
        toolbar.style.zIndex = Math.max(1001, elZ + 2);


        updateSelectionBox();
        selectionBox.style.display = 'block';
        toolbar.style.display = 'none';
        document.getElementById('eidos-color-picker').style.display = 'none';

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
            subtree: false
        });
        
        // Also observe the parent to catch physical moves (To Front/Back)
        const parentObserver = new MutationObserver(() => updateSelectionBox());
        parentObserver.observe(el.parentElement, { childList: true });
        // Store it to disconnect later
        selectionObserver._parentObs = parentObserver;


        // Notify parent UI
        window.dispatchEvent(new CustomEvent('eidos-selection-changed', { detail: { element: el } }));

        // Mark as just selected to prevent immediate deselection by trailing click events
        _justSelected = true;
        setTimeout(() => { _justSelected = false; }, 250);
    }

    function deselectGroup() {
        if (selectionObserver) {
            if (selectionObserver._parentObs) selectionObserver._parentObs.disconnect();
            selectionObserver.disconnect();
            selectionObserver = null;
        }

        selectedElement = null;
        selectionBox.style.display = 'none';
        toolbar.style.display = 'none';
        document.getElementById('eidos-color-picker').style.display = 'none';

        // Notify parent UI
        window.dispatchEvent(new CustomEvent('eidos-selection-changed', { detail: { element: null } }));
    }

    function updateSelectionBox() {
        if (!selectedElement) return;
        const rect = selectedElement.getBoundingClientRect();
        const slide = selectedElement.closest('.s') || selectedElement.closest('section') || document.body;
        const slideRect = slide.getBoundingClientRect();

        // Position relative to slide
        const left = rect.left - slideRect.left;
        const top = rect.top - slideRect.top;

        selectionBox.style.left = `${left}px`;
        selectionBox.style.top = `${top}px`;
        selectionBox.style.width = `${rect.width}px`;
        selectionBox.style.height = `${rect.height}px`;

        // Add class for small elements to hide side handles and avoid crowding
        if (rect.width < 50 || rect.height < 50) {
            selectionBox.classList.add('eidos-small-selection');
        } else {
            selectionBox.classList.remove('eidos-small-selection');
        }

        toolbar.style.left = `${left}px`;
        // Position toolbar slightly above
        toolbar.style.top = `${top - 50}px`;
    }

    // --- UNDO / REDO LOGIC ---
    function getCleanHTML() {
        const clone = document.body.cloneNode(true);
        // We MUST keep .eidos-phantom to maintain layout, but remove transient UI
        const editorNodes = clone.querySelectorAll('.eidos-selection-box, .eidos-toolbar, .eidos-guide, .eidos-color-picker');
        editorNodes.forEach(node => node.remove());
        return clone.innerHTML;
    }

    function saveState() {
        const state = getCleanHTML();
        // Don't save if it's the same state as current to avoid duplicate history points
        if (historyIndex !== -1 && history[historyIndex] === state) return;

        // Truncate history forward if we are in the middle of it
        history.splice(historyIndex + 1);
        history.push(state);
        // Limit history size to 50
        if (history.length > 50) history.shift();
        historyIndex = history.length - 1;
    }

    function undo() {
        const currentState = getCleanHTML();
        // If we have unsaved changes at the end of history, save them so we can redo back to them
        if (historyIndex === history.length - 1 && history[historyIndex] !== currentState) {
            saveState();
        }

        if (historyIndex > 0) {
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

    function restoreState(htmlContent) {
        deselectGroup();

        document.body.innerHTML = htmlContent;

        // Re-inject UI and bindings
        document.body.appendChild(selectionBox);
        document.body.appendChild(toolbar);
        document.body.appendChild(guideH);
        document.body.appendChild(guideV);

        // Re-init lucide icons just in case
        if (window.lucide) window.lucide.createIcons();
        
        // Notify parent that state changed significantly (slides might have been added/removed)
        window.dispatchEvent(new CustomEvent('eidos-state-restored'));
    }


    function duplicateElement(el) {
        saveState();
        const clone = el.cloneNode(true);
        // remove any tracking state inside clone if needed
        delete clone._stateSavedSinceMousedown;
        
        const currentLeft = parseFloat(clone.style.left) || 0;
        const currentTop = parseFloat(clone.style.top) || 0;
        clone.style.left = (currentLeft + 20) + 'px';
        clone.style.top = (currentTop + 20) + 'px';

        el.parentNode.insertBefore(clone, el.nextSibling);
        selectElement(clone);
    }

    document.addEventListener('keydown', (e) => {
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
                    saveState();
                    selectedElement.remove();
                    deselectGroup();
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
                    const amount = e.shiftKey ? 10 : 1;
                    const currentLeft = parseFloat(selectedElement.style.left) || 0;
                    const currentTop = parseFloat(selectedElement.style.top) || 0;

                    if (e.key === 'ArrowUp') selectedElement.style.top = (currentTop - amount) + 'px';
                    if (e.key === 'ArrowDown') selectedElement.style.top = (currentTop + amount) + 'px';
                    if (e.key === 'ArrowLeft') selectedElement.style.left = (currentLeft - amount) + 'px';
                    if (e.key === 'ArrowRight') selectedElement.style.left = (currentLeft + amount) + 'px';

                    updateSelectionBox();
                } else {
                    // Navigate slides
                    if (e.key === 'ArrowLeft') window.dispatchEvent(new CustomEvent('eidos-navigate-prev'));
                    if (e.key === 'ArrowRight') window.dispatchEvent(new CustomEvent('eidos-navigate-next'));
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
    window.eidosIsJustSelected = () => _justSelected;
    window.eidosIsDragging = () => isDragging || isResizing;
    window.eidosDuplicateSelection = () => { if (selectedElement) duplicateElement(selectedElement); };
    window.eidosDeleteSelection = () => {
        if (selectedElement) {
            saveState();
            selectedElement.remove();
            deselectGroup();
        }
    };
    window.eidosToFront = () => {
        if (!selectedElement) return;
        saveState();
        const parent = selectedElement.parentElement;
        parent.appendChild(selectedElement); // Physical move to end of DOM (front)
        updateSelectionBox();
    };
    window.eidosToBack = () => {
        if (!selectedElement) return;
        saveState();
        const parent = selectedElement.parentElement;
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
        const currentLeft = parseFloat(selectedElement.style.left) || 0;
        const currentTop = parseFloat(selectedElement.style.top) || 0;
        if (key === 'ArrowUp') selectedElement.style.top = (currentTop - amount) + 'px';
        if (key === 'ArrowDown') selectedElement.style.top = (currentTop + amount) + 'px';
        if (key === 'ArrowLeft') selectedElement.style.left = (currentLeft - amount) + 'px';
        if (key === 'ArrowRight') selectedElement.style.left = (currentLeft + amount) + 'px';
        updateSelectionBox();
    };
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEditor);
} else {
    initEditor();
}
