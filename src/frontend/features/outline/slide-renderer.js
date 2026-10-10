(function registerOutlineRenderer(global) {
    'use strict';

    /**
     * @typedef {object} OutlineSlide
     * @property {string} [title]
     * @property {string[]} [key_points]
     */

    /** Renders slide editor fields using the legacy markup and escaping. */
    function renderSlides(container, slides) {
        container.innerHTML = '';
        const deleteLabel = global.__t ? global.__t('delete_slide', 'Delete slide') : 'Delete slide';
        const safeDeleteLabel = global.escapeHtml(deleteLabel);
        const removeLabel = global.__t ? global.__t('outline_remove_slide', 'Remove') : 'Remove';
        const safeRemoveLabel = global.escapeHtml(removeLabel);

        slides.forEach((slide, index) => {
            const item = document.createElement('div');
            item.className = 'seamless-slide-item';
            item.dataset.index = index;

            item.innerHTML = `
            <div class="seamless-slide-number">${index + 1}.</div>
            <textarea id="outline-slide-title-${index}" name="outline-slide-title-${index}" class="seamless-title-input outline-slide-title" placeholder="Slide Title" data-index="${index}" rows="1" aria-label="Slide Title">${global.escapeHtml(slide.title || '')}</textarea>
            <button type="button" class="seamless-slide-delete" data-index="${index}" aria-label="${safeDeleteLabel} ${index + 1}" title="${safeDeleteLabel}" ${slides.length <= 1 ? 'disabled' : ''}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
                <span>${safeRemoveLabel}</span>
            </button>
            
            <div class="seamless-points-list" id="outline-points-${index}">
                ${(slide.key_points || []).map((point, pIndex) => `
                    <div class="seamless-point-item">
                        <span class="seamless-point-bullet">-</span>
                        <textarea id="outline-slide-${index}-point-${pIndex}" name="outline-slide-${index}-point-${pIndex}" class="seamless-point-input outline-point-input" data-sindex="${index}" data-pindex="${pIndex}" rows="1" aria-label="Bullet point">${global.escapeHtml(point)}</textarea>
                    </div>
                `).join('')}
            </div>
        `;

            container.appendChild(item);
        });
    }

    global.AedosOutlineRenderer = Object.freeze({ renderSlides });
})(window);
