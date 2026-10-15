const { renderTemplate } = require('./render-template');
/**
 * STAGE 2 - Creative Director
 *
 * Receives the content JSON from Stage 1 + the original user prompt.
 * Outputs concrete visual/compositional directions per slide.
 * Must be specific enough that a coder can build each slide without ambiguity.
 */
module.exports = function buildStage2Prompt(rawInput, contentJson) {

  return renderTemplate(require('./templates/stage2-design-0.json'), [
rawInput,
JSON.stringify(contentJson, null, 2),
`${contentJson.visual_world?.real_world_analog || '(derive from topic: ' + rawInput + ')'}`,
contentJson.visual_world?.texture_feel ?? '?',
contentJson.visual_world?.typography_energy ?? '?',
contentJson.visual_world?.reference_era ?? '?',
contentJson.slide_count
]);
};

