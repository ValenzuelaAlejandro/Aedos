# Backend sanitization

`html.js` contains the generated-HTML sanitizer and exposes
`sanitizeGeneratedHtml`. The adversarial snapshots in
`tests/fixtures/sanitization/` freeze its intended filtering behavior. The
allowlist stays deliberately narrow: this change removes the reported embedded
elements, unsafe imports/URLs and dangerous CSS values while preserving the
Google Fonts import and `data:image/*` content used by the two full-size
Flash/Pro fixtures. Their sanitized outputs are hash-checked byte for byte.
