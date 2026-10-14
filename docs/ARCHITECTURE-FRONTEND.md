# Frontend architecture

Aedos serves a vanilla JavaScript SPA from `src/frontend/`, without a bundler.
`index.html` declares the order of CSS, native modules, and classic scripts.
Classic scripts and the presentation iframe communicate through explicit
`window.*` APIs.

## Responsibility map

| Path | Responsibility |
| --- | --- |
| `index.html`, `vercel.json` | SPA document, asset loading, and hosting rewrites |
| `styles/` | Application CSS, including chat, settings, dialogs, outline, preview, and workspace |
| `features/shared/` | Translations, logger, HTTP/SSE, stores, theme, vendor assets, and shared bootstrap |
| `features/app/` | Routing, reset, dropdowns, and tooltips |
| `features/chat/` | Input, attachments, chips, thinking panels, loading, and validation |
| `features/outline/`, `features/skeleton/` | Outline editing, streaming, rendering, and skeleton injection |
| `features/generation/` | Skeleton/final SSE requests, stage/reasoning progress, preview preparation, and transitions |
| `features/modals/` | Error, export progress, donation, and refusal dialogs |
| `features/export/` | Export snapshot preparation and download flow |
| `features/editor/`, `editor/` | Iframe editor, selection, history, geometry, pointer interactions, and toolbar |
| `features/tools/` | Shape/icon insertion and editor tools |
| `features/minimap/` | Thumbnail rendering, slide navigation, and minimap state |
| `features/preview/` | Iframe mounting/scaling, streaming markup, navigation, image replacement, overlays, and final reveal |
| `mobile/` | Mobile styling, navigation dots, drawers, pinch zoom, pan, and swipe |
| `scripts/app.js`, `scripts/outline.js` | Application and outline composition |
| `scripts/chat-design-preview.js` | Design-preview integration |
| `assets/` | Static images and model icons |

## Main flow

1. `index.html` loads styles, vendor assets, translations, stores, feature
   scripts, and application coordinators in their declared order.
2. Chat controllers validate input and manage attachments. Shared stores own
   generation and preview/editor state. `features/shared/http-sse.js` provides
   the SSE reader and the `window.AedosHttpSse` facade.
3. Skeleton generation streams outline data. Outline modules render and edit
   slides; `scripts/outline.js` composes their dependencies and public bridges.
4. Final generation streams slide HTML into the preview. Preview modules manage
   markup buffering, iframe mounting, asset settling, and editor reveal.
5. `editor/editor.js` loads as a native module inside the iframe and imports
   editor helpers. The parent uses compatibility hooks for selection, history,
   image replacement, layers, tools, and minimap.
6. Export modules prepare the live editor snapshot and call the backend's PDF
   or PPTX finalizer. The returned URL starts the download.

## State and initialization

Factories receive DOM nodes, stores, and callbacks from their coordinators.
They are instantiated at their existing registration points. Late callbacks
and getters defer access to bindings initialized later in the same closure.

The shared stores own generation and preview/editor state. Legacy
`window.*` accessors delegate to that state. The editor's pointer state,
selection, and history remain per iframe. Public compatibility names are used
by classic scripts, HTML handlers, and the parent/iframe boundary.

## Assets and languages

`features/shared/vendor-assets.js` centralizes vendor URLs and integrity
values. Styles and scripts load in the order declared by `index.html`.
Translations live in `features/shared/i18n.js`; user-facing content retains
its supported languages. Project documentation and code comments are English.

## Verification

Frontend tests cover stores, renderers, outline lifecycle, attachments,
transitions, editor operations, geometry, history, tools, minimap, modals, and
mobile navigation. `npm run check:dom` checks static IDs.
`npm run check:editor-safety` runs browser flow and mutation checks.
The [contracts](CONTRACTS.md) describe HTTP/SSE and public frontend APIs;
the [frontend inventory](FRONTEND-INVENTORY.md) lists current source modules.
