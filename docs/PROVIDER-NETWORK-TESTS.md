# Provider tests at the network layer

Fakes in `tests/helpers/provider-fakes.js` intercept `global.fetch` and
`@google/genai` before loading `server.js`; they neither enable
`AEDOS_TEST_STUB_PROVIDERS` nor make external calls.

Coverage includes Gemini → OpenRouter fallback SSE events, Gemini midstream
failure, double failure, and acceptance timeout.

`QUEUE_FULL` is excluded: attempts to repeat it ten times showed the queued
request firing historical `req.close` after its body was read and being removed
immediately. Making this deterministic requires a production seam change,
which is outside this phase.
