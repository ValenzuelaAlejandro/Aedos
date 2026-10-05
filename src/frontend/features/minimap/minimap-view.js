/**
 * @typedef {object} MinimapViewOptions
 * @property {Document} iframeDoc
 * @property {Window} iframeWin
 * @property {HTMLElement|null} minimapList
 * @property {() => void} buildMinimap
 */

const observeMinimapItem = function (item) {
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
};

const getDragAfterElement = function (container, y) {
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
};

/**
 * Create the updater used for streaming slide placeholders in the page minimap.
 * @param {{document: Document}} deps
 * @returns {(count: number) => void}
 */
function createSkeletonUpdater({ document }) {
    return function updateMinimapSkeleton(count) {
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
    };
}

/**
 * Creates the view and ordering helpers shared by minimap initialization.
 *
 * @param {MinimapViewOptions} options
 * @returns {{centerActiveMinimapItem: (idx?: number|null) => void, observeMinimapItem: (item: Element) => void, recalcThumbsAndCenter: () => void, getDragAfterElement: (container: Element, y: number) => Element|null, syncSlidesOrderToIframe: () => void}}
 */
const createAedosMinimapView = function (options) {
    const { iframeDoc, iframeWin, minimapList, buildMinimap } = options;

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
        if (!minimapContainer) return;

        // Descontar el área ocupada por el botón + fijado al fondo
        const addBtn = document.getElementById('btn-add-slide');
        const footerReserve = addBtn ? (addBtn.offsetHeight + 28) : 72;
        const panelHeight = minimapContainer.clientHeight;
        const viewportHeight = Math.max(120, panelHeight - footerReserve);

        // Mide el item real incluyendo su margin
        const activeItem = items[activeIdx];
        if (!activeItem) return;
        const style = window.getComputedStyle(activeItem);
        const marginTop = parseFloat(style.marginTop) || 0;
        const marginBottom = parseFloat(style.marginBottom) || 0;
        const ITEM_HEIGHT = activeItem.offsetHeight + marginTop + marginBottom;

        // Centrar dentro del área útil y limitar el desplazamiento
        let offset = (viewportHeight / 2) - (activeIdx * ITEM_HEIGHT) - (ITEM_HEIGHT / 2) + 12;
        const listHeight = minimapList.scrollHeight;
        const maxOffset = 0;
        const minOffset = Math.min(0, viewportHeight - listHeight);
        offset = Math.min(maxOffset, Math.max(minOffset, offset));

        minimapList.style.transform = `translateY(${offset}px)`;
        minimapList.style.transition = 'transform 380ms cubic-bezier(0.4, 0, 0.2, 1)';
    }

    function recalcThumbsAndCenter() {
        if (!minimapList) return;
        minimapList.querySelectorAll('iframe').forEach(ifr => {
            const itemWidth = ifr.parentElement.clientWidth;
            const scale = (itemWidth > 0 ? itemWidth : 188) / 1122;
            ifr.style.width = '1122px';
            ifr.style.height = '631px';
            ifr.style.transform = `scale(${scale})`;
        });
        requestAnimationFrame(() => centerActiveMinimapItem());
    }

    function syncSlidesOrderToIframe() {
        if (iframeWin.editorSaveState) iframeWin.editorSaveState();

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

    return { centerActiveMinimapItem, observeMinimapItem, recalcThumbsAndCenter, getDragAfterElement, syncSlidesOrderToIframe };
};

window.AedosMinimapView = Object.freeze({ create: createAedosMinimapView, createSkeletonUpdater });
