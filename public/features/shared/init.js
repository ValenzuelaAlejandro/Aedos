// init.js — replaces all inline <script> blocks from index.html
// Must be loaded AFTER: mobile-drag-drop scripts, i18n.js, minimap.js

// 1. Prevent pinch-zoom viewport lock across reloads.
//    Non-passive so we can call preventDefault() on multi-touch moves.
document.addEventListener('touchmove', function (e) {
    if (e.touches && e.touches.length > 1) e.preventDefault();
}, { passive: false });

// 2. MobileDragDrop polyfill (library is synchronously loaded above in <head>)
MobileDragDrop.polyfill({
    dragImageTranslateOverride: MobileDragDrop.scrollBehaviourDragImageTranslateOverride
});

// 3. Safety fallback if i18n.js failed to load
if (!window.__eidos_t) {
    window.__eidos_t = (k, d) => d || k;
    window.currentLang = navigator.language.startsWith('es') ? 'es' : 'en';
}

// 4. Event delegation — replaces onclick attributes on starter-card buttons
//    and mobile navigation buttons. Deferred to DOMContentLoaded because
//    the HTML elements don't exist yet at head-parse time.
document.addEventListener('DOMContentLoaded', function () {
    // Starter-card buttons: single delegated listener on the parent track
    var track = document.getElementById('starter-track');
    if (track) {
        track.addEventListener('click', function (e) {
            var card = e.target.closest('[data-fill-key]');
            if (card && typeof window.fillInput === 'function') {
                window.fillInput(card.dataset.fillKey);
            }
        });
    }

    // Mobile navigation buttons
    var prevBtn = document.querySelector('.mobile-prev-btn');
    var nextBtn = document.querySelector('.mobile-next-btn');
    if (prevBtn) {
        prevBtn.addEventListener('click', function () {
            if (typeof window.eidosPrevSlide === 'function') window.eidosPrevSlide();
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', function () {
            if (typeof window.eidosNextSlide === 'function') window.eidosNextSlide();
        });
    }
});
