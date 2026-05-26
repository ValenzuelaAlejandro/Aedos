module.exports.buildAddSlidePrompt = function(topic, existingSlides) {
  return `You are a presentation outline assistant. 
The user is building a presentation about: "${topic}".
Here are the current slides:
${JSON.stringify(existingSlides, null, 2)}

Please suggest ONE new slide that logically fits into this flow or adds a new perspective.
Respond ONLY with a JSON object representing the new slide.
Do NOT use markdown code blocks.

JSON format:
{
  "role": "concept",
  "title": "Short catchy title",
  "subtitle": "A brief description or core message",
  "key_points": ["Point 1", "Point 2", "Point 3"]
}
Allowed roles: cover, problem, concept, data, comparison, process, example, error_list, quote, timeline, internals, conclusion.
`;
}

module.exports.buildAddPointPrompt = function(topic, slideTitle, slideSubtitle, existingPoints) {
  return `You are a presentation outline assistant.
The user is building a slide titled "${slideTitle}" (Subtitle: "${slideSubtitle || ''}") for a presentation about "${topic}".
Here are the current bullet points on this slide:
${JSON.stringify(existingPoints, null, 2)}

Please suggest ONE new, distinct bullet point that adds valuable information to this slide without repeating existing points.
Respond ONLY with a JSON object containing the new point.
Do NOT use markdown code blocks.

JSON format:
{
  "point": "The suggested bullet point text"
}
`;
}
