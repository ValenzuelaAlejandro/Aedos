(function registerOutlineStreamRenderer(global) {
    'use strict';

    /** @typedef {{ title?: string, key_points?: string[] }} PartialOutlineSlide */
    /** @typedef {{ slides?: PartialOutlineSlide[] }} PartialOutline */

    /**
     * Updates the disabled slide/point fields while outline JSON is streaming.
     * @param {HTMLElement} container
     * @param {PartialOutline} partialSkeleton
     * @param {() => void} scrollToBottom
     */
    function renderPartialOutline(container, partialSkeleton, scrollToBottom) {
        const slides = partialSkeleton.slides || [];
        const existingItems = container.querySelectorAll('.seamless-slide-item');

        slides.forEach((slide, index) => {
            let item = existingItems[index];
            if (!item) {
                item = document.createElement('div');
                item.className = 'seamless-slide-item';
                item.dataset.index = index;
                item.innerHTML = `
                <div class="seamless-slide-number">${index + 1}.</div>
                <textarea id="outline-slide-title-${index}" name="outline-slide-title-${index}" class="seamless-title-input outline-slide-title" placeholder="Slide Title" data-index="${index}" rows="1" aria-label="Slide Title" disabled></textarea>
                <div class="seamless-points-list" id="outline-points-${index}"></div>
            `;
                container.appendChild(item);

                if (global.gsap) {
                    global.gsap.fromTo(item, { opacity: 0, x: -12 }, { opacity: 1, x: 0, duration: 0.4, ease: 'power2.out' });
                }
            }

            const titleTextarea = item.querySelector('.outline-slide-title');
            if (titleTextarea && titleTextarea.value !== (slide.title || '')) {
                titleTextarea.value = slide.title || '';
                titleTextarea.style.height = 'auto';
                titleTextarea.style.height = titleTextarea.scrollHeight + 'px';
            }

            const pointsList = item.querySelector('.seamless-points-list');
            if (pointsList) {
                const existingPoints = pointsList.querySelectorAll('.seamless-point-item');
                const keyPoints = slide.key_points || [];

                keyPoints.forEach((point, pIndex) => {
                    let pItem = existingPoints[pIndex];
                    if (!pItem) {
                        pItem = document.createElement('div');
                        pItem.className = 'seamless-point-item';
                        pItem.innerHTML = `
                        <span class="seamless-point-bullet">-</span>
                        <textarea id="outline-slide-${index}-point-${pIndex}" name="outline-slide-${index}-point-${pIndex}" class="seamless-point-input outline-point-input" data-sindex="${index}" data-pindex="${pIndex}" rows="1" aria-label="Bullet point" disabled></textarea>
                    `;
                        pointsList.appendChild(pItem);

                        if (global.gsap) {
                            global.gsap.fromTo(pItem, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.3, ease: 'power2.out' });
                        }
                    }

                    const pTextarea = pItem.querySelector('.outline-point-input');
                    if (pTextarea && pTextarea.value !== point) {
                        pTextarea.value = point;
                        pTextarea.style.height = 'auto';
                        pTextarea.style.height = pTextarea.scrollHeight + 'px';
                    }
                });

                for (let i = keyPoints.length; i < existingPoints.length; i++) {
                    existingPoints[i].remove();
                }
            }
        });

        for (let i = slides.length; i < existingItems.length; i++) {
            existingItems[i].remove();
        }

        scrollToBottom();
    }

    global.AedosOutlineStreamRenderer = Object.freeze({ renderPartialOutline });
})(window);
