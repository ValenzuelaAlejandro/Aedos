(function registerExportSnapshot(global) {
    'use strict';

    const PDF_CONTAINER_SELECTOR = '[data-container="true"], div.stat-box, div.card, div.step-item, div.timeline-item, .quote-block, blockquote, ul, ol, .flex-row, .flex-col, .grid-2, .grid-3, [class*="card"], [class*="box"]';
    const PDF_TEXT_SELECTOR = 'h1,h2,h3,h4,p,span,blockquote,.big-number,.big-label,.tag,.subtitle,.step-num,.timeline-year,li,cite';

    /** @returns {Array<{el: HTMLElement, prevWidth: string, prevMinWidth: string, prevWhiteSpace: string}>} */
    function snapshotTextMeasurements(iframeDoc) {
        const snapshots = [];
        const iframeView = iframeDoc.defaultView;
        iframeDoc.querySelectorAll(PDF_CONTAINER_SELECTOR).forEach(container => {
            container.querySelectorAll(PDF_TEXT_SELECTOR).forEach(child => {
                const rect = child.getBoundingClientRect();
                if (!rect.width || !rect.height) return;
                const comp = iframeView.getComputedStyle(child);
                const lineH = parseFloat(comp.lineHeight) || parseFloat(comp.fontSize) * 1.2;
                const isSingleLine = rect.height <= lineH * 1.8;
                snapshots.push({
                    el: child,
                    prevWidth: child.style.width,
                    prevMinWidth: child.style.minWidth,
                    prevWhiteSpace: child.style.whiteSpace
                });
                if (isSingleLine) {
                    child.style.whiteSpace = 'nowrap';
                } else {
                    child.style.width = rect.width + 'px';
                    child.style.minWidth = rect.width + 'px';
                }
            });
        });
        return snapshots;
    }

    /** Restores the preview styles after the cloned HTML captured them. */
    function restoreTextMeasurements(snapshots) {
        snapshots.forEach(({ el, prevWidth, prevMinWidth, prevWhiteSpace }) => {
            el.style.width = prevWidth;
            el.style.minWidth = prevMinWidth;
            el.style.whiteSpace = prevWhiteSpace;
        });
    }

    /** Removes transient editor-only nodes from the detached export clone. */
    function removeTransientUi(clone) {
        const editorUI = clone.querySelectorAll(
            '.editor-selection-box, .editor-toolbar, .editor-color-picker, .editor-guide'
        );
        editorUI.forEach(el => el.remove());

        const injectedStyles = clone.querySelectorAll('.preview-injected-style');
        injectedStyles.forEach(s => s.remove());

        const skeletonInjectors = clone.querySelectorAll('.skeleton-injector');
        skeletonInjectors.forEach(s => s.remove());

        const tempSkel = clone.querySelector('#temp-skeleton');
        if (tempSkel) tempSkel.remove();

        const overlays = clone.querySelectorAll('.img-replace-overlay');
        overlays.forEach(o => o.remove());

        const fileInputs = clone.querySelectorAll('.preview-file-input');
        fileInputs.forEach(f => f.remove());
    }

    /** Removes carousel/editor layout styles from cloned slides and ancestors. */
    function resetCarouselStyles(clone) {
        const slides = clone.querySelectorAll('section');
        slides.forEach(s => {
            s.classList.remove('active');
            s.style.flex = '';
            s.style.width = '';
            s.style.height = '';
            s.style.overflow = '';
            s.style.position = '';
            s.style.boxSizing = '';
        });

        const cloneBody = clone.querySelector('body');
        if (cloneBody) {
            cloneBody.style.transform = '';
            cloneBody.style.display = '';
            cloneBody.style.flexDirection = '';
            cloneBody.style.transition = '';
            cloneBody.style.width = '';
            cloneBody.style.margin = '';
            cloneBody.style.padding = '';
            cloneBody.style.overflow = '';
        }

        if (slides.length > 0) {
            const wrapper = slides[0].parentElement;
            if (wrapper && wrapper !== cloneBody) {
                wrapper.style.transform = '';
                wrapper.style.display = '';
                wrapper.style.flexDirection = '';
                wrapper.style.transition = '';
                wrapper.style.width = '';
                wrapper.style.margin = '';
                wrapper.style.padding = '';
            }
        }

    }

    /** Creates the clean HTML snapshot consumed by either export endpoint. */
    function createHtml(iframe) {
        const iframeWin = iframe.contentWindow;
        const iframeDoc = iframe.contentDocument || iframeWin.document;

        if (iframeWin.editorDeselect) iframeWin.editorDeselect();
        if (iframeWin.freezeAllSlides) iframeWin.freezeAllSlides();

        const snapshots = snapshotTextMeasurements(iframeDoc);
        const clone = iframeDoc.documentElement.cloneNode(true);
        restoreTextMeasurements(snapshots);
        removeTransientUi(clone);
        resetCarouselStyles(clone);

        return '<!DOCTYPE html>' + clone.outerHTML;
    }

    global.AedosExportSnapshot = Object.freeze({ createHtml });
})(window);
