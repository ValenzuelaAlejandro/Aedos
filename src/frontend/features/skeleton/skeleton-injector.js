// Loaded as an external script into the streaming skeleton iframe.
// Observes the live DOM to count slides and send progress messages to the
// parent window while the AI-generated HTML is being streamed in.
(function () {
    let skelLastCount = 0;
    let sentTitle = false;
    const skelObs = new MutationObserver(() => {
        if (!sentTitle) {
            const h1 = document.querySelector('h1');
            if (h1 && h1.textContent.trim().length > 3) {
                sentTitle = true;
                window.parent.postMessage({ type: 'titleUpdate', title: h1.textContent.trim() }, '*');
            } else {
                const titleTag = document.querySelector('title');
                if (titleTag && titleTag.textContent.trim() && titleTag.textContent.trim() !== 'Document') {
                    sentTitle = true;
                    window.parent.postMessage({ type: 'titleUpdate', title: titleTag.textContent.trim() }, '*');
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
            setTimeout(() => {
                if (slides[slides.length - 1]) {
                    slides[slides.length - 1].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
                }
            }, 100);
        }
    });
    skelObs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();
