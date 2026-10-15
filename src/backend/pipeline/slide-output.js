'use strict';

const SLIDE_OPEN = /<section\b[^>]*\bclass=(['"])[^'"]*\bs\b[^'"]*\1[^>]*>/gi;

function countSlides(html) {
    return [...String(html || '').matchAll(SLIDE_OPEN)].length;
}

// Keep only complete top-level slide sections. A failed attempt can end in the
// middle of a section; that fragment must never be merged into the accepted deck.
function extractCompleteSlides(html) {
    const source = String(html || '');
    const starts = [...source.matchAll(SLIDE_OPEN)];
    const result = [];
    for (let index = 0; index < starts.length; index += 1) {
        const start = starts[index].index;
        const endBeforeNext = index + 1 < starts.length ? starts[index + 1].index : source.length;
        const chunk = source.slice(start, endBeforeNext);
        const opens = (chunk.match(/<section\b/gi) || []).length;
        const closes = (chunk.match(/<\/section\s*>/gi) || []).length;
        if (closes >= opens) result.push(chunk.trim());
    }
    return result;
}

function countCompleteSlides(html) {
    return extractCompleteSlides(html).length;
}

function appendSlides(html, slides) {
    if (!slides.length) return String(html || '');
    const source = String(html || '');
    const bodyClose = source.lastIndexOf('</body>');
    const insertion = slides.join('\n');
    return bodyClose === -1
        ? `${source}\n${insertion}`
        : `${source.slice(0, bodyClose)}\n${insertion}\n${source.slice(bodyClose)}`;
}

function buildMissingSlidesPrompt({ topic, language, requestedSlides, firstMissingIndex, count, outline, acceptedHtml }) {
    const missing = Array.from({ length: count }, (_, offset) => firstMissingIndex + offset);
    const languageInstruction = language && language !== 'auto'
        ? `Write all visible slide text in ${language}.`
        : 'Write all visible slide text in the same language as the topic.';
    const context = JSON.stringify(missing.map(index => outline?.[index - 1] || { index }), null, 2);
    const style = String(acceptedHtml || '').match(/<style\b[^>]*>[\s\S]*?<\/style>/i)?.[0] || '';
    return `Complete only the missing slides in this presentation. Return a complete HTML document with the supplied CSS and exactly ${count} new <section class="s"> elements, corresponding in order to slide indexes ${missing.join(', ')}. Do not repeat, rewrite, or include any existing slide. Keep the same visual language and slide dimensions.\n\nTopic: ${topic}\nRequested total: exactly ${requestedSlides}\n${languageInstruction}\n\nContent for the missing slides:\n${context}\n\nReuse this exact style block without changes:\n${style}\n\nThe existing deck already contains ${firstMissingIndex - 1} complete slides. Return no commentary or markdown. The resulting document must contain exactly ${count} section.s elements.`;
}

module.exports = { countSlides, countCompleteSlides, extractCompleteSlides, appendSlides, buildMissingSlidesPrompt };
