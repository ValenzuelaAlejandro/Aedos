// Loaded as an external script into the streaming skeleton iframe.
// Observes the live DOM to count slides and send progress messages to the
// parent window while the AI-generated HTML is being streamed in.
(function () {
    let skelLastCount = 0;
    let sentTitle = false;
    const skelObs = new MutationObserver(() => {
        if (!sentTitle) {
            const h1 = document.querySelector('h1');
            if (h1 && h1.innerText.trim().length > 3) {
                sentTitle = true;
                window.parent.postMessage({ type: 'titleUpdate', title: h1.innerHTML.trim() }, '*');
            } else {
                const titleTag = document.querySelector('title');
                if (titleTag && titleTag.innerText.trim() && titleTag.innerText.trim() !== 'Document') {
                    sentTitle = true;
                    window.parent.postMessage({ type: 'titleUpdate', title: titleTag.innerHTML.trim() }, '*');
                }
            }
        }
        let slides = document.querySelectorAll('section.s');
        if (slides.length === 0) slides = document.querySelectorAll('section[class*="slide"]');
        if (slides.length === 0) slides = document.querySelectorAll('body > section');
        if (slides.length > 0) {
            const tempSkel = document.getElementById('temp-skeleton');
            if (tempSkel) tempSkel.remove();
        }
        if (slides.length > 0 && slides.length > skelLastCount) {
            skelLastCount = slides.length;
            window.parent.postMessage({ type: 'slideUpdate', count: skelLastCount }, '*');
            // Use CSS transform instead of scrollIntoView to navigate to the
            // latest slide. Safari iOS cannot properly paint overflow-scrolled
            // content inside a CSS-transformed (scaled) iframe, causing slides
            // to appear grey/blank. Transform-based navigation avoids this by
            // keeping overflow:hidden and using GPU-composited positioning.
            setTimeout(() => {
                const targetSlide = slides[slides.length - 1];
                if (targetSlide && document.body) {
                    const offset = -targetSlide.offsetLeft;
                    document.body.style.transition = 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)';
                    document.body.style.transform = 'translateX(' + offset + 'px)';
                }
            }, 100);
        }
    });
    skelObs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();
