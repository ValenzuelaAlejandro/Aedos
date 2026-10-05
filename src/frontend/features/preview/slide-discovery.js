(function registerSlideDiscovery(global) {
    const api = global.AedosPreview || (global.AedosPreview = {});

    /** @typedef {{}} SlideDiscoveryDependencies */

    /** Create the legacy slide finder, retaining every selector fallback in order. */
    function createSlideDiscovery() {
        return function findSlides(doc) {
            if (!doc || !doc.body) return [];

            // Strategy 1: section.s (the expected format from our prompt)
            let slides = doc.querySelectorAll('section.s');
            if (slides.length >= 1) return Array.from(slides);

            // Strategy 2: sections with class containing "slide"
            slides = doc.querySelectorAll('section[class*="slide"]');
            if (slides.length >= 1) return Array.from(slides);

            // Strategy 3: leaf sections (sections that don't contain other sections)
            const allSections = Array.from(doc.querySelectorAll('section'));
            const leafSections = allSections.filter(s => !s.querySelector('section'));
            if (leafSections.length >= 1) return leafSections;
            if (allSections.length >= 1) return allSections;

            // Strategy 4: divs with slide-like classes
            const divSlides = doc.querySelectorAll('div.s, div.slide, div[class*="slide"]');
            if (divSlides.length >= 1) return Array.from(divSlides);

            // Strategy 5: direct body children (excluding script/style/link/meta AND editor UI)
            const bodyKids = Array.from(doc.body.children).filter(el => {
                const tag = el.tagName;
                const isTool = el.classList.contains('editor-selection-box') ||
                    el.classList.contains('editor-toolbar') ||
                    el.classList.contains('editor-guide') ||
                    el.classList.contains('editor-color-picker');
                return !['SCRIPT', 'STYLE', 'LINK', 'META'].includes(tag) && !isTool;
            });
            if (bodyKids.length >= 1) {
                // If there's only one kid and it contains slides, prefer its children (Strategy 6-like)
                if (bodyKids.length === 1) {
                    const inner = Array.from(bodyKids[0].children).filter(el =>
                        !['SCRIPT', 'STYLE', 'LINK'].includes(el.tagName)
                    );
                    if (inner.length >= 1) return inner;
                }
                return bodyKids;
            }

            return Array.from(slides); // fallback to whatever last matched
        };
    }

    api.createSlideDiscovery = createSlideDiscovery;
})(window);
