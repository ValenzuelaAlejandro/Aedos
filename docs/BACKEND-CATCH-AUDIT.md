# Silent catch audit

Audit of `src/backend/` during Phase 3a. No catch was changed; this table
describes information discarded at that point.

| File and line | Form | Hidden or discarded information |
| --- | --- | --- |
| `server.js:718, 772, 952, 980` | `catch (_) { /* skip malformed SSE frames */ }` | Unparseable provider SSE frames. |
| `server.js:836` | Empty catch | Failure to write SSE metadata when the socket no longer accepts data. |
| `server.js:1278` | `return false` | Failure to locate the Chrome executable. |
| `server.js:1308` | `return null` | Failure to inspect/extract Chrome. |
| `server.js:1339` | `return` | Chrome cache cleanup failure. |
| `server.js:1679, 1748` | Empty catch | SSE write/close failures after disconnection. |
| `server.js:1920, 2205, 2299, 2309` | Comments and continuation | Closed socket during generation or SSE forwarding. |
| `server.js:4300, 4310` | Comment | Response-close logging must never crash the process. |
| `logger.js:97` | Fallback `return` | Unserializable logging context value. |
| `pipeline.js:99, 113` | Fall-through | JSON repair/parsing attempts that must continue to the next method. |
| `request-normalizers.js:34` | Returns original value | Malformed JSON in a multipart field; preserves the existing quirk. |

Explicit `.catch(() => {})` callbacks in Puppeteer waits
(`server.js:2710, 2713, 2734, 4074, 4081, 4090, 4161`) absorb noncritical
network, font, icon, or screenshot timeouts. They were retained because changing
their observability or timing would affect PDF/PPTX.

## Location changes in Phase 3b

Logic moved without changing error absorption policies or messages.

| New file | Moved catches | Responsibility |
| --- | --- | --- |
| `src/backend/browser/manager.js` | Chrome discovery/extraction/installation and `puppeteer.launch` diagnostics | Puppeteer singleton recovery and lifecycle. |
| `src/backend/export/pdf.js` | Network, font, icon, layout-normalization, and `pdf-lib` metadata waits | PDF rendering and postprocessing. |
| `src/backend/export/pptx-finalize.js` | No added catches; HTTP capture remains in `server.js` | `finalize-pptx` validation, response, and TTL. |

Route handlers and HTTP error catches remained in `server.js` to preserve
observable order and response shape.

## Location changes in Phase 3c

Historical line references above describe Phase 3a and may become outdated
after module extraction. File plus responsibility is now the maintainable
reference.

| Area | Current location | Preserved policy |
| --- | --- | --- |
| Pipeline and streaming | `src/backend/pipeline/skeleton.js`, `outline-item.js`, `stream.js` | Repair/parsing and SSE forwarding preserve existing fall-throughs, retries, and silence. |
| Generation output | `src/backend/http/routes/generate-output.js`, `generate-errors.js`, `generate.js` | HTTP and SSE-write catches preserve status, payload, messages, and order. |
| Finalization and download | `src/backend/http/routes/finalize.js`, `download.js` | Error, TTL, and response-close policies remain. |
| Middleware | `src/backend/http/middleware/request-logging.js`, `cors.js`, `security-headers.js`, `canonical-redirect.js`, `static-files.js` | No new catches or observability changes. |

Phase 3c moved the whole PPTX renderer to `export/pptx-renderer.js`, along
with provider runtime, routes, and contracts. Catches and their policies were
preserved; `utils/pptx-export.js` was untouched. This audit records catch placement and policies at the time of extraction;
current validation and disconnect behavior is described in [contracts](CONTRACTS.md).
