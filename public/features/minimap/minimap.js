function initMinimap(iframe) {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    const iframeWin = iframe.contentWindow;
    const minimapList = document.getElementById('minimap-list');
    const addSlideBtn = document.getElementById('btn-add-slide');
    let draggedItem = null;
    let minimapUpdateTimeout = null;

    function centerActiveMinimapItem(idx = null) {
        if (!minimapList) return;

        const items = Array.from(minimapList.querySelectorAll('.minimap-item'));
        let activeIdx = idx;

        if (activeIdx === null) {
            // Sync active state from iframe if needed (ensures functionality remains)
            const slides = Array.from(iframeDoc.querySelectorAll('section[class*="s"], section'));
            const iframeActiveIdx = slides.findIndex(s => s.classList.contains('active'));
            if (iframeActiveIdx !== -1 && items[iframeActiveIdx]) {
                items.forEach(it => it.classList.remove('active'));
                items[iframeActiveIdx].classList.add('active');
            }
            activeIdx = items.findIndex(item => item.classList.contains('active'));
        } else {
            // Direct highlight with provided index
            items.forEach((it, i) => it.classList.toggle('active', i === activeIdx));
        }

        if (activeIdx === -1 || activeIdx === null) return;

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
    window.syncMinimapActiveState = (idx) => centerActiveMinimapItem(idx);
    window.addEventListener('resize', centerActiveMinimapItem);

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
        
        const slides = Array.from(iframeDoc.querySelectorAll('section[class*="s"]'));
        if (slides.length === 0) {
            const sections = Array.from(iframeDoc.querySelectorAll('section'));
            if (sections.length > 0) slides.push(...sections);
        }

        const MAX_SLIDES = 15;
        const reachedLimit = slides.length >= MAX_SLIDES;

        // Disable add buttons visual state
        if (addSlideBtn) {
            addSlideBtn.disabled = reachedLimit;
            addSlideBtn.style.opacity = reachedLimit ? '0.5' : '1';
            addSlideBtn.style.pointerEvents = reachedLimit ? 'none' : 'auto';
        }

        // --- OPTIMIZATION: Non-destructive update ---
        const existingItems = Array.from(minimapList.querySelectorAll('.minimap-item'));
        
        // Remove excess items if any
        if (existingItems.length > slides.length) {
            for (let i = slides.length; i < existingItems.length; i++) {
                existingItems[i].remove();
            }
        }

        // --- DETECT PRIMARY COLOR ---
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

        const G_FONTS = '<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap" rel="stylesheet">';
        const headWithViewport = iframeDoc.head.innerHTML + G_FONTS + '<meta name="viewport" content="width=1122">';
        const htmlTemplate = `<!DOCTYPE html><html><head>${headWithViewport}</head><body style="margin:0;overflow:hidden;background:transparent;display:block;width:1122px;height:631px;"><main style="display:block;width:1122px;height:631px;position:relative;transform:none;">[CONTENT]</main></body></html>`;

        slides.forEach((slide, index) => {
            let item = existingItems[index];
            let isNew = false;
            
            if (!item) {
                item = document.createElement('div');
                item.className = 'minimap-item';
                isNew = true;
            }
            
            item.dataset.index = index;
            item.draggable = true;

            let thumbIframe = item.querySelector('iframe');
            if (!thumbIframe) {
                thumbIframe = document.createElement('iframe');
                thumbIframe.style.width = '1122px';
                thumbIframe.style.height = '631px';
                thumbIframe.style.background = 'transparent';
                thumbIframe.style.border = 'none';
                item.appendChild(thumbIframe);
            }

            // Clean slide for thumbnail
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

            const newContent = htmlTemplate.split('[CONTENT]').join(clone.outerHTML);
            // Optimization: Only update srcdoc if content changed to avoid iframe flicker/reload
            if (thumbIframe.srcdoc !== newContent) {
                thumbIframe.srcdoc = newContent;
            }

            let overlay = item.querySelector('.minimap-item-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'minimap-item-overlay';
                
                const delBtn = document.createElement('button');
                delBtn.className = 'minimap-delete-btn';
                delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                delBtn.title = window.__eidos_t('delete_slide', 'Delete Slide');

                const dupBtn = document.createElement('button');
                dupBtn.className = 'minimap-dup-btn';
                dupBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
                dupBtn.title = reachedLimit ? window.__eidos_t('limit_reached', 'Limit reached (15 slides max)') : window.__eidos_t('duplicate_slide', 'Duplicate Slide');
                
                overlay.appendChild(delBtn);
                overlay.appendChild(dupBtn);
                item.appendChild(overlay);
            }
            
            // Sync handlers and visual state (Crucial: update onclick with new iframe context)
            const delBtn = overlay.querySelector('.minimap-delete-btn');
            const dupBtn = overlay.querySelector('.minimap-dup-btn');
            
            if (delBtn) {
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (Array.from(iframeDoc.querySelectorAll('section[class*="s"]')).length <= 1) return;
                    if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
                    slide.remove();
                    buildMinimap();
                    setTimeout(() => {
                        const dots = document.querySelectorAll('.slide-dot');
                        const newIdx = Math.min(index, dots.length - 1);
                        if (dots[newIdx]) dots[newIdx].click();
                    }, 50);
                };
            }

            if (dupBtn) {
                dupBtn.disabled = reachedLimit;
                dupBtn.style.opacity = reachedLimit ? '0.5' : '1';
                dupBtn.style.cursor = reachedLimit ? 'not-allowed' : 'pointer';
                dupBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (Array.from(iframeDoc.querySelectorAll('section[class*="s"]')).length >= 15) return;
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
            }

            let numberWrap = item.querySelector('.minimap-item-number');
            if (!numberWrap) {
                numberWrap = document.createElement('div');
                numberWrap.className = 'minimap-item-number';
                item.appendChild(numberWrap);
            }
            numberWrap.textContent = index + 1;

            // Highlight active
            item.classList.toggle('active', slide.classList.contains('active'));

            if (isNew) {
                // Click to navigate
                item.addEventListener('click', () => {
                    const dots = document.querySelectorAll('.slide-dot');
                    if (dots[index]) dots[index].click();
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
                        if (draggedItem) draggedItem.classList.remove('is-dragging');
                        draggedItem = null;
                    }, 0);
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

                observeMinimapItem(item);
                minimapList.appendChild(item);
            }
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

        // Initial centering
        requestAnimationFrame(() => centerActiveMinimapItem());
    }

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

        const G_FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap" rel="stylesheet"><style>:root{--font-display:\'Syne\',sans-serif;--font-body:\'DM Sans\',sans-serif;}</style>';
        const headWithViewport = iframeDoc.head.innerHTML + G_FONTS + '<meta name="viewport" content="width=1122">';
        const localizedHtml = `<!DOCTYPE html><html><head>${headWithViewport}</head><body style="margin:0;overflow:hidden;background:transparent;display:block;width:1122px;height:631px;"><main style="display:block;width:1122px;height:631px;position:relative;transform:none;">[CONTENT]</main></body></html>`;

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

        ifr.srcdoc = localizedHtml.split('[CONTENT]').join(clone.outerHTML);
    }

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
        const slideNodes = newOrder.map(i => slides[i]);
        slideNodes.forEach(node => container.appendChild(node));

        if (window.regenerateDotsCount) window.regenerateDotsCount();
        buildMinimap();
        setTimeout(centerActiveMinimapItem, 50);
    }

    if (addSlideBtn) {
        addSlideBtn.onclick = () => {
            const slides = Array.from(iframeDoc.querySelectorAll('section[class*="s"]'));
            if (slides.length >= 15) return;
            if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
            if (slides.length === 0) return;
            const activeSlide = slides.find(s => s.classList.contains('active')) || slides[slides.length - 1];

            const newSlide = activeSlide.cloneNode(true);
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
        };
    }

    // listener eidos-state-restored con auto-limpieza
    if (iframeWin._eidosStateRestoredHandler) {
        iframeWin.removeEventListener('eidos-state-restored', iframeWin._eidosStateRestoredHandler);
    }
    iframeWin._eidosStateRestoredHandler = () => {
        setTimeout(() => { buildMinimap(); centerActiveMinimapItem(); }, 300);
    };
    iframeWin.addEventListener('eidos-state-restored', iframeWin._eidosStateRestoredHandler);

    buildMinimap();
}
window.initMinimap = initMinimap;
