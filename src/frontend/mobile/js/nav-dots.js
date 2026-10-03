/**
 * Mirror the desktop slide dots into the mobile bottom navigation.
 * This module keeps the existing DOM contract and slide navigation fallbacks.
 *
 * @typedef {object} AedosMobileNavDotsOptions
 * @property {Document} document
 * @property {Window & {getTotalSlides?: () => number, getCurrentSlide?: () => number, scrollToSlide?: (index: number) => void}} window
 * @property {typeof MutationObserver} MutationObserver
 * @property {(callback: () => void, delay: number) => unknown} setInterval
 *
 * @typedef {object} AedosMobileNavDotsApi
 * @property {() => void} init
 */

/**
 * @param {Element[]} source
 * @param {Document} document
 * @param {AedosMobileNavDotsOptions['window']} window
 * @returns {{total: number, current: number}}
 */
function resolveMobileSlideMeta(source, document, window) {
    const apiTotal = (typeof window.getTotalSlides === 'function') ? Number(window.getTotalSlides()) : 0;
    const apiCurrent = (typeof window.getCurrentSlide === 'function') ? Number(window.getCurrentSlide()) : 0;

    let total = Math.max(source.length, Number.isFinite(apiTotal) ? apiTotal : 0);
    let current = Number.isFinite(apiCurrent) ? apiCurrent : -1;

    if (current < 0) {
        current = Array.from(source).findIndex((dot) => dot.classList.contains('active'));
    }

    try {
        const iframe = document.getElementById('preview-iframe');
        const iframeDoc = iframe && iframe.contentDocument;
        if (iframeDoc) {
            const slides = getMobileIframeSlides(iframeDoc);

            if (slides.length > total) total = slides.length;
            if (current < 0) {
                const activeFromIframe = slides.findIndex((slide) => slide.classList.contains('active'));
                if (activeFromIframe >= 0) current = activeFromIframe;
            }
        }
    } catch (_) {
        // If iframe metadata is inaccessible, keep the API and dot fallback values.
    }

    if (total <= 0) total = 1;
    if (current < 0) current = 0;
    current = Math.max(0, Math.min(total - 1, current));

    return { total, current };
}

/**
 * @param {Document} iframeDoc
 * @returns {Element[]}
 */
function getMobileIframeSlides(iframeDoc) {
    let slides = Array.from(iframeDoc.querySelectorAll('section.s'));
    if (!slides.length) slides = Array.from(iframeDoc.querySelectorAll('section[class*="slide"]'));
    if (!slides.length) slides = Array.from(iframeDoc.querySelectorAll('body > section'));
    return slides;
}

/**
 * @param {Element|null} sourceDots
 * @param {Element} mobileDots
 * @param {Element|null} mobileLabel
 * @param {Document} document
 * @param {AedosMobileNavDotsOptions['window']} window
 */
function syncMobileNavDots(sourceDots, mobileDots, mobileLabel, document, window) {
    const source = sourceDots ? sourceDots.querySelectorAll('.slide-dot') : [];
    const meta = resolveMobileSlideMeta(source, document, window);
    const { total, current } = meta;

    if (mobileDots.children.length !== total) {
        mobileDots.innerHTML = '';
        for (let index = 0; index < total; index++) {
            const sourceDot = source[index];
            const dot = document.createElement('button');
            dot.className = 'slide-dot' + (index === current ? ' active' : '');
            dot.setAttribute('aria-label', `Slide ${index + 1}`);
            dot.addEventListener('click', () => {
                if (sourceDot && typeof sourceDot.click === 'function') {
                    sourceDot.click();
                    return;
                }
                if (typeof window.scrollToSlide === 'function') window.scrollToSlide(index);
            });
            mobileDots.appendChild(dot);
        }
    } else {
        for (let index = 0; index < total; index++) {
            mobileDots.children[index].classList.toggle('active', index === current);
        }
    }

    if (mobileLabel) mobileLabel.textContent = `${current + 1} / ${total}`;

    const activeDot = mobileDots.children[current];
    if (activeDot && mobileDots.parentElement) {
        const dotWidth = activeDot.offsetWidth + 5;
        const containerWidth = mobileDots.parentElement.offsetWidth;
        const ideal = current * dotWidth - containerWidth / 2 + dotWidth / 2;
        const max = Math.max(0, mobileDots.scrollWidth - containerWidth);
        mobileDots.style.transform = `translateX(-${Math.max(0, Math.min(max, ideal))}px)`;
    }
}

/**
 * @param {AedosMobileNavDotsOptions} options
 * @returns {AedosMobileNavDotsApi}
 */
function createAedosMobileNavDots({ document, window, MutationObserver, setInterval }) {
    function init() {
        const sourceDots = document.getElementById('slide-dots');
        const mobileDots = document.getElementById('mobile-slide-dots');
        const mobileLabel = document.getElementById('mobile-slide-label');
        if (!mobileDots) return;

        const syncDots = () => syncMobileNavDots(sourceDots, mobileDots, mobileLabel, document, window);
        if (sourceDots) {
            const observer = new MutationObserver(syncDots);
            observer.observe(sourceDots, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ['class'],
            });
        }

        document.addEventListener('slide-meta-updated', syncDots);
        window.addEventListener('resize', syncDots, { passive: true });
        setInterval(syncDots, 1200);
        syncDots();
    }

    return { init };
}

window.AedosMobileNavDots = Object.freeze({ create: createAedosMobileNavDots });
