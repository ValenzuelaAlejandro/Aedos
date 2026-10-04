(function registerOverlayStyle(global) {
    'use strict';

    /**
     * Insert the existing image-slot stylesheet at the original preview setup point.
     * @param {{doc: Document}} deps
     */
    // eslint-disable-next-line max-lines-per-function -- The stylesheet remains one atomic preview insertion.
    function createOverlayStyle({ doc }) {
        const style = doc.createElement('style');
        style.className = 'preview-injected-style';
        style.textContent = `
            html {
                overflow: hidden !important;
                margin: 0; padding: 0;
                width: 100%; height: 100%;
            }
            body {
                margin: 0; padding: 0;
                width: 100%; height: 100%;
                overflow: hidden !important;
            }
            /* Fix #3: prevent long text from breaking slide layout */
            section.s {
                position: relative !important;
                overflow: hidden;
            }
            section.s h1, section.s h2, section.s h3, section.s h4,
            section.s p, section.s span, section.s li, section.s blockquote {
                word-break: break-word;
                overflow-wrap: break-word;
                max-width: 100%;
                /* Removed overflow:hidden to prevent clipping of large fonts */
            }
            [data-image-slot] {
                cursor: pointer;
                transition: outline 0.2s ease;
            }
            [data-image-slot]::after {
                content: '';
                position: absolute;
                inset: 0;
                z-index: 5;
                background: linear-gradient(
                    115deg,
                    transparent 30%,
                    rgba(255, 255, 255, 0.08) 45%,
                    rgba(255, 255, 255, 0.15) 50%,
                    rgba(255, 255, 255, 0.08) 55%,
                    transparent 70%
                );
                background-size: 250% 100%;
                animation: slotGleam 20s ease-in-out infinite;
                pointer-events: none;
                border-radius: inherit;
            }
            [data-image-slot].has-custom-image::after {
                display: none;
            }
            @keyframes slotGleam {
                0%, 100% { background-position: 200% 0; }
                50% { background-position: -200% 0; }
            }
            [data-image-slot]:hover,
            [data-image-slot].is-hovered {
                outline: 2px dashed rgba(255,255,255,0.3);
                outline-offset: -2px;
            }
            .img-replace-overlay {
                position: absolute;
                inset: 0;
                z-index: 20;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 8px;
                background: rgba(0,0,0,0.3);
                opacity: 0.7;
                transition: all 0.25s ease;
                pointer-events: none;
                padding: 1rem;
                text-align: center;
            }
            /* Hide the large overlay when image is present, show only on hover then? */
            /* Or maybe just hide it completely if image is set, since we have the topbar replace btn */
            [data-image-slot].has-custom-image .img-replace-overlay {
                display: none !important;
            }

            [data-image-slot]:hover .img-replace-overlay,
            [data-image-slot].is-hovered .img-replace-overlay {
                opacity: 1;
                background: rgba(0,0,0,0.5);
            }
            .img-replace-overlay svg {
                width: 24px; height: 24px;
                stroke: white; fill: none; stroke-width: 1.5;
                opacity: 0.8;
            }
            .img-replace-overlay span {
                color: white; font-size: 13px;
                font-family: 'DM Sans', sans-serif;
                font-weight: 500;
                max-width: 140px;
                line-height: 1.3;
                text-shadow: 0 2px 4px rgba(0,0,0,0.3);
            }
            [data-image-slot].drag-over {
                outline: 3px solid var(--presentation-accent, #6366f1) !important;
                outline-offset: -3px;
            }
            body.editor-locked .img-replace-overlay {
                display: none !important;
            }
            body.editor-locked [data-image-slot]:hover,
            body.editor-locked [data-image-slot].is-hovered {
                outline: none !important;
            }
        `;
        doc.head.appendChild(style);
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createOverlayStyle = createOverlayStyle;
})(window);
