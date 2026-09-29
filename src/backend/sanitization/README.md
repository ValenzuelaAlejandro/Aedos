# Backend sanitization

`html.js` contains the current generated-HTML sanitizer and exposes
`sanitizeGeneratedHtml`. Its regular expressions are behavior-frozen by the
Phase 0b snapshots. Add a new rule only with a new equivalence fixture and
explicit approval.
