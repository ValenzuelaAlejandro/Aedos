(function registerMinimapSkeleton(global) {
    const api = global.AedosMinimapSkeleton || (global.AedosMinimapSkeleton = {});

    /** @typedef {{document: Document}} MinimapSkeletonDependencies */

    /** Create the existing streaming placeholder updater for the minimap. */
    function createMinimapSkeletonUpdater({ document }) {
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

    api.createMinimapSkeletonUpdater = createMinimapSkeletonUpdater;
})(window);
