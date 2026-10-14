# Aedos

Aedos is a web app for creating and editing AI-assisted presentations. It generates slide HTML from a topic and optional supporting files, lets you revise the result in the browser, and exports PDF or editable PowerPoint files. Flash generates a presentation in one pass; Pro uses a content, design, and composition pipeline.

The frontend is plain HTML, CSS, and JavaScript. The backend is Node.js and Express, with Google Gemini and OpenRouter for generation, Upstash Redis for credits and limits, and Puppeteer for exports.

## Requirements

- Node.js 22.8 or newer (see `.nvmrc`) and npm.
- A `GEMINI_API_KEY` or `OPENROUTER_API_KEY`. At least one is required at startup.
- Upstash Redis credentials for generation and credit accounting. Without Redis, the server can start, but credit-protected requests return `CREDITS_UNAVAILABLE`.
- Chrome for PDF and PowerPoint rendering. The install scripts attempt to provision it during `npm install`.

## Run locally

```bash
npm ci
cp .env.example .env
# Edit .env: set at least one provider key and both Upstash Redis values.
npm run dev
```

Open <http://localhost:3000>. On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp` if needed. `npm start` runs without file watching. The server loads `.env` with `dotenv`; never commit real credentials.

The `.env.example` file lists active settings and safe defaults. Keep provider keys empty when unused. For production, set `NODE_ENV=production` and `ALLOWED_ORIGINS` to a comma-separated list of HTTPS origins without trailing slashes. The server validates these origins at startup.

## How it works

1. Enter a topic, choose Flash or Pro, and optionally attach PDF, Word, or image files.
2. Generate an outline, refine it, and generate the slides.
3. Edit text and layout in the browser, then export PDF or editable PowerPoint.

The browser calls `/generate-skeleton`, `/generate-outline-item`, and `/generate`; generation streams progress over SSE. `/finalize` and `/finalize-pptx` render exports. `/api/models` exposes the server's model catalog, and `/api/credits` reports the current credit balance. Generated HTML is sanitized before preview and export.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/backend/` | HTTP routes, generation pipeline, providers, limits, sanitization, and export |
| `src/frontend/` | Browser UI and editor |
| `tests/` | Contract, frontend, sanitization, and export tests and fixtures |
| `scripts/` | Baseline checks and development utilities |
| `docs/` | Architecture, contracts, model catalog, and detailed guides |

See [the model catalog](docs/MODEL-CATALOG.md) for supported model IDs and billing, [the backend architecture](docs/ARCHITECTURE-BACKEND.md) for implementation details, and [the full English guide](docs/README.en.md) for route and feature descriptions.

## Checks

| Command | Purpose |
| --- | --- |
| `npm test` | Core frontend and PowerPoint export tests |
| `npm run test:contract` | Backend contracts and queue tests |
| `npm run test:sanitization` | Generated HTML sanitization snapshots |
| `npm run verify:baseline` | Functional and visual baselines |
| `npm run verify:quality` | ESLint, TypeScript, and formatting ratchets |
| `npm run verify:all` | Baseline and quality checks |

Some baseline checks need the installed Chrome binary. Normal local generation needs valid provider and Redis credentials.
