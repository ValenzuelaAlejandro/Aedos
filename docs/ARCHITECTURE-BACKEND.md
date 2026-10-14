# Backend architecture

`src/backend/server.js` composes the Express application, environment,
providers, queues, browser manager, route dependencies, and process handlers.
It exports the application and test seams used by the contract suite.

## Responsibility map

| Path | Responsibility |
| --- | --- |
| `server.js` | Bootstrap, dependency composition, process lifecycle, and public facade |
| `contracts/` | Limits, defaults, errors, SSE, topic sanitization, request normalization, and JSDoc types |
| `config/` | Environment configuration, model catalog, and validation |
| `providers/` | Gemini/OpenRouter adapters, model selection, fallback, timeouts, and runtime composition |
| `queues/` | Generation/finalization concurrency, queue capacity, and disconnect cleanup |
| `pipeline/` | Skeleton, outline-item, and streaming generation |
| `http/middleware/` | CORS, request logging, security headers, canonical redirect, and static files |
| `http/register-routes.js`, `http/routes/` | Ordered route registration and HTTP handlers |
| `export/` | PDF rendering, PPTX finalization, and DOM-based editable PPTX rendering |
| `files/` | Uploads, attachments, directories, file content, and downloads |
| `browser/` | Puppeteer browser lifecycle and Chrome discovery/installation |
| `sanitization/` | Generated HTML sanitization and dependency injection |
| `prompts/` | Stage prompts, JSON extraction, skeleton enrichment, and pipeline orchestration |
| `utils/` | Logging, rate limits, spending/credit accounting, export warnings, and OOXML serialization |

## Generation request flow

1. Bootstrap resolves configuration, creates dependencies, registers
   middleware/routes, and initializes the browser manager.
2. Middleware applies CORS, request IDs/logging, security headers, production
   canonical redirects, and static-file serving in the registered order.
3. Generation routes normalize input and validate topic, model, slide limits,
   attachments, credits, and queue pressure before invoking generation.
4. Skeleton and outline-item handlers construct prompts and parse model output.
   Final generation runs the Flash path or the Pro content/design/HTML pipeline.
5. Provider adapters resolve explicit model selection or configured fallback.
   Streaming helpers forward content, reasoning, progress, and terminal SSE events.
6. Generated HTML passes through sanitization and output preparation before
   it reaches the client.
7. Finalizers render the submitted document to PDF or editable PPTX. Download
   handling retains file TTL, headers, status, and payload contracts.

## Contracts and lifecycle

Limits and response shapes live in `contracts/`; environment defaults live
in `config/env.js` and `contracts/config-defaults.js`.
Route factories receive dependencies explicitly.
`http/register-routes.js` preserves registration order.

The browser manager is initialized from the server bootstrap. Process handlers
close browser resources and report failures. Queued generation is cleaned up
when the response closes before completion; the listener is removed when a
request acquires or abandons its slot.

## Export

`export/pdf.js` manages PDF rendering and metadata.
`export/pptx-renderer.js` measures rendered DOM and builds slide data.
`utils/pptx-export.js` writes OOXML packages.
`export/pptx-finalize.js` validates requests and manages final file responses.
Structured warnings describe unsupported or approximated export features.

## Verification

Contract tests cover route order, exports, request normalizers, SSE, errors,
provider seams, model selection, credits, and queue disconnects.
Export tests cover text, layers, styles, shadows, appearance, and advanced
OOXML features. Sanitization tests use adversarial fixtures.
See [contracts](CONTRACTS.md), [the model catalog](MODEL-CATALOG.md), and
[the server inventory](SERVER-INVENTORY.md).
