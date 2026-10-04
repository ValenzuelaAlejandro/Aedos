/** @typedef {{document: Document, window: Window, MutationObserver: typeof MutationObserver, getSelectedElement: () => Element|null, deselect: () => void}} EditorSlideObserversOptions */

/** Installs legacy slide-navigation and slide-activation deselection observers. @param {EditorSlideObserversOptions} options */
export function installEditorSlideObservers({ document, window, MutationObserver, getSelectedElement, deselect }) {
    const handleSlideChange = () => {
        if (getSelectedElement()) deselect();
    };

    window.addEventListener('navigate-prev', handleSlideChange);
    window.addEventListener('navigate-next', handleSlideChange);

    const slideActivationObserver = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            if (mutation.target.classList.contains('active') && getSelectedElement()) {
                deselect();
            }
        });
    });

    function observeSlides() {
        document.querySelectorAll('section.s').forEach(slide => {
            slideActivationObserver.observe(slide, { attributes: true, attributeFilter: ['class'] });
        });
    }
    observeSlides();

    const slideStructureObserver = new MutationObserver(() => observeSlides());
    const observationTarget = document.body || document.documentElement;
    if (observationTarget) {
        slideStructureObserver.observe(observationTarget, { childList: true, subtree: true });
    }
}
