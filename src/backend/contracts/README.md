# Backend contracts

This folder contains limits, defaults, errors, SSE, JSDoc types, normalizers,
and pure topic sanitization describing existing contracts. HTTP routes consume
`errors.js` builders; the pipeline and error route consume `formatSseEvent`;
`request-normalizers.js` exposes individual normalizers consumed by
`/generate`. `types.js` is JSDoc-only material with no runtime consumer.
Each file should have a small responsibility and must not start services or
read `req`/`res` except at its integration point.

When adding a constant, preserve its current value, document its source in
a comment, and add an equivalence test. Before replacing an error literal
in `server.js`, record its code, status, body/event, and consumer. Types
must reflect fixtures and observed behavior, including optional or ambiguous fields.
