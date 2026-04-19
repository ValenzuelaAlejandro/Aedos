// init.js — replaces all inline <script> blocks from index.html
// Must be loaded AFTER: mobile-drag-drop scripts, i18n.js, minimap.js

// 1. Prevent pinch-zoom viewport lock across reloads.
//    viewport meta already sets user-scalable=no; this listener is only needed
//    as a belt-and-suspenders for older browsers that ignore the meta.
//    Use passive:true so the browser can still fast-path scroll/touch handling.
document.addEventListener('touchmove', function (e) {
    if (e.touches && e.touches.length > 1 && e.cancelable) e.preventDefault();
}, { passive: false });

// 2. MobileDragDrop polyfill (library is synchronously loaded above in <head>)
MobileDragDrop.polyfill({
    dragImageTranslateOverride: MobileDragDrop.scrollBehaviourDragImageTranslateOverride
});

// 3. Safety fallback if i18n.js failed to load
if (!window.__t) {
    window.__t = (k, d) => d || k;
    window.currentLang = navigator.language.startsWith('es') ? 'es' : 'en';
}

// 4. Event delegation — replaces onclick attributes on mobile navigation buttons.
//    Deferred to DOMContentLoaded because the HTML elements don't exist yet 
//    at head-parse time.
document.addEventListener('DOMContentLoaded', function () {
    // Mobile navigation buttons
    var prevBtn = document.querySelector('.mobile-prev-btn');
    var nextBtn = document.querySelector('.mobile-next-btn');
    if (prevBtn) {
        prevBtn.addEventListener('click', function () {
            if (typeof window.prevSlide === 'function') window.prevSlide();
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', function () {
            if (typeof window.nextSlide === 'function') window.nextSlide();
        });
    }
});
