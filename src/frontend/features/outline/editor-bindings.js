(function registerOutlineEditorBindings(global) {
    'use strict';

    /** @typedef {{ title?: string, subtitle?: string, role?: string, bg_color?: string, key_points?: string[] }} OutlineSlide */
    /**
     * @typedef {object} OutlineEditorBindings
     * @property {() => OutlineSlide[]} getSlides
     * @property {() => void} renderSlides
     * @property {() => void} updateSlideCount
     */

    /**
     * Binds the existing outline edit controls to the current live slide array.
     * @param {OutlineEditorBindings} api
     */
    function bindEvents(api) {
        // Bug #21: Use debounce for textarea inputs to avoid reflow on every keystroke
        function debounce(fn, ms) {
            let timer;
            return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
        }

        // Helper for auto-resizing textareas
        const autoResizeTextarea = (el) => {
            if (!el) return;
            el.style.height = 'auto';
            el.style.height = (el.scrollHeight) + 'px';
        };

        // Add event listeners for inputs — use dataset.index to always read from live state
        document.querySelectorAll('.outline-slide-title').forEach(input => {
            autoResizeTextarea(input);
            input.addEventListener('input', debounce((e) => {
                autoResizeTextarea(e.target);
                const idx = parseInt(e.target.dataset.index, 10);
                const slides = api.getSlides();
                if (slides[idx] !== undefined) slides[idx].title = e.target.value;
            }, 80));
        });
        document.querySelectorAll('.outline-slide-desc').forEach(input => {
            autoResizeTextarea(input);
            input.addEventListener('input', debounce((e) => {
                autoResizeTextarea(e.target);
                const idx = parseInt(e.target.dataset.index, 10);
                const slides = api.getSlides();
                if (slides[idx] !== undefined) slides[idx].subtitle = e.target.value;
            }, 80));
        });
        document.querySelectorAll('.outline-slide-type-select').forEach(select => {
            select.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.index, 10);
                const slides = api.getSlides();
                if (slides[idx] !== undefined) slides[idx].role = e.target.value;
            });
        });

        // Initialize custom Slide Type dropdowns
        document.querySelectorAll('.slide-type-dropdown').forEach(container => {
            const trigger = container.querySelector('.custom-select-trigger');
            const menu = container.querySelector('.custom-select-menu');
            const hiddenSelect = container.querySelector('.outline-slide-type-select');
            const labelSpan = trigger.querySelector('.trigger-label');

            if (trigger && menu && hiddenSelect) {
                trigger.addEventListener('click', (e) => {
                    e.stopPropagation();
                    document.querySelectorAll('.slide-type-dropdown .custom-select-menu').forEach(otherMenu => {
                        if (otherMenu !== menu) {
                            otherMenu.classList.add('hidden');
                            otherMenu.parentElement.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
                        }
                    });
                    const isHidden = menu.classList.toggle('hidden');
                    trigger.setAttribute('aria-expanded', !isHidden);
                });

                menu.querySelectorAll('.dropdown-item').forEach(item => {
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const val = item.getAttribute('data-value');
                        hiddenSelect.value = val;
                        labelSpan.textContent = item.textContent;

                        menu.querySelectorAll('.dropdown-item').forEach(btn => btn.classList.remove('active'));
                        item.classList.add('active');

                        hiddenSelect.dispatchEvent(new Event('change'));

                        menu.classList.add('hidden');
                        trigger.setAttribute('aria-expanded', 'false');
                    });
                });
            }
        });
        document.querySelectorAll('.outline-point-input').forEach(input => {
            autoResizeTextarea(input);

            // Handle auto-add new point on Enter
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const sIdx = parseInt(e.target.dataset.sindex, 10);
                    const pIdx = parseInt(e.target.dataset.pindex, 10);
                    const slides = api.getSlides();
                    if (slides[sIdx] && slides[sIdx].key_points) {
                        slides[sIdx].key_points.splice(pIdx + 1, 0, "");
                        api.renderSlides();

                        // Focus the new input
                        setTimeout(() => {
                            const newInputs = document.querySelectorAll(`.outline-point-input[data-sindex="${sIdx}"]`);
                            if (newInputs[pIdx + 1]) {
                                newInputs[pIdx + 1].focus();
                            }
                        }, 10);
                    }
                } else if (e.key === 'Backspace' && e.target.value === '') {
                    e.preventDefault();
                    const sIdx = parseInt(e.target.dataset.sindex, 10);
                    const pIdx = parseInt(e.target.dataset.pindex, 10);
                    const slides = api.getSlides();
                    if (slides[sIdx] && slides[sIdx].key_points && slides[sIdx].key_points.length > 1) {
                        slides[sIdx].key_points.splice(pIdx, 1);
                        api.renderSlides();

                        // Focus previous
                        setTimeout(() => {
                            const inputs = document.querySelectorAll(`.outline-point-input[data-sindex="${sIdx}"]`);
                            if (inputs[Math.max(0, pIdx - 1)]) {
                                const prevInput = inputs[Math.max(0, pIdx - 1)];
                                prevInput.focus();
                                prevInput.setSelectionRange(prevInput.value.length, prevInput.value.length);
                            }
                        }, 10);
                    }
                }
            });

            input.addEventListener('input', debounce((e) => {
                autoResizeTextarea(e.target);
                const sIdx = parseInt(e.target.dataset.sindex, 10);
                const pIdx = parseInt(e.target.dataset.pindex, 10);
                const slides = api.getSlides();
                if (slides[sIdx] && slides[sIdx].key_points) {
                    slides[sIdx].key_points[pIdx] = e.target.value;
                }
            }, 80));
        });
        document.querySelectorAll('.outline-point-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const btnEl = e.target.closest('.outline-point-delete');
                const sIdx = parseInt(btnEl.dataset.sindex, 10);
                const pIdx = parseInt(btnEl.dataset.pindex, 10);
                const slides = api.getSlides();
                if (slides[sIdx]) slides[sIdx].key_points.splice(pIdx, 1);
                api.renderSlides();
            });
        });
        document.querySelectorAll('.outline-slide-color-picker').forEach(picker => {
            picker.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.index, 10);
                const slides = api.getSlides();
                if (slides[idx] !== undefined) slides[idx].bg_color = e.target.value;
                const card = e.target.closest('.outline-slide-card');
                const indicator = card && card.querySelector('.outline-slide-bg-indicator');
                if (indicator) indicator.style.backgroundColor = e.target.value;
            });
        });

        api.updateSlideCount();
    }

    global.AedosOutlineEditorBindings = Object.freeze({ bindEvents });
})(window);
