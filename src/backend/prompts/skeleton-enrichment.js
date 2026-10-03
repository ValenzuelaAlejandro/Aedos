/** @typedef {Record<string, any>} Stage2Skeleton */

/**
 * Enriches a user-edited skeleton with the fields that Stage 2 expects from Stage 1.
 * The outline editor only stores: role, title, subtitle, key_points, bg_color.
 * Stage 2 also needs visual_world, narrative_structure, tone, audience, text_density,
 * slide_count, plus per-slide core_message, weight, tension, connects_to.
 * We derive sensible defaults here so Stage 2 always gets a complete contentJson.
 *
 * @param {Stage2Skeleton | null | undefined} skeleton - The skeleton as edited by the user
 * @param {string} rawInput - The original user prompt (used to derive visual_world)
 * @returns {Stage2Skeleton | null | undefined} Enriched contentJson ready for Stage 2
 */
// eslint-disable-next-line complexity -- preserve the existing Stage 2 compatibility mapping
function enrichSkeletonForStage2(skeleton, rawInput) {
  if (!skeleton || typeof skeleton !== 'object') return skeleton;

  const slides = Array.isArray(skeleton.slides) ? skeleton.slides : [];

  const densityMap = { low: 'low', medium: 'medium', high: 'high' };

  const enriched = {
    language:            skeleton.language            || 'auto',
    topic:               skeleton.topic               || rawInput,
    audience:            skeleton.audience            || 'general',
    tone:                skeleton.tone                || 'corporate',
    text_density:        densityMap[skeleton.density] || densityMap[skeleton.text_density] || 'medium',
    narrative_structure: skeleton.narrative_structure || 'explanatory',
    slide_count:         slides.length,
    author:              skeleton.author              || null,
    team:                skeleton.team                || null,
    teacher:             skeleton.teacher             || null,
    subject:             skeleton.subject             || null,
    institution:         skeleton.institution         || null,
    date:                skeleton.date                || null,
    cta:                 skeleton.cta                 || null,
    visual_world: skeleton.visual_world || {
      real_world_analog: `(Derive from topic: ${rawInput})`,
      color_temperature: 'neutral',
      texture_feel:      'digital',
      typography_energy: 'neutral',
      reference_era:     'contemporary'
    },
    slides: slides.map((slide, idx) => ({
      index:         idx + 1,
      role:          slide.role          || 'concept',
      title:         slide.title         || '',
      subtitle:      slide.subtitle      || null,
      core_message:  slide.core_message  || slide.title || '',
      key_points:    Array.isArray(slide.key_points) ? slide.key_points.filter(Boolean) : [],
      data_points:   Array.isArray(slide.data_points) ? slide.data_points : null,
      tension:       slide.tension       || null,
      weight:        slide.weight        || (idx === 0 ? 'anchor' : idx === slides.length - 1 ? 'anchor' : 'supporting'),
      connects_to:   slide.connects_to   || null,
    }))
  };

  return enriched;
}

module.exports = enrichSkeletonForStage2;
