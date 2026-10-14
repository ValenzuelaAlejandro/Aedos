# Export

Responsibility: render and postprocess final formats without changing
handlers or HTTP contracts.

- `pdf.js`: Puppeteer PDF rendering, layout normalization, and `pdf-lib` metadata.
- `pptx-finalize.js`: `finalize-pptx` validation and response, including file TTL.
- `pptx-renderer.js`: the editable PPTX renderer moved intact from the facade;
  it retains the monolithic exception for timing and warnings.
- `utils/pptx-export.js` contains shared export primitives and was unchanged
  during that extraction.

The renderer retains lint suppression limited to the moved block's historical
rules. Splitting or rewriting it to satisfy `max-lines` would change capture,
rasterization, warning, and packaging order. It also retains `@ts-nocheck`
because the block evaluates DOM inside Puppeteer; checking it produced new
errors merely from changing the containing file.
