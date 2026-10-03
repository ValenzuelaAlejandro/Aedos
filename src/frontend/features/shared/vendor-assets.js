/* global module */

/** @typedef {{ url: string, integrity: string }} IntegrityAsset */

/**
 * CDN references are pinned here for both the browser shell and generated slides.
 * Writing parser-blocking tags preserves their former position and execution order.
 *
 * @type {{
 *   lucide: IntegrityAsset,
 *   gsap: IntegrityAsset,
 *   motion: IntegrityAsset,
 *   mobileDragDropCss: IntegrityAsset,
 *   mobileDragDrop: IntegrityAsset,
 *   mobileDragDropScroll: IntegrityAsset
 * }}
 */
const vendorAssets = Object.freeze({
    lucide: Object.freeze({
        url: 'https://unpkg.com/lucide@0.577.0/dist/umd/lucide.min.js',
        integrity: 'sha384-orgVf2eX2+m1zKAOIi09hD0W6GtVhoOUmqDK+sysYB2JTZ4vS86j4jm+X7a4Nnei'
    }),
    gsap: Object.freeze({
        url: 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js',
        integrity: 'sha384-g4NTh/Iv5PPU4xPyhEWqPcwtNXOvdaDI8LLnyYfyNZOjKJeYQyjzQ9X5275eBjpt'
    }),
    motion: Object.freeze({
        url: 'https://unpkg.com/motion@12.38.0/dist/motion.js',
        integrity: 'sha384-z/A62QBp9kVAnDsIVQzfHAIc5wtCDLpDhwGipn7scpCbJqEOLtoAAJOaUcjCHT9C'
    }),
    mobileDragDropCss: Object.freeze({
        url: 'https://unpkg.com/mobile-drag-drop@2.3.0-rc.2/default.css',
        integrity: 'sha384-Srk3zP8STu1+RFyFIr7rKzR0vJnlq8GYSis1oDYTAROmcW3lszSanzF9h/N5OIAZ'
    }),
    mobileDragDrop: Object.freeze({
        url: 'https://unpkg.com/mobile-drag-drop@2.3.0-rc.2/index.min.js',
        integrity: 'sha384-mnsnaLTN3WEA86glMYYaTgkNJQWvG0devy3NWP2FdPyJCge1wvNuJF10+iBqRdG7'
    }),
    mobileDragDropScroll: Object.freeze({
        url: 'https://unpkg.com/mobile-drag-drop@2.3.0-rc.2/scroll-behaviour.min.js',
        integrity: 'sha384-G2ifo/oN1VpqHnxvAswZbT2INUNr+MXWfs6rYx6oGmrEGIJBnH/Fv7/aFkcawWWA'
    })
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = vendorAssets;
}

if (typeof document !== 'undefined' && document.currentScript) {
    const { lucide, gsap, motion, mobileDragDropCss, mobileDragDrop, mobileDragDropScroll } = vendorAssets;
    document.write([
        `<script src="${lucide.url}" integrity="${lucide.integrity}" crossorigin="anonymous"></script>`,
        `<script src="${gsap.url}" integrity="${gsap.integrity}" crossorigin="anonymous"></script>`,
        `<script src="${motion.url}" integrity="${motion.integrity}" crossorigin="anonymous"></script>`,
        `<link rel="stylesheet" href="${mobileDragDropCss.url}" integrity="${mobileDragDropCss.integrity}" crossorigin="anonymous" />`,
        `<script src="${mobileDragDrop.url}" integrity="${mobileDragDrop.integrity}" crossorigin="anonymous"></script>`,
        `<script src="${mobileDragDropScroll.url}" integrity="${mobileDragDropScroll.integrity}" crossorigin="anonymous"></script>`
    ].join('\n'));
}
