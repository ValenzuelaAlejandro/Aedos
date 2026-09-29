# Aedos contracts

This document records the public and browser-facing contracts observed during
the Phase 0 safety work. It is descriptive and does not replace the endpoint
implementation or the generated HTML model.

## HTTP endpoints

- `GET /health`: health check, expected HTTP 200.
- `GET /`: frontend entry point.
- `POST /generate-skeleton`: JSON or multipart outline generation, streamed as SSE.
- `POST /generate-outline-item`: JSON single-slide/single-point generation.
- `POST /generate`: JSON or multipart final HTML generation, streamed as SSE.
- `POST /finalize`: JSON `{ html, title? }`, returns `{ pdfUrl }`.
- `POST /finalize-pptx`: JSON `{ html, title? }`, returns `{ pptxUrl }`.
- `GET /download/:filename`: downloads a temporary generated file.
- `GET /__dev__/last-generated`: development-only generated HTML inspection.

## Generation inputs

Important fields are `tema`, `mode`, `slides`, `language`, legacy `idioma`,
`skeleton`, and optional `files`. Topics are limited to 600 characters;
uploads allow PDF, DOC/DOCX, PNG, JPG/JPEG and WEBP, with the implementation's
file-count and byte limits.

## SSE event shapes

Generation streams use `data: <JSON>\\n\\n`. Observed event keys include
`queued`, `reasoning`, `stage`, `chunk`, `metadata`, `heartbeat`, `done`,
`skeleton`, `html`, and `error`. Client code also interprets retry messages in
the form `ERROR|RETRY_AFTER=<seconds>`.

## DOM and globals

The static DOM is defined in `src/frontend/index.html`; JavaScript accesses it
with `getElementById` and CSS selectors. Run `npm run check:dom` to validate the
static ID references. Dynamically generated slide/iframe IDs are intentionally
not treated as static page IDs.

The frontend exposes a compatibility API on `window`, including outline state,
i18n functions, editor/tool/minimap initializers, thinking-panel API, and
outline actions. These names must remain stable until their consumers migrate.

## Script load order

Shared/i18n code loads before feature code; editor/tool/mobile bridges load
before `app.js` and `outline.js`. The order matters because the current frontend
uses classic scripts and `window` globals instead of ESM imports.

## Timers and watchdogs

The generation client uses SSE watchdog/keep-alive handling, animation timers,
debounced outline controls, preview transition timers, and export progress
timers. Their exact durations remain implementation details until characterized
tests capture them.

## Baseline verification

The current Phase 0 baseline is stored under `tests/baseline/`. Visual checks
use exact SHA-256 hashes when stable; responsive captures allow a maximum 15%
file-size drift and report that fallback explicitly. PPTX checks compare the
ZIP part list and normalized slide XML hashes without hashing the ZIP container
timestamps.
