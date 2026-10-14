# Current backend source inventory

Snapshot of the working tree on 2026-10-14. Counts are LF newline counts,
including comments and blank lines. This inventory lists implemented modules.
See [backend architecture](ARCHITECTURE-BACKEND.md) for responsibilities and
[contracts](CONTRACTS.md) for public interfaces.

| Source file | Lines |
| --- | ---: |
| `src/backend/browser/manager.js` | 220 |
| `src/backend/config/env.js` | 64 |
| `src/backend/config/environment.js` | 54 |
| `src/backend/config/model-catalog.js` | 142 |
| `src/backend/config/models.js` | 98 |
| `src/backend/config/provider-spend.js` | 54 |
| `src/backend/contracts/config-defaults.js` | 46 |
| `src/backend/contracts/errors.js` | 39 |
| `src/backend/contracts/limits.js` | 51 |
| `src/backend/contracts/request-normalizers.js` | 54 |
| `src/backend/contracts/sse.js` | 20 |
| `src/backend/contracts/topic-sanitizer.js` | 40 |
| `src/backend/contracts/types.js` | 95 |
| `src/backend/export/pdf.js` | 178 |
| `src/backend/export/pptx-finalize.js` | 46 |
| `src/backend/export/pptx-renderer.js` | 1258 |
| `src/backend/files/attachments.js` | 114 |
| `src/backend/files/directories.js` | 26 |
| `src/backend/files/upload.js` | 54 |
| `src/backend/http/middleware/canonical-redirect.js` | 21 |
| `src/backend/http/middleware/cors.js` | 60 |
| `src/backend/http/middleware/generation-credits.js` | 49 |
| `src/backend/http/middleware/model-request-validation.js` | 26 |
| `src/backend/http/middleware/request-logging.js` | 69 |
| `src/backend/http/middleware/security-headers.js` | 36 |
| `src/backend/http/middleware/static-files.js` | 25 |
| `src/backend/http/register-routes.js` | 79 |
| `src/backend/http/routes/credits.js` | 47 |
| `src/backend/http/routes/download.js` | 43 |
| `src/backend/http/routes/entry.js` | 73 |
| `src/backend/http/routes/finalize.js` | 116 |
| `src/backend/http/routes/generate-errors.js` | 65 |
| `src/backend/http/routes/generate-output.js` | 203 |
| `src/backend/http/routes/generate.js` | 333 |
| `src/backend/http/routes/generation-endpoints.js` | 20 |
| `src/backend/pipeline/outline-item.js` | 102 |
| `src/backend/pipeline/skeleton.js` | 225 |
| `src/backend/pipeline/stream.js` | 161 |
| `src/backend/prompts/base.js` | 529 |
| `src/backend/prompts/json-extraction.js` | 124 |
| `src/backend/prompts/pipeline.js` | 163 |
| `src/backend/prompts/skeleton-enrichment.js` | 61 |
| `src/backend/prompts/skeleton_prompts.js` | 35 |
| `src/backend/prompts/stage-runner.js` | 166 |
| `src/backend/prompts/stage1-content.js` | 141 |
| `src/backend/prompts/stage2-design.js` | 703 |
| `src/backend/prompts/stage3-compositor.js` | 726 |
| `src/backend/providers/common.js` | 22 |
| `src/backend/providers/fallback.js` | 153 |
| `src/backend/providers/gemini.js` | 182 |
| `src/backend/providers/model-selection.js` | 113 |
| `src/backend/providers/openrouter.js` | 207 |
| `src/backend/providers/runtime.js` | 83 |
| `src/backend/providers/telemetry.js` | 14 |
| `src/backend/queues/finalize.js` | 84 |
| `src/backend/queues/generation.js` | 166 |
| `src/backend/sanitization/html.js` | 48 |
| `src/backend/server.js` | 434 |
| `src/backend/utils/credits-ledger.js` | 248 |
| `src/backend/utils/export-warnings.js` | 38 |
| `src/backend/utils/logger.js` | 180 |
| `src/backend/utils/pptx-export.js` | 774 |
| `src/backend/utils/rate-limit-evaluators.js` | 209 |
| `src/backend/utils/rate-limiter.js` | 322 |
| `src/backend/utils/spend-guard.js` | 133 |
