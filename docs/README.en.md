# Aedos -- AI Presentation Generator

Aedos is a web application that enables users to automatically generate academic and professional presentations in PDF format using large language models (LLMs) through the OpenRouter API. The user writes a topic in natural language, the AI generates complete slides in HTML/CSS, and the system converts them to PDF using a headless browser (Puppeteer).

Production site: [https://aedoslab.xyz](https://aedoslab.xyz)

---

## Table of Contents

- [General Architecture](#general-architecture)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Backend](#backend)
  - [Main Server](#main-server)
  - [Generation System (Prompts)](#generation-system-prompts)
  - [Rate Limiting](#rate-limiting)
  - [Logger](#logger)
- [Frontend](#frontend)
  - [Main Interface](#main-interface)
  - [Slide Editor](#slide-editor)
  - [Minimap](#minimap)
  - [Tools Panel](#tools-panel)
  - [Mobile Support](#mobile-support)
  - [Internationalization (i18n)](#internationalization-i18n)
- [Generation Modes](#generation-modes)
- [Data Flow](#data-flow)
- [API Endpoints](#api-endpoints)
- [Security](#security)
- [Deployment Infrastructure](#deployment-infrastructure)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)

---

## General Architecture

```
User (browser)
       |
       v
  Vercel (Static frontend)
       |
       | rewrites: /generate, /finalize, /download, /health
       v
  Render (Node.js + Express backend)
       |
       +---> OpenRouter API (LLMs: Gemini, Kimi, etc.)
       +---> Upstash Redis (persistent rate limiting)
       +---> Puppeteer / Chrome Headless (HTML -> PDF conversion)
```

Aedos uses a decoupled frontend-backend architecture. The frontend is served as static content on Vercel, which redirects API routes to the backend deployed on Render. The backend coordinates content generation with AI models, applies security sanitization to the generated HTML, and converts the final result to PDF using Puppeteer.

---

## Technology Stack

| Layer          | Technology                                                       |
|----------------|------------------------------------------------------------------|
| Frontend       | HTML5, CSS3 (vanilla), JavaScript (vanilla)                      |
| Backend        | Node.js, Express.js                                              |
| AI / LLM       | OpenRouter API (Gemini 2.5 Flash Lite, Kimi K2.6, and others)   |
| PDF            | Puppeteer (headless Chrome)                                      |
| Rate Limiting  | Upstash Redis (with in-memory fallback)                          |
| FE Hosting     | Vercel                                                           |
| BE Hosting     | Render                                                           |
| Icons          | Lucide Icons (via CDN)                                           |
| Animations     | GSAP, Motion (vanilla)                                           |
| Fonts          | Google Fonts (23 preloaded families)                             |

---

## Project Structure

```
Aedos/
+-- .env                         # Environment variables (not tracked by Git)
+-- .gitignore                   # Files excluded from the repository
+-- package.json                 # NPM dependencies and scripts
+-- src/
|   +-- backend/
|   |   +-- server.js            # Main Express server (~1800 lines)
|   |   +-- prompts/
|   |   |   +-- base.js          # Monolithic prompt for Flash mode
|   |   |   +-- pipeline.js      # 3-stage pipeline orchestrator (Pro)
|   |   |   +-- stage1-content.js    # Stage 1: Content extraction
|   |   |   +-- stage2-design.js     # Stage 2: Creative/visual direction
|   |   |   +-- stage3-compositor.js # Stage 3: Final HTML generation
|   |   +-- utils/
|   |       +-- logger.js        # Structured logging system with colors
|   |       +-- rate-limiter.js  # Rate limiting with Redis/in-memory
|   +-- frontend/
|       +-- index.html           # Main page (SPA)
|       +-- vercel.json          # Vercel deployment configuration
|       +-- scripts/
|       |   +-- app.js           # Main frontend logic (~155KB)
|       +-- styles/
|       |   +-- style.css        # Global styles (~74KB)
|       +-- editor/
|       |   +-- editor.js        # Slide editor engine
|       |   +-- editor-ui.js     # Editor interface
|       |   +-- editor.css       # Editor styles
|       +-- features/
|       |   +-- minimap/
|       |   |   +-- minimap.js   # Slide thumbnail panel
|       |   |   +-- minimap.css  # Minimap styles
|       |   +-- tools/
|       |   |   +-- tools.js     # Property panel / inspector
|       |   |   +-- tools.css    # Tools panel styles
|       |   +-- shared/
|       |   |   +-- i18n.js      # Internationalization system (ES/EN)
|       |   |   +-- logger.js    # Frontend logger
|       |   |   +-- init.js      # Shared initialization
|       |   |   +-- base.css     # Shared base styles
|       |   |   +-- lucide-init.js  # Lucide icons initialization
|       |   +-- skeleton/
|       |       +-- skeleton-injector.js  # Loading skeletons
|       +-- mobile/
|       |   +-- css/
|       |   |   +-- index.css            # Main mobile styles
|       |   |   +-- style-mobile-overrides.css  # Mobile overrides
|       |   +-- html/
|       |   |   +-- bottom-nav.html      # Mobile bottom navigation
|       |   |   +-- mode-select.html     # Mobile mode selector
|       |   |   +-- touch-capture-overlay.html
|       |   +-- js/
|       |       +-- app-mobile.js        # Mobile logic
|       |       +-- bridge.js            # Desktop-mobile bridge
|       |       +-- config.js            # Mobile configuration
|       +-- assets/
|           +-- images/
|               +-- favicon.svg          # SVG favicon
|               +-- og-image.png         # Open Graph image
+-- examples/                   # Generated examples (development only)
+-- tmp/                        # Temporary files (PDFs, debug)
```

---

## Backend

### Main Server

The `server.js` file is the backend core. It manages:

- **Express Server**: CORS configuration, security headers, static file serving, and HTTP request handling.
- **Queue System**: Concurrency control for AI generations with separate queues for generation (`/generate`) and finalization (`/finalize`). Parameters are configurable:
  - `MAX_CONCURRENT_GENERATIONS`: Maximum simultaneous generations (default 10).
  - `MAX_QUEUE_DEPTH`: Maximum queue depth (default 40).
  - `PUPPETEER_MAX_CONCURRENT`: Maximum simultaneous PDF renders (default 3).
- **Redirects**: In production, requests arriving at the raw Render URL (`*.onrender.com`) are redirected to the canonical domain (`aedoslab.xyz`), except for API routes.
- **HTML Sanitization**: All AI-generated HTML goes through a sanitization process that removes scripts, inline event handlers, JavaScript URLs, and duplicate Google Fonts tags. Verified resources (Google Fonts and Lucide Icons) are then injected.
- **Puppeteer Management**: Headless Chrome browser initialization with self-healing binary extraction on Render (extracts from cached ZIP when the cache loses the binary).

### Generation System (Prompts)

The prompt system has two generation paths:

#### Flash Mode (Single Prompt)

Defined in `prompts/base.js`. A single massive prompt (~400 lines) that includes:
- Security instructions and system role
- JSON configuration embedded in an HTML comment (`<!-- CONFIG ... -->`)
- Complete CSS definitions with variables, reusable classes, and layout patterns
- 12 predefined layout patterns (Cover, Cards-2, Cards-3, Split, Stats, Steps, Quote, Timeline, Conclusion, Text, Editorial, Comparison)
- Allowed Lucide icon catalog
- Final validation rules

The model receives a single prompt and generates both the configuration and the complete HTML in one pass.

#### Pro Mode (3-Stage Pipeline)

Orchestrated by `prompts/pipeline.js`:

1. **Stage 1 -- Content Extraction** (`stage1-content.js`):
   - Analyzes the user input and extracts structured content.
   - Produces a JSON with: topic, audience, tone, text density, narrative structure, and the slides array.
   - Includes a `visual_world` field with `real_world_analog` that describes a concrete physical artifact that evokes the topic (e.g., "heavy metal tour poster on glossy black paper").
   - Detects the input language and generates all content in that language.
   - Maximum of 8 slides per pipeline.

2. **Stage 2 -- Creative Direction** (`stage2-design.js`):
   - Receives the Stage 1 JSON and generates visual design decisions.
   - Produces: color palette, typographic pair, global mood, and per-slide layout directives.
   - The `real_world_analog` from Stage 1 drives all visual decisions.

3. **Stage 3 -- HTML Compositor** (`stage3-compositor.js`):
   - Receives the content from Stage 1 and the design from Stage 2.
   - Generates the final complete HTML/CSS document ready for rendering.
   - This stage is streamed via SSE to the client.

Each stage can use different AI models, configured via environment variables (`OPENROUTER_MODELS_STAGE1`, `OPENROUTER_MODELS_STAGE2`, `OPENROUTER_MODELS_STAGE3`).

### Rate Limiting

Implemented in `utils/rate-limiter.js`. Uses Upstash Redis as a persistent store with an in-memory fallback when Redis is unavailable.

**Per-mode limits:**

| Parameter                     | Flash     | Pro       |
|-------------------------------|-----------|-----------|
| Daily generations per IP      | 4         | 2         |
| Cooldown between generations  | 20s       | 60s       |
| Global daily limit            | 100       | 100       |

**Finalization (PDF) limits:**

| Parameter                     | Value     |
|-------------------------------|-----------|
| Maximum per 15-minute window  | 10        |

The system also includes an IP audit mechanism that detects if all requests in production are coming from a single IP address (indicating a proxy configuration issue).

### Logger

`utils/logger.js` implements a structured logger with:

- Levels: `debug`, `info`, `success`, `http`, `warn`, `error`, `fatal`
- ANSI terminal colors
- Semantic error categories: `BOOT`, `CONFIG`, `HTTP`, `SECURITY`, `VALIDATION`, `QUEUE`, `PROVIDER`, `QUOTA`, `MODEL`, `PIPELINE`, `STREAM`, `SANITIZER`, `PUPPETEER`, `FILESYSTEM`, `NETWORK`, `DOWNLOAD`
- Metadata serialization with long string clipping
- Child logger support with hierarchical scopes

---

## Frontend

### Main Interface

The frontend is a Single Page Application (SPA) built with vanilla HTML, CSS, and JavaScript. The interface has three main sections:

1. **Chat Screen** (`#chat-screen`): The initial screen where the user types their presentation topic. Includes:
   - Text input with character counter (maximum 600)
   - Flash/Pro mode toggle
   - Generation button

2. **Preview / Editor** (`#preview-container`): Full workspace for editing the generated presentation. Includes:
   - Header with navigation controls, zoom, undo/redo, presentation mode, and PDF download
   - Thumbnail panel (minimap) on the left
   - Slide viewer in the center (iframe)
   - Tools/property panel on the right
   - Floating toolbar for adding elements

3. **Result** (`#result-container`): Confirmation screen after PDF generation.

### Slide Editor

The editor (`editor/editor.js`, ~95KB) enables:

- Direct text editing within slides
- Adding, deleting, and duplicating slides
- Adding elements: text, images, geometric shapes, icons
- Undo/redo changes
- Zoom and view fitting
- Full-screen presentation mode
- Drag and drop elements
- Background property editing (color, gradients)

### Minimap

The minimap (`features/minimap/`) displays thumbnails of all slides in a side panel. Features:

- Quick navigation between slides by clicking
- Reordering via drag and drop
- Duplication and deletion via context menu
- Position indicators (dots) in the header

### Tools Panel

The tools panel (`features/tools/`, ~51KB of JS) is a contextual property inspector that changes based on the selected element:

- **Text**: Font size, alignment, color, font selection (23 available families)
- **Image**: Image replacement, border radius, opacity
- **Icon**: Icon color, icon catalog by categories (Essentials, Communication, Business, Multimedia, Technology, Social, Navigation, Nature, Objects)
- **Shape**: Fill color, border color (Square, Circle, Diamond, Triangle, Hexagon, Capsule)
- **Advanced**: Bring to front, send to back, duplicate, delete

### Mobile Support

The mobile system (`mobile/`) adapts the interface for touch devices:

- Bottom navigation with previous/next slide buttons
- CSS overrides for responsive layouts
- Bridge (`bridge.js`, ~21KB) that translates touch events to editor interactions
- HTML5 Drag and Drop polyfill for touch screens

### Internationalization (i18n) & Multilingual Pipeline

The system is fully localized and supports generating presentations in any selected target language:

- **Interface Localization (`features/shared/i18n.js`)**: Supports English (`en`) as default and Spanish (`es`) automatically detected via `navigator.language`. Translations are dynamically bound using `data-i18n`, `data-i18n-title`, `data-i18n-placeholder`, and `data-i18n-val` attributes.
- **Multilingual Presentation Generation**: The home screen includes an explicit language selector. The selected language is sent as `idioma` to the `/generate` endpoint, which maps it to `targetLanguage`. This value is dynamically injected directly into the system prompts for both Flash mode (`base.js`) and Pro mode (`stage1-content.js`). The models are strictly instructed to generate slide content (titles, text, bullet points) in the target language while maintaining JSON keys, CSS variables, and HTML tags in English to prevent rendering issues.

### UI/UX Micro-interactions & Polish

Aedos prioritizes a highly premium, fluid user experience through custom micro-interactions:
- **Lifting Suggestion Pills**: The quick-start suggestion pills on the chat screen feature a smooth vertical lift animation on hover (`transform: translateY(-2px)`), matching the tactile feel of the editor controls.
- **Attachment Accordion Transition**: When attaching or removing files, the `.attachment-preview-container` glides open and closed like silk via a smart CSS height transition (`max-height` from `0` to `150px` with a premium `cubic-bezier(0.4, 0, 0.2, 1)` easing) combined with opacity and margin transitions, eliminating layout jumps.
- **High-Fidelity Branded File Icons**: Replaced generic outline wireframe icons with custom-built, ultra-high-definition, solid-colored SVG icons for `.pdf` (Adobe Red) and `.docx`/`.doc` (Word Blue) uploads that mimic the official document brand representations.

---

## Generation Modes

| Feature                 | Flash                        | Pro                              |
|-------------------------|------------------------------|----------------------------------|
| Approximate time        | ~20 seconds                  | ~2 minutes                       |
| Process                 | Single monolithic prompt     | 3-stage pipeline                 |
| Maximum slides          | 15                           | 8                                |
| Default models          | Gemini 2.5 Flash Lite        | Stages 1 & 2: Gemini 2.5 Flash Lite, Stage 3: Kimi K2.6 |
| Design quality          | Good                         | High (design derived from physical artifact) |
| Daily generations       | 4 per IP                     | 2 per IP                        |

---

## Data Flow

### Presentation Generation

```
1. User writes topic in the frontend
2. Frontend sends POST /generate with { tema, mode, slides, idioma }
3. Backend validates and sanitizes the input
4. Rate limiter checks per-IP and per-mode limits
5. Request enters the concurrency queue
6. (Flash) A single prompt is built and sent to OpenRouter
   (Pro) The 3-stage pipeline executes sequentially
7. The AI response is streamed via SSE (Server-Sent Events)
8. Backend sanitizes the HTML in each chunk and at the end
9. Frontend receives chunks and renders them in the iframe
10. User can edit the presentation in the editor
```

### PDF Download

```
1. User clicks "Download PDF"
2. Frontend sends POST /finalize with { html, title }
3. Backend sanitizes the HTML and opens a page in Puppeteer
4. Puppeteer renders the HTML with fonts, icons, and print styles
5. PDF is generated with 29.7cm x 16.7cm dimensions (16:9)
6. Backend responds with the download URL
7. Frontend redirects the user to GET /download/:filename
8. The PDF file is auto-deleted after 10 minutes
```

---

## API Endpoints

### `GET /health`

Health check endpoint. Returns `200 OK`.

### `POST /generate`

Generates an HTML presentation from a topic.

**Body (JSON):**

| Field    | Type   | Required | Description                                   |
|----------|--------|----------|-----------------------------------------------|
| `tema`   | string | Yes      | Presentation topic (max 600 characters)       |
| `mode`   | string | No       | `"flash"` (default) or `"pro"`                |
| `slides` | number | No       | Number of slides (1-15, default 5)            |
| `idioma` | string | No       | Language: `es`, `en`, `fr`, `pt`, `de`        |

**Response:** SSE stream with HTML chunks and pipeline status.

### `POST /finalize`

Converts HTML to PDF.

**Body (JSON):**

| Field   | Type   | Required | Description                        |
|---------|--------|----------|------------------------------------|
| `html`  | string | Yes      | Complete presentation HTML         |
| `title` | string | No       | Title for the downloaded filename  |

**Response:** `{ pdfUrl: "/download/..." }`

### `GET /download/:filename`

Downloads a generated PDF. The `name` query parameter defines the downloaded file's name.

### `GET /__dev__/last-generated` (Development only)

Returns the last generated HTML for debugging.

---

## Security

### Input Sanitization

- HTML/XSS injection detection: HTML tags, `javascript:`, inline event handlers, `eval()`, `document.cookie`, `window.location`, `fetch()`, `innerHTML`
- Prompt injection detection: "ignore previous", "system prompt", "act as", "reveal your", etc.
- 600-character limit per topic

### Output Sanitization

- Removal of `<script>` blocks from generated HTML
- Removal of inline event handlers (`onclick`, `onload`, etc.)
- Removal of `javascript:` URLs in `href`, `src`, `action` attributes
- Removal of duplicate Google Fonts `<link>` tags
- Removal of CSP meta tags from generated HTML (configured at server level)
- Controlled injection of verified resources only

### Security Headers

The server applies the following headers on all responses:

- `Strict-Transport-Security` (HSTS)
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` (disables camera, microphone, geolocation, payments)
- `Content-Security-Policy` (origin restrictions for scripts, styles, fonts, images, frames)

### CORS

- In production: only origins listed in `ALLOWED_ORIGINS`
- In development: `localhost:3000`, `localhost:5173`, `127.0.0.1:3000`
- Strict validation: requires HTTPS, no trailing slash, no wildcards

### Additional Protections

- `X-Powered-By` header disabled
- Unique request IDs (`X-Request-Id`) for traceability
- Path traversal protection on downloads
- Auto-deletion of PDFs after 10 minutes
- IP diversity auditing in production

---

## Deployment Infrastructure

### Vercel (Frontend)

The frontend is deployed on Vercel as static content. The configuration in `vercel.json` defines:

- **Rewrites**: Routes `/generate`, `/finalize`, `/download`, `/health`, and `/__dev__` are redirected to the Render backend (`https://aedos.onrender.com`).
- **Security headers**: CSP, HSTS, X-Frame-Options, etc. are applied at CDN level.
- **Clean URLs**: Enabled with `cleanUrls: true`.

### Render (Backend)

The backend is deployed on Render as a Node.js web service.

Specific considerations:

- **Puppeteer on Render**: Render can lose the Chrome binary from the disk cache between deploys. The server detects this automatically and extracts the binary from the cached ZIP without needing a download.
- **Cold starts**: Render may sleep after periods of inactivity. The `/health` endpoint allows configuring an external keep-alive.
- **Request timeout**: Set to 10 minutes for long AI generations.

---

## Environment Variables

| Variable                        | Required | Description                                          |
|---------------------------------|----------|------------------------------------------------------|
| `OPENROUTER_API_KEY`            | Yes      | OpenRouter API key                                   |
| `NODE_ENV`                      | No       | `development` or `production` (default: development) |
| `PORT`                          | No       | Server port (default: 3000)                          |
| `ALLOWED_ORIGINS`               | Prod     | Comma-separated allowed CORS origins                 |
| `UPSTASH_REDIS_REST_URL`        | No       | Upstash Redis instance URL                           |
| `UPSTASH_REDIS_REST_TOKEN`      | No       | Upstash Redis authentication token                   |
| `OPENROUTER_MODELS_FLASH`       | No       | Models for Flash mode (CSV)                          |
| `OPENROUTER_MODELS_STAGE1`      | No       | Models for pipeline Stage 1 (CSV)                    |
| `OPENROUTER_MODELS_STAGE2`      | No       | Models for pipeline Stage 2 (CSV)                    |
| `OPENROUTER_MODELS_STAGE3`      | No       | Models for pipeline Stage 3 (CSV)                    |
| `OPENROUTER_MODELS_STAGE3_ONLY` | No       | Models restricted exclusively to Stage 3 (CSV)       |
| `MAX_CONCURRENT_GENERATIONS`    | No       | Maximum simultaneous generations (default: 10)       |
| `MAX_QUEUE_DEPTH`               | No       | Maximum queue depth (default: 40)                    |
| `PUPPETEER_MAX_CONCURRENT`      | No       | Maximum simultaneous PDF renders (default: 3)        |
| `PUPPETEER_MAX_QUEUE`           | No       | Maximum Puppeteer queue (default: 10)                |
| `LIMITS_FLASH_DAILY`            | No       | Daily Flash limit per IP (default: 4)                |
| `LIMITS_PRO_DAILY`              | No       | Daily Pro limit per IP (default: 2)                  |
| `LIMITS_FLASH_COOLDOWN_SEC`     | No       | Flash cooldown in seconds (default: 20)              |
| `LIMITS_PRO_COOLDOWN_SEC`       | No       | Pro cooldown in seconds (default: 60)                |
| `PRO_PAUSE_ACTIVE_GENERATIONS`  | No       | Active generations threshold to pause Pro (default: 8) |
| `PRO_PAUSE_QUEUE_DEPTH`         | No       | Queue depth threshold to pause Pro (default: 24)      |
| `GLOBAL_DAILY_GENERATION_LIMIT` | No       | Global daily generation limit (default: 100)         |
| `LIMITS_FINALIZE_MAX`           | No       | Maximum finalizations per window (default: 10)       |
| `PUPPETEER_EXECUTABLE_PATH`     | No       | Custom path to Chrome binary                         |
| `APP_URL`                       | No       | Application URL for HTTP-Referer header              |

---

## Local Development

### Requirements

- Node.js >= 20.0.0
- Chrome/Chromium (automatically installed by Puppeteer)

### Installation

```bash
git clone https://github.com/Aedos-Team/Aedos.git
cd Aedos
npm install
```

### Configuration

Create a `.env` file at the project root:

```env
OPENROUTER_API_KEY=sk-or-...
NODE_ENV=development
PORT=3000
```

### Running

```bash
# Development (with hot-reload)
npm run dev

# Production
npm start
```

The server will be available at `http://localhost:3000`.

### NPM Scripts

| Command        | Description                                              |
|----------------|----------------------------------------------------------|
| `npm run dev`  | Starts the server with `--watch` for auto-reload         |
| `npm start`    | Starts the server in production mode                     |
| `npm run build`| Installs the Puppeteer binary (for deployment)           |

### Debugging

In development mode (`NODE_ENV=development`):

- The last generated HTML is saved to `tmp/last_generated.html`
- Pipeline artifacts are saved to `tmp/pipeline_debug_*`
- Generated examples are saved to `examples/flash/` and `examples/pro/`
- The `/__dev__/last-generated` endpoint serves the last generated HTML
