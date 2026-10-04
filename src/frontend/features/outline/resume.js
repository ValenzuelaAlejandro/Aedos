(function registerOutlineResume(global) {
    'use strict';

    /** @typedef {{
     *   document: Document,
     *   getState: () => object,
     *   applyTranslations: () => void,
     *   syncCustomDropdowns: () => void,
     *   getActiveOutlineContainer: () => Element|null,
     *   getTimer: (name: string) => number|null,
     *   setTimer: (name: string, value: null) => void,
     *   clearTimeout: (timer: number) => void,
     *   getGsap: () => object|undefined,
     *   translate: (key: string, fallback: string) => string,
     * }} OutlineResumeDependencies
     */

    /** Clears one saved timer only when the legacy bridge is truthy. @param {OutlineResumeDependencies} dependencies @param {string} name */
    function clearResumeTimer(dependencies, name) {
        if (dependencies.getTimer(name)) {
            dependencies.clearTimeout(dependencies.getTimer(name));
            dependencies.setTimer(name, null);
        }
    }

    /** Resolves the existing hero message for the live loading state. @param {object} state @param {OutlineResumeDependencies} dependencies */
    function getHeroMessage(state, dependencies) {
        if (state.isLoading) return dependencies.translate('generating_outline', 'Generating structure...');
        return dependencies.translate('waiting_for_user', 'Waiting for your review...');
    }

    /** Restores the outline drawer and hero state for the current draft. @param {OutlineResumeDependencies} dependencies */
    function resumeOutlineEditor(dependencies) {
        const state = dependencies.getState();
        if (!state.skeleton) {
            state.skeleton = { slides: [] };
        }

        const { document: doc } = dependencies;
        // Ensure all editing UI elements are visible when resuming a real draft
        doc.querySelector('.outline-sidebar')?.style.removeProperty('display');
        doc.querySelector('.outline-main-header')?.style.removeProperty('display');
        doc.getElementById('legacy-outline-title-input')?.style.removeProperty('display');
        doc.querySelector('.outline-floating-footer')?.style.removeProperty('display');
        const emptyState = doc.getElementById('outline-empty-state');
        if (emptyState) emptyState.classList.add('hidden');

        dependencies.applyTranslations();

        // Sync custom dropdown UI values when resuming
        dependencies.syncCustomDropdowns();

        const outlineContainer = dependencies.getActiveOutlineContainer();
        if (outlineContainer) outlineContainer.classList.remove('hidden');

        const backdrop = doc.getElementById('outline-backdrop');
        if (backdrop) backdrop.classList.add('active');

        const edgeTab = doc.getElementById('outline-edge-tab');
        if (edgeTab) {
            edgeTab.classList.add('is-open');
            const tabText = edgeTab.querySelector('span');
            if (tabText) tabText.textContent = dependencies.translate('close_draft', 'Close draft');
        }

        const heroTextSpan = doc.querySelector('.hero-title-text');
        if (heroTextSpan) {
            // Kill typewriter before overwriting hero text
            clearResumeTimer(dependencies, '_heroTypewriterTimer');
            clearResumeTimer(dependencies, '_heroResetTimer');
            clearResumeTimer(dependencies, '_btnMsgTimer');
            const heroTitle = doc.querySelector('.hero-title');
            if (dependencies.getGsap() && heroTitle) {
                dependencies.getGsap().killTweensOf(heroTitle);
                dependencies.getGsap().set(heroTitle, { x: 0, opacity: 1 });
            }
            if (!heroTextSpan.getAttribute('data-original-text')) {
                heroTextSpan.setAttribute('data-original-text', heroTextSpan.textContent);
            }
            heroTextSpan.textContent = getHeroMessage(state, dependencies);
            heroTextSpan.parentElement.classList.add('waiting-state');
        }
    }

    global.AedosOutlineResume = { resumeOutlineEditor };
})(window);
