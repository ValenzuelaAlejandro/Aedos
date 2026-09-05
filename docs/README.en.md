# Aedos -- AI Presentation Generator

Aedos is a local/deployable web app that turns a topic or supporting files into an editable presentation and downloadable PDF. The current runtime uses the direct Gemini API as the primary provider, OpenRouter as fallback, and Puppeteer for final export.

Production site: [https://aedoslab.xyz](https://aedoslab.xyz)

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Stack](#stack)
- [Project Structure](#project-structure)
- [Backend](#backend)
- [Frontend](#frontend)
- [Generation Modes](#generation-modes)
- [Main Flows](#main-flows)
- [API](#api)
- [Security and Limits](#security-and-limits)
- [Deployment](#deployment)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)

---

## Overview

- AI-assisted generation with two paths: `flash` and `pro`.
- Outline-first flow through `POST /generate-skeleton`.
- Full client-side editing: text, images, shapes, icons, background, ordering, zoom, undo/redo.
- Attachment support for `.pdf`, `.doc`, `.docx`, `.png`, `.jpg`, `.jpeg`, `.webp`.
- PDF export in 16:9 via Puppeteer plus `pdf-lib` metadata post-processing.
- Static frontend on Vercel and Node.js/Express backend on Render.

---

## Architecture

```text
User (browser)
       |
       v
Static frontend (Vercel or Express static)
       |
       +--> POST /generate-skeleton
       +--> POST /generate-outline-item
       +--> POST /generate
       +--> POST /finalize
       +--> GET  /download/:filename
       |
       v
Node.js + Express backend
       |
       +--> Gemini API (primary)
       +--> OpenRouter (fallback by model/stage)
       +--> Upstash Redis (rate limiting, with in-memory fallback)
       +--> Puppeteer / Chrome Headless (HTML -> PDF)
```

Important notes:

- The backend can also serve the frontend through `express.static`.
- In production, raw Render hostnames are redirected to `aedoslab.xyz`, except API routes.
- Final HTML generation is streamed to the browser over SSE.
- Generated HTML is sanitized server-side before previewing or exporting.

---

## Stack

| Layer | Technology |
|------|------------|
| Frontend | HTML5, CSS3, vanilla JavaScript |
| Backend | Node.js, Express |
| Primary AI | Google Gemini API (`@google/genai`) |
| Fallback AI | OpenRouter |
| PDF | Puppeteer + `pdf-lib` |
| Word ingestion | `mammoth` |
| Rate limiting | Upstash Redis |
| UI/Animation | Lucide, GSAP, Motion |
| Hosting | Vercel + Render |

---

## Project Structure

```text
Aedos/
+-- docs/
|   +-- README.es.md
|   +-- README.en.md
+-- scripts/
|   +-- install-chrome.sh
+-- src/
|   +-- backend/
|   |   +-- server.js
|   |   +-- prompts/
|   |   |   +-- base.js
|   |   |   +-- pipeline.js
|   |   |   +-- skeleton_prompts.js
|   |   |   +-- stage1-content.js
|   |   |   +-- stage2-design.js
|   |   |   +-- stage3-compositor.js
|   |   +-- utils/
|   |       +-- logger.js
|   |       +-- rate-limiter.js
|   +-- frontend/
|       +-- index.html
|       +-- assets/images/
|       +-- editor/
|       +-- features/
|       |   +-- minimap/
|       |   +-- shared/
|       |   +-- skeleton/
|       |   +-- tools/
|       +-- mobile/
|       +-- scripts/
|       +-- styles/
|       +-- vercel.json
+-- package.json
```

---

## Backend

### Main server

`src/backend/server.js` owns:

- `dotenv`, Express, CORS, and security-header setup.
- Per-mode rate limiting for `/generate` and window-based limits for `/finalize`.
- Separate queues for AI generation and PDF rendering.
- Provider resolution: direct Gemini first, then OpenRouter.
- File handling with `multer` plus Word text extraction through `mammoth`.
- SSE streaming of generation output and pipeline states.
- Sanitization and normalization of generated HTML.
- Chrome bootstrap/self-healing for Puppeteer.

### Model routing

Current routing works like this:

- `Gemini` is the primary provider when `GEMINI_API_KEY` exists.
- `OpenRouter` is an automatic fallback when Gemini fails or is unavailable.
- Flash, Stage 1, Stage 2, and Stage 3 may each use different model lists.
- Some OpenRouter models can be marked as Stage-3-only through `OPENROUTER_MODELS_STAGE3_ONLY`.

### Generation paths

#### Flash mode

- Uses `src/backend/prompts/base.js`.
- Generates the full HTML in a single request.
- Supports up to `15` slides.
- Fastest and cheapest path.

#### Pro mode

- Uses `src/backend/prompts/pipeline.js`.
- Splits the process into 3 stages:
  1. `stage1-content.js`: outline, narrative, language, and structure.
  2. `stage2-design.js`: visual direction, palette, and typography.
  3. `stage3-compositor.js`: final HTML/CSS.
- Supports up to `8` slides.
- Stage 3 is streamed via SSE.

### Outline-assisted flow

In addition to final deck generation, the backend exposes two intermediate routes:

- `POST /generate-skeleton`: creates or revises the whole outline.
- `POST /generate-outline-item`: generates a single slide or bullet item for the outline.

This allows the frontend to show an editable outline stage before final composition.

### Attachments

Allowed file types:

- PDF
- DOC/DOCX
- PNG/JPG/JPEG/WEBP

Current rules:

- Up to `3` files per request.
- Up to `10 MB` per file.
- `DOC/DOCX` files are converted to plain text.
- PDFs and images are passed to providers as `data:` URLs or `inlineData`, depending on provider support.
- In the UI, attached files force the `pro` path.

### Queues and backpressure

Default values:

| Variable | Default |
|----------|---------|
| `MAX_CONCURRENT_GENERATIONS` | `10` |
| `MAX_QUEUE_DEPTH` | `40` |
| `PRO_PAUSE_ACTIVE_GENERATIONS` | `MAX_CONCURRENT_GENERATIONS - 2` |
| `PRO_PAUSE_QUEUE_DEPTH` | `60%` of `MAX_QUEUE_DEPTH`, minimum `8` |
| `PUPPETEER_MAX_CONCURRENT` | `3` |
| `PUPPETEER_MAX_QUEUE` | `10` |
| `PRESSURE_RETRY_AFTER_SEC` | `30` |

Key behaviors:

- If the general queue fills up, `/generate` returns `429 QUEUE_FULL`.
- Under pressure, `pro` can be temporarily paused with `503 PRO_TEMPORARILY_PAUSED`.
- If the PDF queue fills up, `/finalize` returns `429 QUEUE_FULL`.

### HTML sanitization and post-processing

Before returning or exporting a presentation, the server:

- strips `<script>` tags and inline handlers;
- removes dangerous `javascript:` URLs;
- removes duplicate Google Fonts `link`/`@import` entries;
- injects the supported font bundle and Lucide assets;
- trims slides beyond the mode cap;
- fixes common incomplete HTML/CSS output issues;
- removes `overflow: auto/scroll` patterns that break PDF output;
- stores debug artifacts in development.

### Logger

`src/backend/utils/logger.js` defines structured levels and semantic categories such as:

- `BOOT`, `CONFIG`, `HTTP`, `SECURITY`, `VALIDATION`
- `QUEUE`, `PROVIDER`, `QUOTA`, `PIPELINE`, `STREAM`
- `SANITIZER`, `PUPPETEER`, `FILESYSTEM`, `NETWORK`, `DOWNLOAD`

---

## Frontend

### Main screens

The frontend (`src/frontend/`) is a SPA with four functional areas:

1. Initial chat.
2. Outline editor.
3. Slide preview/editor.
4. Final download screen.

### Chat and input capture

The initial screen includes:

- textarea capped at `600` characters;
- `flash` / `pro` mode selector;
- output language selector;
- suggestion chips;
- file upload by button or drag-and-drop;
- error and refusal modals.

### Outline editor

The current flow does not jump straight into final generation. It first builds an editable outline with:

- AI-generated sections;
- suggested follow-up chips;
- manual or AI-assisted insertion of sections/points;
- language-selector locking during generation;
- a button to turn the approved outline into the final deck.

### Slide editor

The editor supports:

- direct text editing;
- adding/deleting/duplicating slides;
- inserting text, images, shapes, and icons;
- changing background, layering, opacity, borders, and typography;
- `undo/redo`;
- minimap navigation;
- presentation mode;
- PDF export.

### Minimap and tools panel

- `features/minimap/` handles thumbnails, navigation, and reorder.
- `features/tools/` acts as the contextual inspector.
- `editor/` manages selection, transforms, and editing inside the iframe.

### Mobile support

`src/frontend/mobile/` adds:

- bottom navigation;
- touch-event bridging;
- responsive overrides;
- drag-and-drop polyfill support for touch devices.

### Languages

The interface itself is only localized in:

- `en` by default;
- `es` when `navigator.language` starts with `es`.

Content generation supports broader ISO language codes. In the frontend there is a wider selector, but at API level there are two paths:

- `language`: current parameter used by the UI, intended for arbitrary ISO codes.
- `idioma`: legacy parameter with strict `/generate` validation for `es`, `en`, `fr`, `pt`, `de`.

---

## Generation Modes

| Feature | Flash | Pro |
|---------|-------|-----|
| Flow | Single prompt | 3-stage pipeline |
| Speed | Higher | Lower |
| Slide cap | 15 | 8 |
| Visual consistency | Good | More guided/consistent |
| Best use case | fast drafts | polished deliverables and complex prompts |
| Attachments | not ideal | recommended / enforced by UI |

---

## Main Flows

### Outline + generation

```text
1. User writes a topic and can attach files
2. Frontend sends /generate-skeleton
3. Backend validates input and generates outline JSON
4. User reviews/edits the outline
5. Frontend sends /generate
6. Backend runs Flash or the Pro pipeline
7. HTML arrives through SSE
8. Frontend renders it in the iframe and enables manual editing
```

### PDF export

```text
1. User clicks "Download PDF"
2. Frontend sends /finalize with html and title
3. Backend opens a Puppeteer page
4. It waits for network/fonts/icons and normalizes layout
5. It generates a 29.7cm x 16.7cm PDF
6. It injects metadata with pdf-lib
7. It responds with /download/:filename
8. The PDF is automatically deleted after 10 minutes
```

---

## API

### `GET /health`

Simple healthcheck. Returns `200 OK`.

### `POST /generate-skeleton`

Generates or revises the presentation outline.

Supported formats:

- `multipart/form-data` when files are attached.
- plain JSON when no files are attached.

Relevant fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tema` | string | Yes | Topic to process |
| `language` | string | No | Target code or `auto` |
| `idioma` | string | No | Legacy alias |
| `mode` | string | No | `flash` or `pro` |
| `currentSkeleton` | object/string | No | Previous outline for revision |
| `files` | file[] | No | Up to 3 files |

Response:

- SSE `chunk` frames
- final event `{ done: true, skeleton: ... }`
- or `{ error: ... }`

### `POST /generate-outline-item`

Generates one focused outline item.

JSON body:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | `slide` or `point` |
| `topic` | string | Yes | Main topic |
| `existingSlides` | array | No | Context for adding a slide |
| `slideTitle` | string | No | Current slide title |
| `slideSubtitle` | string | No | Current slide subtitle |
| `existingPoints` | array | No | Existing bullet points |

Response: `{ item: ... }`

### `POST /generate`

Generates the final HTML presentation.

Supported formats:

- `application/json`
- `multipart/form-data`

Main fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tema` | string | Yes | Maximum `600` characters |
| `mode` | string | No | `flash` by default, or `pro` |
| `slides` | number | No | `1-15`; backend trims to `8` in `pro` |
| `language` | string | No | Target code used by the current UI |
| `idioma` | string | No | Legacy path validated against `es`, `en`, `fr`, `pt`, `de` |
| `skeleton` | object/string | No | User-approved outline |
| `files` | file[] | No | Up to `3` files |

Response:

- SSE `chunk` frames
- metadata `{ metadata: { provider, model } }`
- pipeline status events
- final event `{ done: true, html: ... }`

Common errors:

- `429 QUEUE_FULL`
- `503 PRO_TEMPORARILY_PAUSED`
- `400 SKELETON_EMPTY`
- validation errors (`slides`, `idioma`, topic)

### `POST /finalize`

Converts HTML to PDF.

JSON body:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `html` | string | Yes | Full HTML document |
| `title` | string | No | Friendly PDF filename |

Response: `{ pdfUrl: "/download/..." }`

### `GET /download/:filename`

Downloads a temporary PDF created by `/finalize`.

Notes:

- validates path traversal;
- accepts `name` query param for the downloaded filename;
- does not delete the file on first download; a timer handles cleanup later.

### `GET /__dev__/last-generated`

Available only outside production. Returns `tmp/last_generated.html`.

---

## Security and Limits

### Input validation

- maximum `600` topic characters;
- obvious HTML/script/XSS blocking;
- basic prompt-injection detection;
- slide-count and language validation;
- allowed-file-extension validation.

### Headers and CSP

The server applies:

- `Strict-Transport-Security`
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`
- `Content-Security-Policy`

### Default rate limits

| Rule | Value |
|------|-------|
| Flash daily per IP | 4 |
| Pro daily per IP | 2 |
| Flash cooldown | 20s |
| Pro cooldown | 60s |
| Global daily cap | 100 |
| Finalizations per 15 min | 10 |

### Additional protections

- `X-Powered-By` disabled;
- `X-Request-Id` on every request;
- proxy/IP auditing;
- output sanitization before rendering;
- automatic deletion of temporary PDFs.

---

## Deployment

### Frontend

- hosted on Vercel as a static site;
- `vercel.json` rewrites API routes to the backend;
- can also be served directly from Express in simpler environments.

### Backend

- deployed on Render as a Node.js service;
- can rebuild the Chrome binary from cached ZIP contents if Render drops the executable;
- sets a 10-minute `requestTimeout` for long generations.

---

## Environment Variables

### Required

At least one of these must exist:

| Variable | Use |
|----------|-----|
| `GEMINI_API_KEY` | Primary provider |
| `OPENROUTER_API_KEY` | Fallback provider |

### General

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | `development` or `production` |
| `PORT` | HTTP port |
| `APP_URL` | Referer sent to OpenRouter |
| `ALLOWED_ORIGINS` | CSV list of production CORS origins |

### Models

| Variable | Description |
|----------|-------------|
| `GEMINI_MODELS_FLASH` | Gemini model for Flash |
| `GEMINI_MODELS_STAGE1` | Gemini model for Stage 1 |
| `GEMINI_MODELS_STAGE2` | Gemini model for Stage 2 |
| `GEMINI_MODELS_STAGE3` | Gemini model for Stage 3 |
| `OPENROUTER_MODELS_FLASH` | Fallback CSV for Flash |
| `OPENROUTER_MODELS_STAGE1` | Fallback CSV for Stage 1 |
| `OPENROUTER_MODELS_STAGE2` | Fallback CSV for Stage 2 |
| `OPENROUTER_MODELS_STAGE3` | Fallback CSV for Stage 3 |
| `OPENROUTER_MODELS_STAGE3_ONLY` | Models restricted to final composition |

### Queues and limits

| Variable | Description |
|----------|-------------|
| `MAX_CONCURRENT_GENERATIONS` | Concurrent generations |
| `MAX_QUEUE_DEPTH` | Generation queue cap |
| `PRO_PAUSE_ACTIVE_GENERATIONS` | Pro pause threshold |
| `PRO_PAUSE_QUEUE_DEPTH` | Pro queue threshold |
| `PRESSURE_RETRY_AFTER_SEC` | Client retry hint |
| `PUPPETEER_MAX_CONCURRENT` | Concurrent PDF renders |
| `PUPPETEER_MAX_QUEUE` | PDF queue cap |
| `LIMITS_FLASH_DAILY` | Daily Flash quota |
| `LIMITS_PRO_DAILY` | Daily Pro quota |
| `LIMITS_FLASH_COOLDOWN_SEC` | Flash cooldown |
| `LIMITS_PRO_COOLDOWN_SEC` | Pro cooldown |
| `GLOBAL_DAILY_GENERATION_LIMIT` | Global daily cap |
| `LIMITS_FINALIZE_MAX` | Finalizations per window |

### Integrations and binaries

| Variable | Description |
|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | Redis URL |
| `UPSTASH_REDIS_REST_TOKEN` | Redis token |
| `PUPPETEER_EXECUTABLE_PATH` | Manual Chrome binary path |

---

## Local Development

### Requirements

- Node.js `>= 20`
- `npm` dependencies
- A Gemini or OpenRouter API key

### Installation

```bash
git clone https://github.com/Aedos-Team/Aedos.git
cd Aedos
npm install
```

### Minimal `.env`

```env
NODE_ENV=development
PORT=3000
GEMINI_API_KEY=your_key
```

You can also use:

```env
OPENROUTER_API_KEY=your_key
```

### Running

```bash
npm run dev
```

or

```bash
npm start
```

The app is available at `http://localhost:3000`.

### NPM scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Runs `node --watch src/backend/server.js` |
| `npm start` | Runs the server without watch |
| `npm run build` | Executes `scripts/install-chrome.sh` |
| `postinstall` | Tries to install Chrome automatically |

### Development debugging

When `NODE_ENV=development`:

- `tmp/last_generated.html` is saved;
- `tmp/pipeline_debug_*` files are saved;
- examples are saved to `examples/flash/` and `examples/pro/`;
- `GET /__dev__/last-generated` is available.
