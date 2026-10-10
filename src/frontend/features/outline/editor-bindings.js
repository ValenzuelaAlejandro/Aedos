(function registerOutlineEditorBindings(global) {
    'use strict';

    /** @typedef {{ title?: string, subtitle?: string, role?: string, key_points?: string[], bg_color?: string }} EditableOutlineSlide */
    /** @typedef {{
     *   getSlides: () => EditableOutlineSlide[],
     *   renderSlides: () => void,
     *   updateSlideCount: () => void,
     * }} OutlineBindingDependencies
     */

    function createDebouncedHandler(handler, delay) {
        let timer;
        return (...args) => {
            global.clearTimeout(timer);
            timer = global.setTimeout(() => handler(...args), delay);
        };
    }

    function autoResizeTextarea(element) {
        if (!element) return;
        element.style.height = 'auto';
        element.style.height = `${element.scrollHeight}px`;
    }

    function bindTextFields(selector, property, dependencies) {
        global.document.querySelectorAll(selector).forEach((input) => {
            autoResizeTextarea(input);
            input.addEventListener('input', createDebouncedHandler((event) => {
                autoResizeTextarea(event.target);
                const index = global.parseInt(event.target.dataset.index, 10);
                const slides = dependencies.getSlides();
                if (slides[index] !== undefined) slides[index][property] = event.target.value;
            }, 80));
        });
    }

    function bindSlideTypeFields(dependencies) {
        global.document.querySelectorAll('.outline-slide-type-select').forEach((select) => {
            select.addEventListener('change', (event) => {
                const index = global.parseInt(event.target.dataset.index, 10);
                const slides = dependencies.getSlides();
                if (slides[index] !== undefined) slides[index].role = event.target.value;
            });
        });
    }

    function bindSlideTypeDropdowns() {
        global.document.querySelectorAll('.slide-type-dropdown').forEach((container) => {
            const trigger = container.querySelector('.custom-select-trigger');
            const menu = container.querySelector('.custom-select-menu');
            const hiddenSelect = container.querySelector('.outline-slide-type-select');
            const labelSpan = trigger.querySelector('.trigger-label');

            if (!trigger || !menu || !hiddenSelect) return;
            trigger.addEventListener('click', (event) => toggleTypeMenu(event, trigger, menu));
            menu.querySelectorAll('.dropdown-item').forEach((item) => {
                item.addEventListener('click', (event) => selectSlideType(event, item, menu, trigger, hiddenSelect, labelSpan));
            });
        });
    }

    function toggleTypeMenu(event, trigger, menu) {
        event.stopPropagation();
        global.document.querySelectorAll('.slide-type-dropdown .custom-select-menu').forEach((otherMenu) => {
            if (otherMenu !== menu) {
                otherMenu.classList.add('hidden');
                otherMenu.parentElement.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
            }
        });
        const isHidden = menu.classList.toggle('hidden');
        trigger.setAttribute('aria-expanded', !isHidden);
    }

    function selectSlideType(event, item, menu, trigger, hiddenSelect, labelSpan) {
        event.stopPropagation();
        hiddenSelect.value = item.getAttribute('data-value');
        labelSpan.textContent = item.textContent;
        menu.querySelectorAll('.dropdown-item').forEach((button) => button.classList.remove('active'));
        item.classList.add('active');
        hiddenSelect.dispatchEvent(new global.Event('change'));
        menu.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
    }

    function focusPointInput(selector, index, selectEnd) {
        global.setTimeout(() => {
            const inputs = global.document.querySelectorAll(selector);
            const input = inputs[index];
            if (!input) return;
            input.focus();
            if (selectEnd) input.setSelectionRange(input.value.length, input.value.length);
        }, 10);
    }

    function handlePointKeydown(event, dependencies) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            const slideIndex = global.parseInt(event.target.dataset.sindex, 10);
            const pointIndex = global.parseInt(event.target.dataset.pindex, 10);
            const slides = dependencies.getSlides();
            if (slides[slideIndex] && slides[slideIndex].key_points) {
                slides[slideIndex].key_points.splice(pointIndex + 1, 0, '');
                dependencies.renderSlides();
                focusPointInput(`.outline-point-input[data-sindex="${slideIndex}"]`, pointIndex + 1, false);
            }
        } else if (event.key === 'Backspace' && event.target.value === '') {
            event.preventDefault();
            const slideIndex = global.parseInt(event.target.dataset.sindex, 10);
            const pointIndex = global.parseInt(event.target.dataset.pindex, 10);
            const slides = dependencies.getSlides();
            if (slides[slideIndex] && slides[slideIndex].key_points && slides[slideIndex].key_points.length > 1) {
                slides[slideIndex].key_points.splice(pointIndex, 1);
                dependencies.renderSlides();
                focusPointInput(`.outline-point-input[data-sindex="${slideIndex}"]`, Math.max(0, pointIndex - 1), true);
            }
        }
    }

    function bindPointFields(dependencies) {
        global.document.querySelectorAll('.outline-point-input').forEach((input) => {
            autoResizeTextarea(input);
            input.addEventListener('keydown', (event) => handlePointKeydown(event, dependencies));
            input.addEventListener('input', createDebouncedHandler((event) => {
                autoResizeTextarea(event.target);
                const slideIndex = global.parseInt(event.target.dataset.sindex, 10);
                const pointIndex = global.parseInt(event.target.dataset.pindex, 10);
                const slides = dependencies.getSlides();
                if (slides[slideIndex] && slides[slideIndex].key_points) {
                    slides[slideIndex].key_points[pointIndex] = event.target.value;
                }
            }, 80));
        });
    }

    function bindPointDeleteButtons(dependencies) {
        global.document.querySelectorAll('.outline-point-delete').forEach((button) => {
            button.addEventListener('click', (event) => {
                const target = event.target.closest('.outline-point-delete');
                const slideIndex = global.parseInt(target.dataset.sindex, 10);
                const pointIndex = global.parseInt(target.dataset.pindex, 10);
                const slides = dependencies.getSlides();
                if (slides[slideIndex]) slides[slideIndex].key_points.splice(pointIndex, 1);
                dependencies.renderSlides();
            });
        });
    }

    function bindSlideDeleteButtons(dependencies) {
        global.document.querySelectorAll('.seamless-slide-delete').forEach((button) => {
            button.addEventListener('click', () => {
                const index = global.parseInt(button.dataset.index, 10);
                if (dependencies.getSlides().length <= 1) return;
                dependencies.deleteSlide(index);
            });
        });
    }

    function bindSlideColorPickers(dependencies) {
        global.document.querySelectorAll('.outline-slide-color-picker').forEach((picker) => {
            picker.addEventListener('input', (event) => {
                const index = global.parseInt(event.target.dataset.index, 10);
                const slides = dependencies.getSlides();
                if (slides[index] !== undefined) slides[index].bg_color = event.target.value;
                const card = event.target.closest('.outline-slide-card');
                const indicator = card && card.querySelector('.outline-slide-bg-indicator');
                if (indicator) indicator.style.backgroundColor = event.target.value;
            });
        });
    }

    /** Binds existing outline controls without owning the shared slide array. @param {OutlineBindingDependencies} dependencies */
    function bindOutlineEditorEvents(dependencies) {
        bindTextFields('.outline-slide-title', 'title', dependencies);
        bindTextFields('.outline-slide-desc', 'subtitle', dependencies);
        bindSlideTypeFields(dependencies);
        bindSlideTypeDropdowns();
        bindPointFields(dependencies);
        bindPointDeleteButtons(dependencies);
        bindSlideDeleteButtons(dependencies);
        bindSlideColorPickers(dependencies);
        dependencies.updateSlideCount();
    }

    global.AedosOutlineEditorBindings = Object.freeze({ bindOutlineEditorEvents });
})(window);
