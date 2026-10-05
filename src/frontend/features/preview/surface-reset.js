(function registerPreviewSurfaceReset(global) {
    'use strict';

    /** @typedef {{ window: Window, document: Document, previewState: Object, getDeps: Function, setRefreshSlotOverlays: Function, setOverlayMap: Function }} PreviewSurfaceResetDependencies */
    /** Create the existing iframe/minimap reset operation. @param {PreviewSurfaceResetDependencies} deps */
    function createPreviewSurfaceReset(deps) {
        const { window, document, previewState, slideDots, getDeps,
            setRefreshSlotOverlays, setOverlayMap } = deps;
        return function resetPreviewSurface() {
            const { scaleIframe, previewUiState } = getDeps();
            window.removeEventListener('resize', scaleIframe);
    
            previewUiState.minimapAlreadyInit = false;
            previewUiState.toolsAlreadyInit = false;
            const rawIframe = previewState.previewIframe.cloneNode();
            previewState.previewIframe.parentNode.replaceChild(rawIframe, previewState.previewIframe);
            previewState.previewIframe = rawIframe;
    
            const minimapList = document.getElementById('minimap-list');
            if (minimapList) {
                minimapList.innerHTML = '';
                minimapList.style.transform = 'none';
                const mmContainer = document.getElementById('editor-minimap');
                if (mmContainer) {
                    mmContainer.style.removeProperty('--presentation-accent');
                    mmContainer.style.removeProperty('--accent');
                }
            }
    
            if (slideDots) slideDots.innerHTML = '';
            previewState.slideContainer = null;
            setRefreshSlotOverlays(null);
            setOverlayMap(new Map());
        };
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createPreviewSurfaceReset = createPreviewSurfaceReset;
})(window);
