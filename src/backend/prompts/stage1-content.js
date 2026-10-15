const { renderTemplate } = require('./render-template');
/**
 * STAGE 1 - Content Extractor
 *
 * Takes the raw user prompt and extracts structured content.
 * Outputs a JSON with topic, slides, audience, tone, narrative structure, etc.
 * This stage only cares about WHAT to say, never about HOW it looks.
 */
function buildStage1Prompt(rawInput, targetLanguage = 'auto', requestedSlides = 8) {
  const langInstruction = targetLanguage && targetLanguage !== 'auto'
    ? `exclusively in the ISO-639-1 language code '${targetLanguage}'`
    : `in the exact same language as the USER INPUT`;

  return renderTemplate(require('./templates/stage1-content-0.json'), [
langInstruction,
requestedSlides,
requestedSlides,
requestedSlides,
requestedSlides,
rawInput,
requestedSlides,
requestedSlides
]);
}

function buildStage1CompletionPrompt(rawInput, currentSlides, missingIndexes, targetLanguage = 'auto') {
  const indexes = [...new Set(missingIndexes)].filter(Number.isSafeInteger).sort((a, b) => a - b);
  const langInstruction = targetLanguage && targetLanguage !== 'auto'
    ? `exclusively in the ISO-639-1 language code '${targetLanguage}'`
    : 'in the exact same language as the USER INPUT';
  return `You are completing a presentation outline. Return ONLY a valid JSON object with a slides array containing exactly these missing slide indexes: ${indexes.join(', ')}. Do not return or rewrite any existing slide.\n\nUser topic: "${rawInput}"\nExisting slides (context only; do not duplicate):\n${JSON.stringify(currentSlides)}\n\nWrite all content ${langInstruction}. Keep indices exactly as requested. Each item must include index, role, title, subtitle, core_message, key_points, data_points, tension, weight, and connects_to. Return {"slides":[...]} with exactly ${indexes.length} items.`;
}

function buildStage1RevisionPrompt(rawInput, currentSkeleton, targetLanguage = 'auto', requestedSlides = currentSkeleton?.slides?.length || 8) {
  const langInstruction = targetLanguage && targetLanguage !== 'auto'
    ? `exclusively in the ISO-639-1 language code '${targetLanguage}'`
    : `in the exact same language as the USER INPUT`;

  return `You are a presentation content architect. You are helping the user REVISE and UPDATE their presentation outline.

Here is the CURRENT presentation outline in JSON format:
${JSON.stringify(currentSkeleton, null, 2)}

The user has given the following instruction to update this outline:
"${rawInput}"

CORE REVISION RULES:
1. INTENT DETECTION: If the user's instruction indicates agreement or a request to proceed/generate (e.g., "looks good", "perfect", "create the presentation"), you MUST return exactly {"action": "proceed"}. 
CRITICAL: If the user asks to proceed BUT adds a DESIGN or STYLE clarification (e.g., "ok, but use color blue", "looks good, make it minimalist"), STILL return exactly {"action": "proceed"}. Do NOT update the outline for design changes, because the design stage will receive their prompt directly.
HOWEVER, if the user asks for STRUCTURAL CONTENT changes (e.g., "add a slide about X", "change the title to Y", "remove the second point"), THEN you must NOT return {"action": "proceed"}. Instead, update the outline and return the full updated JSON.
2. Otherwise, update the outline JSON according to the user's instructions.
3. Keep the overall JSON structure exactly the same (including keys: topic, audience, tone, narrative_structure, slides, visual_world, etc.).
4. ONLY modify the parts of the outline that are affected by the user's instructions.
5. Ensure all slides have sequential "index" values starting at 1.
6. Unless the user explicitly asks to proceed, return exactly ${requestedSlides} slides. If the existing outline is shorter, add only the missing slides; if longer, return the first ${requestedSlides} in coherent order.
6. Update "suggested_chips" with exactly 2 short, actionable instructions (MAX 5 words) for the user to further modify or improve the presentation outline (e.g. "Add a conclusion slide", "Make tone more playful"). The suggestions MUST be strictly in the same language as the presentation content (${langInstruction}), and must NEVER contain emojis or punctuation.
7. All generated/updated content MUST be ${langInstruction}. Keep all JSON keys strictly in English.
9. OUTPUT: ONLY a valid JSON object matching the original structure or the proceed action. No markdown, no fences, no text outside the JSON.
`;
}

module.exports = {
  buildStage1Prompt,
  buildStage1CompletionPrompt,
  buildStage1RevisionPrompt
};

