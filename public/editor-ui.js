// Eidoslab Editor UI (Left Panel & Right Panel logic)

window.initEditorUI = function (iframe) {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    const iframeWin = iframe.contentWindow;

    if (!iframeDoc || !iframeDoc.body) return;

    // --- 1. MINIMAP LOGIC ---
    const minimapList = document.getElementById('minimap-list');
    const addSlideBtn = document.getElementById('btn-add-slide');
    let draggedItem = null;

    function centerActiveMinimapItem() {
        if (!minimapList) return;

        // Sync active state from iframe if needed (ensures functionality remains)
        const slides = Array.from(iframeDoc.querySelectorAll('section[class*="s"], section'));
        const iframeActiveIdx = slides.findIndex(s => s.classList.contains('active'));
        const items = Array.from(minimapList.querySelectorAll('.minimap-item'));

        if (iframeActiveIdx !== -1 && items[iframeActiveIdx]) {
            items.forEach(it => it.classList.remove('active'));
            items[iframeActiveIdx].classList.add('active');
        }

        const activeIdx = items.findIndex(item => item.classList.contains('active'));
        if (activeIdx === -1) return;

        const minimapContainer = document.getElementById('editor-minimap');
        const panelHeight = minimapContainer.clientHeight;

        // Mide el item real incluyendo su margin
        const activeItem = items[activeIdx];
        const style = window.getComputedStyle(activeItem);
        const marginTop = parseFloat(style.marginTop) || 0;
        const marginBottom = parseFloat(style.marginBottom) || 0;
        const ITEM_HEIGHT = activeItem.offsetHeight + marginTop + marginBottom;

        // Offset exacto para centrar
        const offset = (panelHeight / 2) - (activeIdx * ITEM_HEIGHT) - (ITEM_HEIGHT / 2);

        minimapList.style.transform = `translateY(${offset}px)`;
        minimapList.style.transition = 'transform 380ms cubic-bezier(0.4, 0, 0.2, 1)';
    }

    // Expose to window so app.js can trigger it if needed
    window.syncMinimapActiveState = centerActiveMinimapItem;

    // Recenter on resize
    window.addEventListener('resize', centerActiveMinimapItem);

    // --- ANIMATED LIST OBSERVER ---
    function observeMinimapItem(item) {
        if (!window.motion || !window.motion.inView) {
            // Fallback to IntersectionObserver if motion is not loaded
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) entry.target.classList.add('in-view');
                    else entry.target.classList.remove('in-view');
                });
            }, { root: document.getElementById('editor-minimap'), threshold: 0.1 });
            observer.observe(item);
            return;
        }

        window.motion.inView(item, (info) => {
            item.classList.add('in-view');
            return () => item.classList.remove('in-view');
        }, { margin: "0px 0px -10% 0px" });
    }

    function buildMinimap() {
        if (!minimapList) return;
        minimapList.innerHTML = '';
        const slides = Array.from(iframeDoc.querySelectorAll('section[class*="s"]'));
        if (slides.length === 0) {
            const sections = Array.from(iframeDoc.querySelectorAll('section'));
            if (sections.length > 0) slides.push(...sections);
        }

        // --- DETECT PRIMARY COLOR ---
        // We pick the --accent variable from the first slide or the root of the iframe
        const firstSection = slides[0];
        if (firstSection) {
            const iframeStyles = iframeWin.getComputedStyle(firstSection);
            const accentColor = iframeStyles.getPropertyValue('--accent').trim();
            if (accentColor) {
                const minimapContainer = document.getElementById('editor-minimap');
                if (minimapContainer) {
                    minimapContainer.style.setProperty('--presentation-accent', accentColor);
                }
            }
        }

        // --- 1. PRE-RENDER HEAD & BODY WRAPPER ---
        const G_FONTS = '<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap" rel="stylesheet">';
        const headWithViewport = iframeDoc.head.innerHTML + G_FONTS + '<meta name="viewport" content="width=1122">';
        const htmlTemplate = `<!DOCTYPE html><html><head>${headWithViewport}</head><body style="margin:0;overflow:hidden;background:transparent;display:block;width:1122px;height:631px;"><main style="display:block;width:1122px;height:631px;position:relative;transform:none;">[CONTENT]</main></body></html>`;

        slides.forEach((slide, index) => {
            const item = document.createElement('div');
            item.className = 'minimap-item';
            item.dataset.index = index;
            item.draggable = true;

            const thumbIframe = document.createElement('iframe');
            thumbIframe.style.width = '1122px';
            thumbIframe.style.height = '631px';
            thumbIframe.style.background = 'transparent';
            thumbIframe.style.border = 'none';

            // Clean slide for thumbnail
            const clone = slide.cloneNode(true);
            // DO NOT REMOVE phantoms as they hold the layout for absolute-positioned edited elements
            clone.querySelectorAll('.eidos-selection-box, .eidos-toolbar, .eidos-guide, .eidos-color-picker').forEach(n => n.remove());

            clone.style.width = '1122px'; // Match original fixed width
            clone.style.height = '631px';
            clone.style.flex = 'none';
            clone.style.margin = '0';
            clone.style.position = 'absolute';
            clone.style.top = '0';
            clone.style.left = '0';
            clone.style.transform = 'none';

            thumbIframe.srcdoc = htmlTemplate.split('[CONTENT]').join(clone.outerHTML);

            const overlay = document.createElement('div');
            overlay.className = 'minimap-item-overlay';

            const numberWrap = document.createElement('div');
            numberWrap.className = 'minimap-item-number';
            numberWrap.textContent = index + 1;

            // Highlight active
            if (slide.classList.contains('active')) {
                item.classList.add('active');
            }

            const delBtn = document.createElement('button');
            delBtn.className = 'minimap-delete-btn';
            delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            delBtn.title = 'Delete Slide';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                if (slides.length <= 1) return;
                if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                slide.remove();
                buildMinimap();
                setTimeout(() => {
                    const dots = document.querySelectorAll('.slide-dot');
                    const newIdx = Math.min(index, dots.length - 1);
                    if (dots[newIdx]) dots[newIdx].click();
                }, 50);
            };

            const dupBtn = document.createElement('button');
            dupBtn.className = 'minimap-dup-btn';
            dupBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
            dupBtn.title = 'Duplicate Slide';
            dupBtn.onclick = (e) => {
                e.stopPropagation();
                if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                const newSlide = slide.cloneNode(true);
                newSlide.classList.remove('active');
                slide.after(newSlide);
                buildMinimap();
                setTimeout(() => {
                    const dots = document.querySelectorAll('.slide-dot');
                    if (dots.length > index + 1) dots[index + 1].click();
                }, 50);
            };

            overlay.appendChild(delBtn);
            overlay.appendChild(dupBtn);

            item.appendChild(thumbIframe);
            item.appendChild(overlay);
            item.appendChild(numberWrap);

            // Click to navigate
            item.addEventListener('click', () => {
                // app.js has a logic to scrollToSlide(i). We can just click the corresponding dot
                const dots = document.querySelectorAll('.slide-dot');
                if (dots[index]) dots[index].click();

                // update local active state
                document.querySelectorAll('.minimap-item').forEach(m => m.classList.remove('active'));
                item.classList.add('active');
            });

            // Drag and Drop (Reorder)
            item.addEventListener('dragstart', (e) => {
                draggedItem = item;
                setTimeout(() => item.classList.add('is-dragging'), 0);
            });

            item.addEventListener('dragend', () => {
                setTimeout(() => {
                    draggedItem.classList.remove('is-dragging');
                    draggedItem = null;
                }, 0);
                // Trigger an update in iframe DOM
                syncSlidesOrderToIframe();
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                const afterElement = getDragAfterElement(minimapList, e.clientY);
                if (afterElement == null) {
                    minimapList.appendChild(draggedItem);
                } else {
                    minimapList.insertBefore(draggedItem, afterElement);
                }
            });

            // Trigger entrance animation via observer
            observeMinimapItem(item);

            minimapList.appendChild(item);
        });

        // Add proper scaling to thumb iframes
        setTimeout(() => {
            minimapList.querySelectorAll('iframe').forEach(ifr => {
                const itemWidth = ifr.parentElement.clientWidth;
                const scale = (itemWidth > 0 ? itemWidth : 188) / 1122;
                ifr.style.width = '1122px';
                ifr.style.height = '631px';
                ifr.style.transform = `scale(${scale})`;
            });
        }, 50);

        if (window.regenerateDotsCount) window.regenerateDotsCount();

        // Initial centering - Ensuring layout is painted
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                centerActiveMinimapItem();
            });
        });
    }


    let minimapUpdateTimeout = null;
    function triggerMinimapUpdate() {
        if (minimapUpdateTimeout) clearTimeout(minimapUpdateTimeout);
        minimapUpdateTimeout = setTimeout(() => {
            const slides = Array.from(iframeDoc.querySelectorAll('section[class*="s"]'));
            const activeIdx = slides.findIndex(s => s.classList.contains('active'));
            if (activeIdx !== -1) {
                updateSpecificMinimapItem(activeIdx, slides[activeIdx]);
            }
        }, 800);
    }

    function updateSpecificMinimapItem(index, slide) {
        const items = minimapList.querySelectorAll('.minimap-item');
        const item = items[index];
        if (!item) return;
        const ifr = item.querySelector('iframe');
        if (!ifr) return;

        const fullHtmlContent = `<!DOCTYPE html><html><head>${iframeDoc.head.innerHTML}</head><body style="margin:0;overflow:hidden;background:transparent;display:block;width:1122px;height:631px;"><main style="display:block;width:1122px;height:631px;position:relative;transform:none;">[CONTENT]</main></body></html>`;

        ifr.style.width = '1122px';
        ifr.style.height = '631px';

        const clone = slide.cloneNode(true);
        clone.querySelectorAll('.eidos-selection-box, .eidos-toolbar, .eidos-guide, .eidos-color-picker').forEach(n => n.remove());

        clone.style.width = '1122px';
        clone.style.height = '631px';
        clone.style.flex = 'none';
        clone.style.margin = '0';
        clone.style.position = 'absolute';
        clone.style.top = '0';
        clone.style.left = '0';
        clone.style.transform = 'none';

        const G_FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap" rel="stylesheet"><style>:root{--font-display:\'Syne\',sans-serif;--font-body:\'DM Sans\',sans-serif;}</style>';
        const headWithViewport = iframeDoc.head.innerHTML + G_FONTS + '<meta name="viewport" content="width=1122">';
        const localizedHtml = `<!DOCTYPE html><html><head>${headWithViewport}</head><body style="margin:0;overflow:hidden;background:transparent;display:block;width:1122px;height:631px;"><main style="display:block;width:1122px;height:631px;position:relative;transform:none;">[CONTENT]</main></body></html>`;

        ifr.srcdoc = localizedHtml.split('[CONTENT]').join(clone.outerHTML);
    }

    // Observer to keep minimap in sync
    const minimapObserver = new MutationObserver((mutationsList) => {
        triggerMinimapUpdate();
    });
    minimapObserver.observe(iframeDoc.body, {
        attributes: true,
        attributeFilter: ['class'],
        childList: true,
        subtree: true,
        characterData: true
    });

    // Special observer just for the 'active' class on sections to trigger re-centering
    const activeSlideObserver = new MutationObserver((mutations) => {
        let activeChanged = false;
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                if (mutation.target.tagName === 'SECTION') {
                    activeChanged = true;
                    break;
                }
            }
        }
        if (activeChanged) {
            centerActiveMinimapItem();
        }
    });

    activeSlideObserver.observe(iframeDoc.body, {
        attributes: true,
        subtree: true,
        attributeFilter: ['class']
    });

    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.minimap-item:not(.is-dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child }
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    function syncSlidesOrderToIframe() {
        if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();

        const newOrder = [...minimapList.querySelectorAll('.minimap-item')].map(item => parseInt(item.dataset.index));

        const slides = Array.from(iframeDoc.querySelectorAll('section[class*="s"]'));
        if (slides.length === 0) return;

        const container = slides[0].parentElement;

        // Detach all
        const slideNodes = newOrder.map(i => slides[i]);
        slideNodes.forEach(node => container.appendChild(node)); // re-append in new order

        // Rebuild minimap and nav
        if (window.regenerateDotsCount) window.regenerateDotsCount(); // We might need to hook into app.js or just refresh
        buildMinimap();

        // Ensure centering is updated after order sync
        setTimeout(centerActiveMinimapItem, 50);
    }

    // Add Slide
    if (addSlideBtn) {
        addSlideBtn.addEventListener('click', () => {
            if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
            const slides = Array.from(iframeDoc.querySelectorAll('section[class*="s"]'));
            if (slides.length === 0) return;
            const activeSlide = slides.find(s => s.classList.contains('active')) || slides[slides.length - 1];

            const newSlide = activeSlide.cloneNode(true);
            // Clear content of new slide
            const editableSelectors = 'h1, h2, h3, h4, p, .card, .img-slot, .tag, .stat-box, .step-item, .quote-block, .timeline-item, .lucide-icon';
            const editables = newSlide.querySelectorAll(editableSelectors);
            editables.forEach(el => {
                if (el.tagName === 'IMG' || el.classList.contains('img-slot')) {
                    el.style.backgroundImage = 'none';
                    el.classList.remove('has-custom-image');
                } else {
                    el.innerHTML = '';
                }
            });
            newSlide.classList.remove('active');
            activeSlide.after(newSlide);

            buildMinimap();

            setTimeout(() => {
                const nextIdx = slides.indexOf(activeSlide) + 1;
                const dots = document.querySelectorAll('.slide-dot');
                if (dots.length > nextIdx) dots[nextIdx].click();
            }, 100);
        });

    }


    // --- 2. DYNAMIC TOOLS PANEL LOGIC ---
    const dynamicContainer = document.getElementById('dynamic-tools-container');

    // Subscribe to selection change from iframe
    iframeWin.addEventListener('eidos-selection-changed', (e) => {
        const el = e.detail.element;
        renderTools(el);
    });

    // Subscriptions for keyboard navigation and duplication
    iframeWin.addEventListener('eidos-navigate-prev', () => {
        document.getElementById('prev-slide')?.click();
    });
    iframeWin.addEventListener('eidos-navigate-next', () => {
        document.getElementById('next-slide')?.click();
    });
    iframeWin.addEventListener('eidos-duplicate-slide', () => {
        if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
        const slides = Array.from(iframeDoc.querySelectorAll('section[class*="s"]'));
        if (slides.length === 0) return;
        const activeSlide = slides.find(s => s.classList.contains('active')) || slides[0];

        const newSlide = activeSlide.cloneNode(true);
        newSlide.classList.remove('active');
        activeSlide.after(newSlide);
        buildMinimap();

        setTimeout(() => {
            const nextIdx = slides.indexOf(activeSlide) + 1;
            const dots = document.querySelectorAll('.slide-dot');
            if (dots.length > nextIdx) dots[nextIdx].click();
        }, 100);
    });

    iframeWin.addEventListener('eidos-state-restored', () => {
        buildMinimap();
    });


    // Helper to generate right panel tools based on selected element
    function renderTools(el) {
        const toolsPanel = document.getElementById('editor-tools-panel');
        if (toolsPanel) {
            // Prevent panel flicker: if we just selected something, or if we are dragging, don't close.
            const isJustSelected = iframeWin.eidosIsJustSelected && iframeWin.eidosIsJustSelected();

            if (!el) {
                // If nothing is selected, we show slide tools in the container, 
                // but we don't force the panel open here. The click listener handles that.
            } else {
                // When an element is selected, ALWAYS show the panel
                toolsPanel.classList.remove('is-empty');
            }
        }

        if (!el) {
            // Render Slide level tools
            dynamicContainer.innerHTML = `
                <div class="tool-section">
                    <div class="tool-section-title">${window.t('slide')}</div>
                    <div class="tool-row">
                        <span class="tool-label">${window.t('background_color')}</span>
                        <div class="color-picker-wrapper">
                            <input type="color" id="tool-bg-color" class="tool-input" style="padding:0; height:32px;">
                        </div>
                    </div>
                </div>

                <div class="tool-section" style="margin-top:0.5rem; border-top:1px solid var(--border); padding-top:1rem;">
                    <button id="tool-add-slide-alt" class="add-el-btn" style="width:100%; padding:0.8rem; border:1px dashed var(--border); flex-direction:row; gap:0.8rem;">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        <span style="font-size: 0.85rem; font-weight:500;">${window.t('add_slide', 'Add Slide')}</span>
                    </button>
                </div>
            `;

            const bgColorBtn = document.getElementById('tool-bg-color');
            if (bgColorBtn) {
                const slides = Array.from(iframeDoc.querySelectorAll('section[class*="s"]'));
                const activeSlide = slides.find(s => s.classList.contains('active')) || slides[0];
                if (activeSlide) {
                    const currentBg = iframeWin.getComputedStyle(activeSlide).backgroundColor;
                    const rgbToHex = (val) => {
                        if (!val) return null;
                        if (val.startsWith('#')) return val;
                        const match = val.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
                        if (match) {
                            const r = parseInt(match[1]).toString(16).padStart(2, '0');
                            const g = parseInt(match[2]).toString(16).padStart(2, '0');
                            const b = parseInt(match[3]).toString(16).padStart(2, '0');
                            return `#${r}${g}${b}`;
                        }
                        return null;
                    };
                    if (currentBg) {
                        bgColorBtn.value = rgbToHex(currentBg) || '#121212';
                    }

                    bgColorBtn.addEventListener('input', (e) => {
                        if (!activeSlide._undoSavingBg) {
                            if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                            activeSlide._undoSavingBg = true;
                            setTimeout(() => activeSlide._undoSavingBg = false, 1000);
                        }
                        activeSlide.style.background = e.target.value;
                    });
                }

                const addSlideAlt = document.getElementById('tool-add-slide-alt');
                if (addSlideAlt) {
                    addSlideAlt.addEventListener('click', () => {
                        const originalBtn = document.getElementById('btn-add-slide');
                        if (originalBtn) originalBtn.click();
                    });
                }
            }
            return;
        }

        // --- Library Rendering ---
        if (el === 'lib-icons' || el === 'lib-shapes') {
            const isIcons = el === 'lib-icons';
            let html = `
                <div class="tool-section">
                    <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.5rem;">
                        <button id="lib-back-btn" class="tool-btn" style="width:32px; height:32px; border-radius:50%; flex:none;">←</button>
                        <div class="tool-section-title" style="margin:0;">${isIcons ? window.t('select_icon') : window.t('select_shape')}</div>
                    </div>
            `;

            if (isIcons) {
                const iconCategories = {
                    'essentials': ['star', 'heart', 'zap', 'smile', 'check-circle', 'alert-triangle', 'info', 'help-circle', 'home', 'settings', 'search', 'menu', 'plus', 'minus', 'x'],
                    'communication': ['mail', 'phone', 'message-square', 'send', 'share-2', 'globe', 'link', 'bell'],
                    'business': ['briefcase', 'credit-card', 'pie-chart', 'bar-chart-2', 'trending-up', 'calculator', 'dollar-sign', 'banknote', 'target', 'trophy'],
                    'multimedia': ['camera', 'image', 'video', 'music', 'clapperboard', 'play', 'pause', 'volume-2', 'headphones'],
                    'technology': ['clock', 'smartphone', 'laptop', 'tablet', 'monitor', 'hard-drive', 'cpu', 'database', 'wifi'],
                    'social': ['user', 'users', 'user-plus', 'user-check', 'thumbs-up', 'thumbs-down', 'laugh', 'ghost'],
                    'navigation': ['arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'chevron-right', 'chevron-left', 'chevron-up', 'chevron-down', 'move', 'maximize', 'minimize'],
                    'nature': ['sun', 'moon', 'cloud', 'cloud-rain', 'cloud-lightning', 'wind', 'leaf', 'tree-pine', 'flame', 'anchor', 'rocket', 'map-pin'],
                    'objects': ['gift', 'shopping-cart', 'coffee', 'crown', 'flag', 'lock', 'unlock', 'key', 'pen-tool', 'pencil', 'trash-2', 'eye', 'eye-off', 'lightbulb']
                };

                Object.entries(iconCategories).forEach(([name, icons], idx) => {
                    html += `
                        <details class="lib-category" ${idx === 0 ? 'open' : ''}>
                            <summary class="lib-category-summary">${window.t(name)}</summary>
                            <div class="lib-grid">
                    `;
                    icons.forEach(icon => {
                        html += `<div class="lib-item" data-type="icon" data-val="${icon}"><i data-lucide="${icon}"></i></div>`;
                    });
                    html += `</div></details>`;
                });
            } else {
                html += `<div class="lib-grid">`;
                const shapes = [
                    { name: 'square', class: 'card', styles: '' },
                    { name: 'circle', class: 'card', styles: 'border-radius: 50%;' },
                    { name: 'diamond', class: 'card', styles: 'clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);' },
                    { name: 'triangle', class: 'card', styles: 'clip-path: polygon(50% 0%, 0% 100%, 100% 100%);' },
                    { name: 'hexagon', class: 'card', styles: 'clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);' },
                    { name: 'capsule', class: 'card', styles: 'border-radius: 999px;' }
                ];
                shapes.forEach(shape => {
                    html += `
                        <div class="lib-item shape-preview" style="overflow: visible;" data-type="shape" data-class="${shape.class}" data-styles="${shape.styles}">
                            <div style="width:${shape.name === 'capsule' ? '36px' : '24px'}; height:24px; background:currentColor; border:none; ${shape.styles}"></div>
                        </div>`;
                });
                html += `</div>`;
            }

            html += `</div>`;

            dynamicContainer.innerHTML = html;

            // Re-enable block to prevent background slide move while scrolling icons
            dynamicContainer.onwheel = (e) => {
                e.stopPropagation();
            };
            // Bind Library Actions
            document.getElementById('lib-back-btn').addEventListener('click', () => renderTools(null));

            dynamicContainer.querySelectorAll('.lib-item').forEach(item => {
                item.addEventListener('click', () => {
                    const type = item.dataset.type;
                    if (type === 'icon') {
                        insertIcon(item.dataset.val);
                    } else if (type === 'shape') {
                        insertShape(item.dataset.class, item.dataset.styles);
                    }
                    renderTools(null); // Back to slide tools
                });
            });

            if (window.lucide) window.lucide.createIcons({
                attrs: { width: 20, height: 20 }
            });
            return;
        }

        if (typeof el === 'string') return; // Already handled libraries or other strings

        const tagName = el.tagName ? el.tagName.toLowerCase() : '';
        if (!tagName) return;
        const isText = ['h1', 'h2', 'h3', 'h4', 'p', 'span', 'li', 'blockquote'].includes(tagName) || el.classList.contains('tag');
        const isImage = tagName === 'img' || el.classList.contains('img-slot') || el.hasAttribute('data-image-slot');
        // Shapes can be SVG or Divs with .card class
        const isShape = (tagName === 'svg' && !el.hasAttribute('data-lucide') && !isImage) ||
            (el.classList.contains('card') && !isText && !isImage);
        const isIcon = el.hasAttribute('data-lucide') || el.classList.contains('lucide') || tagName === 'i' || tagName === 'svg';

        let html = '';

        const FONT_LIST = [
            { label: 'Core', fonts: [
                { name: 'Syne (Display)', value: "'Syne', sans-serif" },
                { name: 'DM Sans (Body)',  value: "'DM Sans', sans-serif" },
            ]},
            { label: 'Sans Serif', fonts: [
                { name: 'Inter',               value: "'Inter', sans-serif" },
                { name: 'Montserrat',          value: "'Montserrat', sans-serif" },
                { name: 'Outfit',              value: "'Outfit', sans-serif" },
                { name: 'Plus Jakarta Sans',   value: "'Plus Jakarta Sans', sans-serif" },
                { name: 'Sora',               value: "'Sora', sans-serif" },
                { name: 'Space Grotesque',    value: "'Space Grotesque', sans-serif" },
                { name: 'Lexend',             value: "'Lexend', sans-serif" },
                { name: 'Prompt',             value: "'Prompt', sans-serif" },
                { name: 'Ubuntu',             value: "'Ubuntu', sans-serif" },
                { name: 'Bricolage Grotesque',value: "'Bricolage Grotesque', sans-serif" },
            ]},
            { label: 'Serif', fonts: [
                { name: 'Playfair Display',   value: "'Playfair Display', serif" },
                { name: 'Lora',              value: "'Lora', serif" },
                { name: 'Fraunces',          value: "'Fraunces', serif" },
                { name: 'Cormorant Garamond',value: "'Cormorant Garamond', serif" },
                { name: 'Bitter',            value: "'Bitter', serif" },
                { name: 'Cinzel',            value: "'Cinzel', serif" },
            ]},
            { label: 'Display & Mono', fonts: [
                { name: 'Bebas Neue',        value: "'Bebas Neue', cursive" },
                { name: 'Archivo Black',     value: "'Archivo Black', sans-serif" },
                { name: 'Unbounded',         value: "'Unbounded', cursive" },
                { name: 'JetBrains Mono',    value: "'JetBrains Mono', monospace" },
            ]},
            { label: 'System', fonts: [
                { name: 'Arial',             value: 'Arial, sans-serif' },
                { name: 'Times New Roman',   value: "'Times New Roman', serif" },
                { name: 'Georgia',           value: 'Georgia, serif' },
                { name: 'Verdana',           value: 'Verdana, sans-serif' },
                { name: 'Trebuchet MS',      value: "'Trebuchet MS', sans-serif" },
                { name: 'Courier New',       value: "'Courier New', monospace" },
            ]},
        ];

        if (isText) {
            let fontPickerOptions = '';
            FONT_LIST.forEach(group => {
                fontPickerOptions += `<div class="fpicker-group-label">${group.label}</div>`;
                group.fonts.forEach(f => {
                    fontPickerOptions += `<div class="fpicker-option" data-value="${f.value}" style="font-family:${f.value}">${f.name}</div>`;
                });
            });

            html += `
                <div class="tool-section">
                    <div class="tool-section-title">${window.t('text_tool')}</div>
                    <div class="tool-row">
                        <div class="fpicker" id="tool-font-picker">
                            <div class="fpicker-trigger" id="tool-font-trigger">
                                <span class="fpicker-current" id="tool-font-label">Select font</span>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
                            </div>
                            <div class="fpicker-dropdown" id="tool-font-dropdown">
                                ${fontPickerOptions}
                            </div>
                        </div>
                    </div>
                    <div class="tool-row">
                        <span class="tool-label">${window.t('size')}</span>
                        <div class="tool-btn-group" style="width: auto;">
                            <button id="tool-font-min" class="tool-btn">-</button>
                            <input type="number" id="tool-font-size" class="tool-input" value="16" style="border:none !important; border-radius:0 !important; flex:1;">
                            <button id="tool-font-add" class="tool-btn">+</button>
                        </div>
                    </div>
                    <div class="tool-row">
                        <div class="tool-btn-group">
                            <button id="tool-bold" class="tool-btn"><b>B</b></button>
                            <button id="tool-italic" class="tool-btn"><i>I</i></button>
                            <button id="tool-under" class="tool-btn"><u>U</u></button>
                        </div>
                    </div>
                    <div class="tool-row">
                        <span class="tool-label">${window.t('alignment')}</span>
                        <div class="tool-btn-group">
                            <button id="tool-align-l" class="tool-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="15" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></button>
                            <button id="tool-align-c" class="tool-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="7" y1="12" x2="17" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></button>
                            <button id="tool-align-r" class="tool-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="9" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></button>
                        </div>
                    </div>
                    <div class="tool-row">
                        <span class="tool-label">${window.t('color')}</span>
                        <div class="color-picker-wrapper">
                            <input type="color" id="tool-color" class="tool-input" style="padding:0; height:32px;">
                        </div>
                    </div>
                </div>
            `;
        }

        if (isImage) {
            html += `
                <div class="tool-section">
                    <div class="tool-section-title">${window.t('image_tool')}</div>
                    <div class="tool-row">
                        <button id="tool-replace-img" class="add-el-btn" style="width:100%; padding:0.5rem;">${window.t('replace_image')}</button>
                    </div>
                    <div class="tool-row">
                        <span class="tool-label">${window.t('border_radius')}</span>
                        <div class="tool-slider-row" style="flex:1; margin-left: 1rem;">
                            <input type="range" id="tool-radius" class="tool-slider" min="0" max="100" value="0">
                        </div>
                    </div>
                    <div class="tool-row">
                        <span class="tool-label">${window.t('opacity')}</span>
                        <div class="tool-slider-row" style="flex:1; margin-left: 1rem;">
                            <input type="range" id="tool-opacity" class="tool-slider" min="0" max="100" value="100">
                        </div>
                    </div>
                </div>
            `;
        }

        // Ensure shapes created as .card get the shape tools
        if (isShape && !isIcon && !isText && !isImage) {
            // Already handled by the isShape block below
        }

        if (isIcon) {
            html += `
                <div class="tool-section">
                    <div class="tool-section-title">${window.t('icon_tool')}</div>
                    <div class="tool-row">
                        <span class="tool-label">${window.t('icon_color')}</span>
                        <div class="color-picker-wrapper">
                            <input type="color" id="tool-color" class="tool-input" style="padding:0; height:32px;">
                        </div>
                    </div>
                    <div class="tool-row">
                        <span class="tool-label">${window.t('size')}</span>
                        <div class="tool-slider-row" style="flex:1; margin-left: 1rem;">
                            <input type="range" id="tool-icon-size" class="tool-slider" min="12" max="256" value="${parseInt(el.style.width) || 48}">
                        </div>
                    </div>
                </div>
            `;
        }

        if (isShape && !isIcon) {
            html += `
                <div class="tool-section">
                    <div class="tool-section-title">${window.t('shape_tool')}</div>
                    <div class="tool-row">
                        <span class="tool-label">${window.t('fill_color')}</span>
                        <div class="color-picker-wrapper">
                            <input type="color" id="tool-fill" class="tool-input" style="padding:0; height:32px;">
                        </div>
                    </div>
                    <div class="tool-row">
                        <span class="tool-label">${window.t('border_color')}</span>
                        <div class="color-picker-wrapper">
                            <input type="color" id="tool-stroke" class="tool-input" style="padding:0; height:32px;">
                        </div>
                    </div>
                    <div class="tool-row">
                        <span class="tool-label">${window.t('opacity')}</span>
                        <div class="tool-slider-row" style="flex:1; margin-left: 1rem;">
                            <input type="range" id="tool-opacity" class="tool-slider" min="0" max="100" value="100">
                        </div>
                    </div>
                </div>
            `;
        }

        // Universal tools (Shadow, Delete, Z-index)
        html += `
            <div class="tool-section" style="margin-top: 1rem;">
                <div class="tool-section-title">${window.t('advanced')}</div>
                <div class="tool-row" style="display:flex; gap:0.5rem; margin-bottom: 0.5rem;">
                    <button id="tool-layer-up" class="add-el-btn" style="flex:1; padding:0.5rem; font-size: 0.75rem; font-weight: 600;">
                        ${window.t('bring_to_front')}
                    </button>
                    <button id="tool-layer-down" class="add-el-btn" style="flex:1; padding:0.5rem; font-size: 0.75rem; font-weight: 600;">
                        ${window.t('send_to_back')}
                    </button>
                </div>
                <div class="tool-row">
                    <button id="tool-delete" class="add-el-btn" style="width:100%; padding:0.5rem; color:#ff5b5b; border-color:rgba(255,91,91,0.3);">${window.t('delete_element')}</button>
                </div>
            </div>
        `;

        dynamicContainer.innerHTML = html;

        // --- Bind Events ---
        if (isText) {
            const fontSize = document.getElementById('tool-font-size');
            const fontAdd = document.getElementById('tool-font-add');
            const fontMin = document.getElementById('tool-font-min');
            const bold = document.getElementById('tool-bold');
            const italic = document.getElementById('tool-italic');
            const under = document.getElementById('tool-under');
            const color = document.getElementById('tool-color');
            const alignL = document.getElementById('tool-align-l');
            const alignC = document.getElementById('tool-align-c');
            const alignR = document.getElementById('tool-align-r');

            // Init values
            const comp = iframeWin.getComputedStyle(el);
            fontSize.value = parseInt(comp.fontSize);
            if (comp.fontWeight > 400 || comp.fontWeight === 'bold') bold.classList.add('active');
            if (comp.fontStyle === 'italic') italic.classList.add('active');
            if (comp.textDecoration.includes('underline')) under.classList.add('active');

            // --- Custom font picker logic ---
            const picker     = document.getElementById('tool-font-picker');
            const trigger    = document.getElementById('tool-font-trigger');
            const dropdown   = document.getElementById('tool-font-dropdown');
            const labelEl    = document.getElementById('tool-font-label');

            // Inject slide accent color into the font picker
            const activeSlide = Array.from(iframeDoc.querySelectorAll('section')).find(s => s.classList.contains('active'));
            if (activeSlide) {
                const accentColor = iframeWin.getComputedStyle(activeSlide).getPropertyValue('--accent').trim();
                if (accentColor) picker.style.setProperty('--fpicker-accent', accentColor);
            }

            // Set initial label from computed font-family
            const currentFF = comp.fontFamily;
            FONT_LIST.forEach(g => g.fonts.forEach(f => {
                if (currentFF.includes(f.value.split(',')[0].replace(/'/g, '').trim())) {
                    labelEl.textContent = f.name;
                    labelEl.style.fontFamily = f.value;
                }
            }));

            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = picker.classList.toggle('open');
                if (isOpen) {
                    // Close on outside click
                    const close = (ev) => {
                        if (!picker.contains(ev.target)) {
                            picker.classList.remove('open');
                            document.removeEventListener('click', close);
                        }
                    };
                    document.addEventListener('click', close);
                }
            });

            dropdown.querySelectorAll('.fpicker-option').forEach(opt => {
                opt.addEventListener('click', () => {
                    const val = opt.dataset.value;
                    if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                    el.style.setProperty('font-family', val, 'important');
                    labelEl.textContent = opt.textContent;
                    labelEl.style.fontFamily = val;
                    picker.classList.remove('open');
                });
            });

            // Prevent wheel scroll from bubbling up to the slides navigator
            dropdown.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

            const updateSize = (val) => {
                if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                el.style.fontSize = val + 'px';
                fontSize.value = val;
            };

            fontAdd.addEventListener('click', () => {
                updateSize(parseInt(fontSize.value) + 1);
                if (iframeWin.eidosUpdateSelection) iframeWin.eidosUpdateSelection();
            });
            fontMin.addEventListener('click', () => {
                updateSize(parseInt(fontSize.value) - 1);
                if (iframeWin.eidosUpdateSelection) iframeWin.eidosUpdateSelection();
            });
            fontSize.addEventListener('change', (e) => {
                updateSize(e.target.value);
                if (iframeWin.eidosUpdateSelection) iframeWin.eidosUpdateSelection();
            });

            bold.addEventListener('click', () => {
                if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                const isBold = el.style.fontWeight === 'bold';
                el.style.fontWeight = isBold ? 'normal' : 'bold';
                bold.classList.toggle('active', !isBold);
            });
            italic.addEventListener('click', () => {
                if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                const isIt = el.style.fontStyle === 'italic';
                el.style.fontStyle = isIt ? 'normal' : 'italic';
                italic.classList.toggle('active', !isIt);
            });
            under.addEventListener('click', () => {
                if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                const isU = el.style.textDecoration === 'underline';
                el.style.textDecoration = isU ? 'none' : 'underline';
                under.classList.toggle('active', !isU);
            });

            const setAlign = (val, btn) => {
                if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                el.style.textAlign = val;
                [alignL, alignC, alignR].forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            };
            alignL.addEventListener('click', () => setAlign('left', alignL));
            alignC.addEventListener('click', () => setAlign('center', alignC));
            alignR.addEventListener('click', () => setAlign('right', alignR));

            const colorSaving = (e) => {
                if (!el._colorSaving) {
                    if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                    el._colorSaving = true;
                    setTimeout(() => el._colorSaving = false, 1000);
                }
                el.style.color = e.target.value;
                el.style.webkitTextFillColor = e.target.value;
                if (iframeWin.eidosUpdateSelection) iframeWin.eidosUpdateSelection();
            };
            color.addEventListener('input', colorSaving);
        }

        if (isImage) {
            const btnReplace = document.getElementById('tool-replace-img');
            const radius = document.getElementById('tool-radius');
            const opacity = document.getElementById('tool-opacity');

            // Find companion input if data-image-slot
            btnReplace.addEventListener('click', () => {
                // If it's a data-image-slot, it has a companion overlay in parent doc.
                // But easier: just create a temporary file input and manually call apply
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        const reader = new FileReader();
                        reader.onload = (re) => {
                            if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                            if (el.tagName === 'IMG') {
                                el.src = re.target.result;
                            } else {
                                el.style.backgroundImage = `url('${re.target.result}')`;
                                el.style.backgroundSize = 'cover';
                                el.classList.add('has-custom-image');

                                const decorativeDivs = Array.from(el.querySelectorAll(':scope > div')).filter(c =>
                                    !c.classList.contains('img-replace-overlay') && c.tagName !== 'INPUT'
                                );
                                decorativeDivs.forEach(d => d.style.display = 'none');
                            }
                        };
                        reader.readAsDataURL(file);
                    }
                };
                input.click();
            });

            radius.addEventListener('input', (e) => {
                if (!el._undoSavingRadius) {
                    if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                    el._undoSavingRadius = true;
                    setTimeout(() => el._undoSavingRadius = false, 1000);
                }
                el.style.borderRadius = e.target.value + 'px';
                if (iframeWin.eidosUpdateSelection) iframeWin.eidosUpdateSelection();
            });
            opacity.addEventListener('input', (e) => {
                if (!el._undoSavingOpacity) {
                    if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                    el._undoSavingOpacity = true;
                    setTimeout(() => el._undoSavingOpacity = false, 1000);
                }
                el.style.opacity = e.target.value / 100;
                if (iframeWin.eidosUpdateSelection) iframeWin.eidosUpdateSelection();
            });
        }

        if (isShape && !isIcon) {
            const fill = document.getElementById('tool-fill');
            const stroke = document.getElementById('tool-stroke');
            const opacity = document.getElementById('tool-opacity');

            if (fill) {
                fill.value = el.style.backgroundColor || '#6366f1';
                fill.addEventListener('input', (e) => {
                    if (!el._undoSavingFill) {
                        if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                        el._undoSavingFill = true;
                        setTimeout(() => el._undoSavingFill = false, 1000);
                    }
                    el.style.backgroundColor = e.target.value;
                });
            }
            if (stroke) {
                stroke.addEventListener('input', (e) => {
                    if (!el._undoSavingStroke) {
                        if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                        el._undoSavingStroke = true;
                        setTimeout(() => el._undoSavingStroke = false, 1000);
                    }
                    el.style.borderColor = e.target.value;
                });
            }
            if (opacity) {
                opacity.addEventListener('input', (e) => {
                    if (!el._undoSavingOpacity) {
                        if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                        el._undoSavingOpacity = true;
                        setTimeout(() => el._undoSavingOpacity = false, 1000);
                    }
                    el.style.opacity = e.target.value / 100;
                });
            }
        }

        if (isIcon) {
            const iconColor = document.getElementById('tool-color');
            const iconSize = document.getElementById('tool-icon-size');

            iconColor.value = el.style.color || '#eab308';
            iconColor.addEventListener('input', (e) => {
                if (!el._undoSavingColor) {
                    if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                    el._undoSavingColor = true;
                    setTimeout(() => el._undoSavingColor = false, 1000);
                }
                el.style.color = e.target.value;
            });

            iconSize.addEventListener('input', (e) => {
                if (!el._undoSavingSize) {
                    if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                    el._undoSavingSize = true;
                    setTimeout(() => el._undoSavingSize = false, 1000);
                }
                const val = e.target.value + 'px';
                el.style.width = val;
                el.style.height = val;
                if (iframeWin.eidosUpdateSelection) iframeWin.eidosUpdateSelection();
            });
        }

        const layerUp = document.getElementById('tool-layer-up');
        const layerDown = document.getElementById('tool-layer-down');

        if (layerUp) {
            layerUp.addEventListener('click', () => {
                if (iframeWin.eidosToFront) iframeWin.eidosToFront();
            });
        }
        if (layerDown) {
            layerDown.addEventListener('click', () => {
                if (iframeWin.eidosToBack) iframeWin.eidosToBack();
            });
        }

        const deleteBtn = document.getElementById('tool-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                el.remove();
                if (iframeWin.eidosDeselect) iframeWin.eidosDeselect();
            });
        }
    }

    // --- 3. TOOLS PANEL CONTROL ---
    const toolsPanel = document.getElementById('editor-tools-panel');

    // Close button logic
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tools-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Cerrar panel';
    toolsPanel.appendChild(closeBtn);

    closeBtn.addEventListener('click', () => {
        toolsPanel.classList.add('is-empty');
        toolsPanel.classList.remove('is-fixed');
        if (iframeWin.eidosDeselect) iframeWin.eidosDeselect();
    });

    // Make panel stay open when interacting/adding elements
    function fixToolsPanel() {
        toolsPanel.classList.remove('is-empty');
        toolsPanel.classList.add('is-fixed');
    }

    // Collapse when clicking canvas background
    iframeDoc.addEventListener('click', (e) => {
        // Check if we are clicking an editable element or something inside one
        const selectors = iframeWin.editableSelectors || 'h1, h2, h3, h4, p, span, li, blockquote, div.card, div.stat-box, div.step-item, div.timeline-item, .img-slot, .tag, .lucide-icon, svg[data-lucide], .big-number, .big-label, .accent-bar, .subtitle, .step-num, .timeline-year, [class*="card"], [class*="box"], [class*="item"]';
        const isEditable = e.target.closest(selectors);
        const isTool = e.target.closest('.eidos-selection-box') || e.target.closest('.eidos-toolbar') || e.target.closest('.eidos-color-picker');

        if (!isEditable && !isTool) {
            // Check if we just selected something or ARE DRAGGING (to prevent immediate deselection flicker)
            const isJustSelected = iframeWin.eidosIsJustSelected && iframeWin.eidosIsJustSelected();
            const isDragging = iframeWin.eidosIsDragging && iframeWin.eidosIsDragging();

            if (isJustSelected || isDragging) {
                return;
            }

            const currentSelection = iframeWin.eidosGetSelection && iframeWin.eidosGetSelection();

            if (!currentSelection && !toolsPanel.classList.contains('is-empty') && !toolsPanel.classList.contains('is-fixed')) {
                // If nothing was selected and the panel was already open/not empty, collapse it (toggle behavior)
                toolsPanel.classList.add('is-empty');
            } else {
                // If something was selected (about to be deselected) or it was already collapsed, show slide tools
                renderTools(null);
                toolsPanel.classList.remove('is-empty');
            }

            // Always remove "is-fixed" when clicking the background to allow auto-collapsing
            toolsPanel.classList.remove('is-fixed');

            if (iframeWin.eidosDeselect) iframeWin.eidosDeselect();
        }
    });

    // --- 4. TOP BAR ACTIONS & ADD ELEMENTS ---
    function safeAddListener(id, event, cb) {
        let node = document.getElementById(id);
        if (!node) return;
        const clone = node.cloneNode(true);
        node.replaceWith(clone);
        clone.addEventListener(event, cb);
    }

    safeAddListener('btn-undo', 'click', () => {
        if (iframeWin.eidosUndo) iframeWin.eidosUndo();
    });
    safeAddListener('btn-redo', 'click', () => {
        if (iframeWin.eidosRedo) iframeWin.eidosRedo();
    });

    safeAddListener('btn-present', 'click', () => {
        const stage = document.getElementById('preview-stage');
        if (stage) {
            if (stage.requestFullscreen) {
                stage.requestFullscreen();
            } else if (stage.webkitRequestFullscreen) {
                stage.webkitRequestFullscreen();
            }
        }
    });

    // Zoom Canvas
    let zoomSelect = document.getElementById('canvas-zoom-select');
    if (zoomSelect) {
        const newZoom = zoomSelect.cloneNode(true);
        zoomSelect.replaceWith(newZoom);
        newZoom.addEventListener('change', (e) => {
            const scale = parseFloat(e.target.value);
            // App.js listens to window resize to call scaleIframe() which now reads the select value
            window.dispatchEvent(new Event('resize'));
        });
    }

    // Add Elements
    function getActiveSlide() {
        const slides = Array.from(iframeDoc.querySelectorAll('section[class*="s"]'));
        return slides.find(s => s.classList.contains('active')) || slides[0] || iframeDoc.body;
    }

    safeAddListener('btn-add-text', 'click', () => {
        fixToolsPanel();
        if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
        const slide = getActiveSlide();
        const text = iframeDoc.createElement('h2');
        text.textContent = 'Nuevo Texto';
        text.style.position = 'absolute';
        text.style.left = '50%';
        text.style.top = '50%';
        text.style.transform = 'translate(-50%, -50%)';
        text.style.zIndex = '100';
        text.style.color = '#ffffff';
        text.style.margin = '0';
        slide.appendChild(text);

        // Select it automatically to show tools
        if (iframeWin.initEditor) {
            // Injected editor.js has selectElement
        }
    });

    safeAddListener('btn-add-image', 'click', () => {
        fixToolsPanel();
        if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
        const slide = getActiveSlide();
        const img = iframeDoc.createElement('div');
        img.className = 'img-slot has-custom-image';
        img.style.position = 'absolute';
        img.style.left = '50%';
        img.style.top = '50%';
        img.style.transform = 'translate(-50%, -50%)';
        img.style.width = '300px';
        img.style.height = '200px';
        img.style.backgroundColor = 'rgba(255,255,255,0.1)';
        img.style.border = '2px dashed rgba(255,255,255,0.3)';
        img.style.borderRadius = '8px';
        img.style.zIndex = '100';
        img.dataset.imageSlot = 'manual-' + Date.now();
        slide.appendChild(img);

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (re) => {
                    img.style.backgroundImage = `url('${re.target.result}')`;
                    img.style.backgroundSize = 'cover';
                    img.style.border = 'none';
                };
                reader.readAsDataURL(file);
            }
        };
        input.click();
    });

    safeAddListener('btn-add-shape', 'click', () => {
        fixToolsPanel();
        renderTools('lib-shapes');
    });

    function insertShape(className, styles) {
        if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
        const slide = getActiveSlide();
        const shape = iframeDoc.createElement('div');
        shape.className = className + ' shapes-added'; // identification
        shape.style.position = 'absolute';
        shape.style.left = '50%';
        shape.style.top = '50%';
        shape.style.transform = styles.includes('rotate') ? styles : 'translate(-50%, -50%)';
        shape.style.width = styles && styles.includes('999px') ? '240px' : '150px';
        shape.style.height = '150px';
        shape.style.backgroundColor = '#6366f1';
        shape.style.zIndex = '100';

        // Split styles and apply manually 
        if (styles) {
            const custom = styles.split(';').filter(s => s.trim());
            custom.forEach(s => {
                const parts = s.split(':');
                const prop = parts.shift();
                const val = parts.join(':');
                if (prop && val) {
                    shape.style.setProperty(prop.trim(), val.trim());
                }
            });
        }

        slide.appendChild(shape);
        if (iframeWin.eidosUpdateSelection) iframeWin.eidosUpdateSelection();
    }

    safeAddListener('btn-add-icon', 'click', () => {
        fixToolsPanel();
        renderTools('lib-icons');
    });

    function insertIcon(iconName) {
        if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
        const slide = getActiveSlide();
        const icon = iframeDoc.createElement('i');
        icon.setAttribute('data-lucide', iconName);
        icon.style.position = 'absolute';
        icon.style.left = '50%';
        icon.style.top = '50%';
        icon.style.transform = 'translate(-50%, -50%)';
        icon.style.width = '64px';
        icon.style.height = '64px';
        icon.style.color = '#eab308';
        icon.style.zIndex = '100';
        icon.classList.add('lucide-icon');
        slide.appendChild(icon);

        if (iframeWin.lucide) iframeWin.lucide.createIcons();
        if (iframeWin.eidosUpdateSelection) iframeWin.eidosUpdateSelection();
    }

    // Run minimap builder
    buildMinimap();

    // Subscribe to internal slide active changes in app.js
    // Polling is a fallback for the MutationObserver to ensure smooth active state syncing
    let lastActiveSlideIndex = -1;
    if (window._eidosMinimapInterval) clearInterval(window._eidosMinimapInterval);
    window._eidosMinimapInterval = setInterval(() => {
        const slides = Array.from(iframeDoc.querySelectorAll('section[class*="s"], section'));
        const activeIdx = slides.findIndex(s => s.classList.contains('active'));
        if (activeIdx !== -1 && activeIdx !== lastActiveSlideIndex) {
            lastActiveSlideIndex = activeIdx;
            centerActiveMinimapItem();
        }
    }, 200);

    // Global Key Listener for Parent Window Shortcuts (Ctrl+Z / Ctrl+Y)
    const keydownHandler = (e) => {
        const container = document.getElementById('preview-container');
        if (!container || container.classList.contains('hidden')) return;

        // Prevent if editing text field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

        if (e.ctrlKey || e.metaKey) {
            const key = e.key.toLowerCase();
            if (key === 'z') {
                if (e.shiftKey) {
                    if (iframeWin.eidosRedo) iframeWin.eidosRedo();
                } else {
                    if (iframeWin.eidosUndo) iframeWin.eidosUndo();
                }
                e.preventDefault();
            } else if (key === 'y') {
                if (iframeWin.eidosRedo) iframeWin.eidosRedo();
                e.preventDefault();
            } else if (key === 'd') {
                if (!e.target.isContentEditable) {
                    e.preventDefault();
                    if (iframeWin.eidosDuplicateSelection && iframeWin.eidosGetSelection && iframeWin.eidosGetSelection()) {
                        iframeWin.eidosDuplicateSelection();
                    } else {
                        iframeWin.dispatchEvent(new CustomEvent('eidos-duplicate-slide'));
                    }
                }
            }
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            if (iframeWin.eidosDeleteSelection && iframeWin.eidosGetSelection && iframeWin.eidosGetSelection()) {
                iframeWin.eidosDeleteSelection();
                e.preventDefault();
            }
        } else if (e.key.startsWith('Arrow')) {
            if (iframeWin.eidosArrowMove && iframeWin.eidosGetSelection && iframeWin.eidosGetSelection()) {
                iframeWin.eidosArrowMove(e.key, e.shiftKey);
                e.preventDefault();
            }
        }
    };

    if (window._eidosKeydownHandler) {
        window.removeEventListener('keydown', window._eidosKeydownHandler);
    }
    window._eidosKeydownHandler = keydownHandler;
    window.addEventListener('keydown', window._eidosKeydownHandler);
}
