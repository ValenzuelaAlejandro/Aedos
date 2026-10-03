import { escapeHtml } from '../chat/attachment-renderer.js?v=2';

    /**
     * @typedef {object} OutlineSlide
     * @property {string} [title]
     * @property {string[]} [key_points]
     */

    /** Renders slide editor fields using the legacy markup and escaping. */
export function renderSlides(container, slides) {
        container.innerHTML = '';

        slides.forEach((slide, index) => {
            const item = document.createElement('div');
            item.className = 'seamless-slide-item';
            item.dataset.index = index;

            item.innerHTML = `
            <div class="seamless-slide-number">${index + 1}.</div>
            <textarea id="outline-slide-title-${index}" name="outline-slide-title-${index}" class="seamless-title-input outline-slide-title" placeholder="Slide Title" data-index="${index}" rows="1" aria-label="Slide Title">${escapeHtml(slide.title || '')}</textarea>
            
            <div class="seamless-points-list" id="outline-points-${index}">
                ${(slide.key_points || []).map((point, pIndex) => `
                    <div class="seamless-point-item">
                        <span class="seamless-point-bullet">-</span>
                        <textarea id="outline-slide-${index}-point-${pIndex}" name="outline-slide-${index}-point-${pIndex}" class="seamless-point-input outline-point-input" data-sindex="${index}" data-pindex="${pIndex}" rows="1" aria-label="Bullet point">${escapeHtml(point)}</textarea>
                    </div>
                `).join('')}
            </div>
        `;

            container.appendChild(item);
        });
}

// Compatibility facade for the classic outline controller.
window.AedosOutlineRenderer = Object.freeze({ renderSlides });
