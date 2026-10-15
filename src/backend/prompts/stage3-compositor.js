const { renderTemplate } = require('./render-template');
/**
 * STAGE 3 -- HTML Compositor
 * 
 * Receives both JSONs (content + design) and generates final HTML/CSS.
 * Composes freely within hard technical constraints.
 * This is the streaming stage (SSE).
 */

module.exports = function buildStage3Prompt(rawInput, contentJson, designJson) {
  const p = designJson.palette || {};
  // Normalize palette input: accept array, comma/slash-separated string, or legacy keys
  let colors = [];
  if (Array.isArray(p.colors_hex) && p.colors_hex.length > 0) {
    colors = p.colors_hex.slice();
  } else if (typeof p.colors_hex === 'string' && p.colors_hex.trim()) {
    colors = p.colors_hex.split(/[,\/\s]+/).map(s => s.trim()).filter(Boolean);
  } else {
    if (p.accent_hex) colors.push(p.accent_hex);
    if (p.accent2_hex) colors.push(p.accent2_hex);
  }

  // sanitize and normalize hex strings
  colors = colors.map(c => {
    if (!c) return null;
    c = String(c).trim();
    if (!c.startsWith('#')) c = '#' + c;
    return c.toUpperCase();
  }).filter(Boolean);

  const accent1 = colors[0] || '#FFFFFF';
  const accent2 = colors[1] || accent1;

  function hexToRgb(hex) {
    const h = String(hex).replace('#', '');
    if (h.length === 3) {
      const r = parseInt(h[0] + h[0], 16);
      const g = parseInt(h[1] + h[1], 16);
      const b = parseInt(h[2] + h[2], 16);
      return `${r}, ${g}, ${b}`;
    }
    if (h.length === 6) {
      const r = parseInt(h.substring(0, 2), 16);
      const g = parseInt(h.substring(2, 4), 16);
      const b = parseInt(h.substring(4, 6), 16);
      return `${r}, ${g}, ${b}`;
    }
    return '255, 255, 255';
  }

  const accentVars = [
    `    --accent:${accent1}; --accent-dim:rgba(${hexToRgb(accent1)}, .15); --accent-light: rgba(${hexToRgb(accent1)}, .25);`,
    `    --accent-2:${accent2}; --accent-2-dim:rgba(${hexToRgb(accent2)}, .15); --accent-2-light: rgba(${hexToRgb(accent2)}, .25);`
  ].join('\n');

  return renderTemplate(require('./templates/stage3-compositor-0.json'), [
contentJson.language,
contentJson.language,
contentJson.language,
contentJson.language,
contentJson.language,
contentJson.language,
contentJson.slide_count,
contentJson.language,
JSON.stringify(contentJson, null, 2),
JSON.stringify(designJson, null, 2),
designJson.deck_signature,
designJson.mood_global,
designJson.palette?.color_rationale || '',
contentJson.language || 'en',
contentJson.language,
contentJson.language,
designJson.font_pair,
designJson.font_pair,
accentVars,
JSON.stringify({
  topic: contentJson.topic,
  language: contentJson.language,
  slide_count: contentJson.slide_count,
  tone: contentJson.tone,
  audience: contentJson.audience,
  colors_hex: colors,
  bg_hex: designJson.palette.bg_hex,
  bg_mode: designJson.palette.bg_mode,
  font_pair: designJson.font_pair,
  author: contentJson.author,
  teacher: contentJson.teacher,
  institution: contentJson.institution,
  subject: contentJson.subject
}, null, 2),
contentJson.language,
contentJson.slide_count,
contentJson.slide_count
]);
};

