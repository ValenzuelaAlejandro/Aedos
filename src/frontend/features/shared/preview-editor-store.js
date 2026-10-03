(function registerPreviewEditorStore(global) {
    'use strict';

    /** @typedef {{ currentSlide: number, totalSlides: number, generatedHtml: string, slideContainer: HTMLElement | null, currentTitle: string, previewIframe: HTMLIFrameElement | null, editorInsets: { left: number, right: number, top: number, bottom: number }, settlingAnimation: object | null, legacyCurrentSlide: number }} PreviewEditorState */

    /** @type {PreviewEditorState} */
    const state = {
        currentSlide: 0,
        totalSlides: 0,
        generatedHtml: '',
        slideContainer: null,
        currentTitle: 'Presentation',
        previewIframe: null,
        editorInsets: { left: 0, right: 0, top: 0, bottom: 0 },
        settlingAnimation: null,
        legacyCurrentSlide: 0
    };

    global.AedosStores = global.AedosStores || {};
    global.AedosStores.previewEditor = Object.freeze({ state });

    // The old bridge was explicitly synchronized by the app, not a live alias
    // of its local slide cursor. Keep that distinction for iframe consumers.
    Object.defineProperty(global, 'currentSlide', {
        configurable: true,
        enumerable: true,
        get: () => state.legacyCurrentSlide,
        set: (value) => { state.legacyCurrentSlide = value; }
    });
})(window);
