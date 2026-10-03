# Prompt pipeline modules

- `pipeline.js` orchestrates the three stages and owns prompt assembly/order.
- `json-extraction.js` parses model JSON and repairs malformed escapes.
- `stage-runner.js` consumes a single model stream, applies the existing timeout
  and retry policy, and forwards tagged chunks.
- `skeleton-enrichment.js` maps the user-edited outline to the Stage 2 input
  shape.
- `base.js` contains the legacy prompt template and is intentionally retained
  as one file: changing or fragmenting its interpolated prompt text risks
  altering the exact provider payload.

These modules were extracted without changing prompt strings, stage order,
timeouts, retry counts, event payloads, or returned values. Keep prompt content
and runtime behavior covered by the existing contract/provider tests.
