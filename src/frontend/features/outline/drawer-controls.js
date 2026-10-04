(function registerOutlineDrawerControls(global) {
    'use strict';

    /** @typedef {object} OutlineDrawerDependencies
     * @property {() => object|null} getSkeleton
     * @property {Function} bindOutlineBubbleActions
     * @property {Function} getActiveOutlineContainer
     * @property {Function} resumeOutlineEditor
     * @property {(message: string) => boolean} confirm
     * @property {(key: string, fallback: string) => string} translate
     * @property {Function} applyTranslations
     * @property {Function} abortActiveGeneration
     * @property {Function} navigateHome
     */

    function syncCustomDropdowns() {
        ['tone', 'audience', 'density'].forEach(type => {
            const select = document.getElementById(`outline-${type}-select`);
            const trigger = document.getElementById(`btn-outline-${type}-dropdown`);
            if (select && trigger) syncDropdownValue(type, select, trigger);
        });
    }

    function syncDropdownValue(type, select, trigger) {
        const activeItem = document.querySelector(`#outline-${type}-dropdown-menu .dropdown-item[data-value="${select.value}"]`);
        const labelSpan = trigger.querySelector('.trigger-label');
        if (!activeItem || !labelSpan) return;
        const translationKey = activeItem.getAttribute('data-i18n');
        if (translationKey) labelSpan.setAttribute('data-i18n', translationKey);
        else labelSpan.removeAttribute('data-i18n');
        labelSpan.textContent = activeItem.textContent;
        document.querySelectorAll(`#outline-${type}-dropdown-menu .dropdown-item`).forEach(button => {
            button.classList.toggle('active', button === activeItem);
        });
    }

    function bindDropdown(type, sync) {
        const container = document.getElementById(`outline-${type}-dropdown-container`);
        if (!container) return;
        const trigger = document.getElementById(`btn-outline-${type}-dropdown`);
        const menu = document.getElementById(`outline-${type}-dropdown-menu`);
        const select = document.getElementById(`outline-${type}-select`);
        if (trigger && menu && select) bindDropdownEvents(menu, select, trigger, sync);
    }

    function bindDropdownEvents(menu, select, trigger, sync) {
        trigger.addEventListener('click', event => {
            event.stopPropagation();
            closeOtherDropdowns(menu);
            const isHidden = menu.classList.toggle('hidden');
            trigger.setAttribute('aria-expanded', !isHidden);
        });
        menu.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', event => {
                event.stopPropagation();
                select.value = item.getAttribute('data-value');
                select.dispatchEvent(new Event('change'));
                sync();
                menu.classList.add('hidden');
                trigger.setAttribute('aria-expanded', 'false');
            });
        });
    }

    function closeOtherDropdowns(menu) {
        document.querySelectorAll('.outline-custom-dropdown .dropdown-menu').forEach(otherMenu => {
            if (otherMenu !== menu) {
                otherMenu.classList.add('hidden');
                otherMenu.parentElement.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
            }
        });
    }

    function bindBackButton(dependencies) {
        const button = document.getElementById('btn-outline-back');
        if (button) {
            button.addEventListener('click', () => {
                const message = dependencies.translate('confirm_exit_draft', 'Are you sure you want to go back? Your progress will be lost.');
                if (!dependencies.confirm(message)) return;
                dependencies.abortActiveGeneration();
                const container = dependencies.getActiveOutlineContainer();
                if (container) container.classList.add('hidden');
                dependencies.navigateHome();
            });
        }
        return button;
    }

    function bindEdgeTab(dependencies) {
        const edgeTab = document.getElementById('outline-edge-tab');
        if (edgeTab) edgeTab.addEventListener('click', () => handleEdgeTabClick(edgeTab, dependencies));
    }

    function handleEdgeTabClick(edgeTab, dependencies) {
        if (edgeTab.classList.contains('is-open')) {
            const backButton = document.getElementById('btn-outline-back');
            if (backButton) backButton.click();
        } else if (dependencies.getSkeleton()) {
            dependencies.resumeOutlineEditor();
        } else {
            showEmptyOutlineDrawer(edgeTab, dependencies);
        }
    }

    function showEmptyOutlineDrawer(edgeTab, dependencies) {
        const container = document.getElementById('outline-container');
        if (container) container.classList.remove('hidden');
        const emptyState = document.getElementById('outline-empty-state');
        if (emptyState) emptyState.classList.remove('hidden');
        document.querySelector('.outline-sidebar')?.style.setProperty('display', 'none');
        document.querySelector('.outline-main-header')?.style.setProperty('display', 'none');
        document.getElementById('legacy-outline-title-input')?.style.setProperty('display', 'none');
        document.querySelector('.outline-floating-footer')?.style.setProperty('display', 'none');
        edgeTab.classList.add('is-open');
        const tabText = edgeTab.querySelector('span');
        if (tabText) tabText.textContent = dependencies.translate('close_draft', 'Close draft');
        dependencies.applyTranslations();
    }

    function register(dependencies, sync) {
        document.addEventListener('DOMContentLoaded', () => {
            ['tone', 'audience', 'density'].forEach(type => bindDropdown(type, sync));
            document.addEventListener('click', closeAllDropdowns);
            dependencies.bindOutlineBubbleActions(document.getElementById('outline-container'));
            const backButton = bindBackButton(dependencies);
            bindBackdrop(backButton);
            bindEdgeTab(dependencies);
        });
    }

    function closeAllDropdowns() {
        document.querySelectorAll('.outline-custom-dropdown .dropdown-menu').forEach(menu => {
            menu.classList.add('hidden');
            menu.parentElement.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
        });
    }

    function bindBackdrop(backButton) {
        const backdrop = document.getElementById('outline-backdrop');
        if (backdrop && backButton) backdrop.addEventListener('click', () => backButton.click());
    }

    /** Creates outline drawer bindings without retaining outline state.
     * @param {OutlineDrawerDependencies} dependencies
     */
    function createOutlineDrawerControls(dependencies) {
        return Object.freeze({
            syncCustomDropdowns,
            register: () => register(dependencies, syncCustomDropdowns),
        });
    }

    global.AedosOutlineDrawerControls = Object.freeze({ createOutlineDrawerControls });
})(window);
