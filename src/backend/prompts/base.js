const { renderTemplate } = require('./render-template');
module.exports = function buildPrompt(opciones) {
  const rawInput = opciones.rawInput || opciones.tema;
  const skeletonStr = opciones.skeleton ? JSON.stringify(opciones.skeleton, null, 2) : null;
  const requestedSlides = Number.isSafeInteger(Number(opciones.slides))
    ? Number(opciones.slides) : 8;

  const seed = (Date.now() % 7) + 1; // 1-7, drift each call

  const langInstruction = opciones.targetLanguage && opciones.targetLanguage !== 'auto'
    ? `exclusively in the ISO-639-1 language code '${opciones.targetLanguage}'`
    : `in the exact same language as the USER INPUT`;

  return renderTemplate(require('./templates/base-0.json'), [
requestedSlides,
requestedSlides,
langInstruction,
rawInput,
skeletonStr ? `PHASE 1 - DESIGN CONFIG (PROVIDED)
The user has already defined the exact presentation structure and content.
YOU MUST USE THE FOLLOWING JSON EXACTLY AS THE <!-- CONFIG BLOCK.
DO NOT CHANGE TITLES, TEXT, OR SLIDE COUNT. Just use this block.

<!-- CONFIG
${skeletonStr}
-->
` : renderTemplate(require('./templates/base-nested-0.json'), [requestedSlides, seed]),
skeletonStr ? `- STRICTLY use the provided CONFIG JSON for content (slides, titles, text).
- DO NOT change titles, text, or slide count.
- CRITICAL: You MUST update the "palette", "font_pair", or "visual_world" inside the CONFIG JSON if the USER INPUT explicitly requests a design, color, or style change (e.g., "use color blue").` : `- Derive visual world from a concrete artifact, then derive color and typography from that artifact.
- Apply user-requested colors directly when present in input.
- Keep slide_count exact.
- Extract metadata fields author, team, teacher, subject, institution, date, and cta only from explicit literals in USER INPUT.
- Keep metadata fields as null when USER INPUT does not provide that value.`
]);
};
