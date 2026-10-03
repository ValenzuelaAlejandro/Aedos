(function registerOutlineStreamParser(global) {
    'use strict';

    /** @typedef {{ title: string, key_points: string[] }} PartialOutlineSlide */
    /** @typedef {{ slides: PartialOutlineSlide[] }} PartialOutline */

    /**
     * Parses complete and currently typed slide fragments from streamed JSON.
     * @param {string} text
     * @returns {PartialOutline}
     */
    function parsePartialSkeleton(text) {
        const slides = [];
        // Split using lookahead to preserve the opening bracket of each slide object
        const slideSegments = text.split(/(?=\{\s*"(?:index|role|title)")/);

        for (let i = 1; i < slideSegments.length; i++) {
            const seg = slideSegments[i];

            let title = '';
            const titleMatch = seg.match(/"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
            const typingTitleMatch = seg.match(/"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)$/);
            if (titleMatch) {
                title = titleMatch[1];
            } else if (typingTitleMatch) {
                title = typingTitleMatch[1];
            }

            const keyPoints = [];
            const pointsSegmentMatch = seg.match(/"key_points"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
            if (pointsSegmentMatch) {
                const pointsText = pointsSegmentMatch[1];
                const pointMatches = pointsText.match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g) || [];
                pointMatches.forEach(m => {
                    keyPoints.push(m.slice(1, -1));
                });
                const typingPointMatch = pointsText.match(/,\s*"([^"\\]*(?:\\.[^"\\]*)*)$|^\s*"([^"\\]*(?:\\.[^"\\]*)*)$/);
                if (typingPointMatch) {
                    const typingStr = typingPointMatch[1] || typingPointMatch[2];
                    keyPoints.push(typingStr);
                }
            }

            slides.push({ title, key_points: keyPoints });
        }

        return { slides };
    }

    global.AedosOutlineParser = Object.freeze({ parsePartialSkeleton });
})(window);
