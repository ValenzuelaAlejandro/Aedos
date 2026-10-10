(function registerOutlineSlideCommands(global) {
    'use strict';

    /** @typedef {{ role?: string, title?: string, subtitle?: string, key_points?: string[] }} OutlineCommandSlide */
    /** @typedef {{
     *   getSlides: () => OutlineCommandSlide[],
     *   getMaxSlides: () => number,
     *   renderSlides: () => void,
     * }} OutlineSlideCommandDependencies
     */

    function animateNewCard(card, duration) {
        card.classList.add('is-new');
        global.requestAnimationFrame(() => card.classList.add('is-new-visible'));
        global.setTimeout(() => card.classList.remove('is-new', 'is-new-visible'), duration);
    }

    function scrollToNewSlide() {
        const main = global.document.querySelector('.outline-main');
        global.requestAnimationFrame(() => {
            if (main) main.scrollTop = main.scrollHeight;
            const cards = global.document.querySelectorAll('.outline-slide-card');
            const newCard = cards[cards.length - 1];
            if (newCard) animateNewCard(newCard, 500);
        });
    }

    /** Adds a blank slide and keeps the legacy scroll/entrance animation. @param {OutlineSlideCommandDependencies} dependencies */
    function addBlankSlide(dependencies) {
        const slides = dependencies.getSlides();
        if (slides.length >= dependencies.getMaxSlides()) return;

        slides.push({ role: 'concept', title: '', subtitle: '', key_points: [] });
        dependencies.renderSlides();
        scrollToNewSlide();
    }

    /** Adds an editable point in place when possible, preserving focus behavior. @param {number} slideIndex @param {OutlineSlideCommandDependencies} dependencies */
    function addBlankPoint(slideIndex, dependencies) {
        const slides = dependencies.getSlides();
        if (!slides[slideIndex].key_points) slides[slideIndex].key_points = [];
        slides[slideIndex].key_points.push('');

        const pointList = global.document.getElementById(`outline-points-${slideIndex}`);
        if (pointList) {
            const pointIndex = slides[slideIndex].key_points.length - 1;
            const newItem = global.document.createElement('div');
            newItem.className = 'outline-point-item';
            newItem.innerHTML = `
            <span class="outline-point-bullet">●</span>
            <textarea id="outline-slide-${slideIndex}-point-${pointIndex}" name="outline-slide-${slideIndex}-point-${pointIndex}" class="outline-point-input" data-sindex="${slideIndex}" data-pindex="${pointIndex}" rows="1" aria-label="Bullet point" style="height: auto; resize: none; overflow-y: hidden;"></textarea>
            <button type="button" class="outline-point-delete" data-sindex="${slideIndex}" data-pindex="${pointIndex}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
        `;
            pointList.appendChild(newItem);

            const textarea = newItem.querySelector('.outline-point-input');
            textarea.addEventListener('input', (event) => {
                event.target.style.height = 'auto';
                event.target.style.height = `${event.target.scrollHeight}px`;
                const slideIdx = global.parseInt(event.target.dataset.sindex, 10);
                const pointIdx = global.parseInt(event.target.dataset.pindex, 10);
                const currentSlides = dependencies.getSlides();
                if (currentSlides[slideIdx] && currentSlides[slideIdx].key_points) {
                    currentSlides[slideIdx].key_points[pointIdx] = event.target.value;
                }
            });

            const deleteButton = newItem.querySelector('.outline-point-delete');
            deleteButton.addEventListener('click', () => {
                const slideIdx = global.parseInt(deleteButton.dataset.sindex, 10);
                const pointIdx = global.parseInt(deleteButton.dataset.pindex, 10);
                const currentSlides = dependencies.getSlides();
                if (currentSlides[slideIdx]) currentSlides[slideIdx].key_points.splice(pointIdx, 1);
                dependencies.renderSlides();
            });

            textarea.focus();
            animateNewCard(newItem, 400);
        } else {
            dependencies.renderSlides();
        }
    }

    /** Deletes a slide after the existing confirmation prompt. @param {number} index @param {OutlineSlideCommandDependencies} dependencies */
    function deleteSlide(index, dependencies) {
        const slides = dependencies.getSlides();
        if (!Number.isInteger(index) || index < 0 || index >= slides.length || slides.length <= 1) return;
        const prompt = global.__t
            ? global.__t('outline_confirm_delete_slide', 'Delete this slide?')
            : 'Delete this slide?';
        if (global.confirm(prompt)) {
            slides.splice(index, 1);
            dependencies.renderSlides();
        }
    }

    function moveSlide(index, offset, dependencies) {
        const slides = dependencies.getSlides();
        const targetIndex = index + offset;
        const temp = slides[targetIndex];
        slides[targetIndex] = slides[index];
        slides[index] = temp;
        const main = global.document.querySelector('.outline-main');
        const scrollTop = main ? main.scrollTop : 0;
        dependencies.renderSlides();
        global.requestAnimationFrame(() => { if (main) main.scrollTop = scrollTop; });
    }

    /** Moves a slide one place toward the beginning. @param {number} index @param {OutlineSlideCommandDependencies} dependencies */
    function moveSlideUp(index, dependencies) {
        if (index === 0) return;
        moveSlide(index, -1, dependencies);
    }

    /** Moves a slide one place toward the end. @param {number} index @param {OutlineSlideCommandDependencies} dependencies */
    function moveSlideDown(index, dependencies) {
        if (index === dependencies.getSlides().length - 1) return;
        moveSlide(index, 1, dependencies);
    }

    global.AedosOutlineSlideCommands = Object.freeze({
        addBlankSlide,
        addBlankPoint,
        deleteSlide,
        moveSlideUp,
        moveSlideDown,
    });
})(window);
