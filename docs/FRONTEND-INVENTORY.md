# Frontend extraction inventory

Baseline: `refactor/fase-8a-red-estable` at `565a8f0d296fa85b1ec92ba1a08c24dc7c74c9e6` (2026-10-03). Source line counts were measured from committed blobs, not the working tree:

```text
git show HEAD:src/frontend/scripts/app.js | wc -l       # 4618
git show HEAD:src/frontend/scripts/outline.js | wc -l   # 1308
git show HEAD:src/frontend/editor/editor.js | wc -l     # 1898
```

Line ranges below refer to that snapshot. They identify extraction seams, not
permission to change behavior. The current `window.*` facade, markup, CSS order,
timers, promise/event ordering, and store object identity are compatibility
contracts. Keep a facade in the original entry point while moving an
implementation. Remove a property only after a repository-wide search across
JavaScript, HTML, iframe entry points, `docs/CONTRACTS.md`, and tests proves zero
consumers. Every new module must own one responsibility, remain at or below 300
lines, have JSDoc `@typedef` definitions for its API/state, and have a README in
its feature folder. A proposed folder that does not yet exist must be created
with its README in the same commit as its first module.

## `src/frontend/scripts/app.js` — 4618 lines

The script is a classic-script DOMContentLoaded coordinator. It acquires the
existing `AedosStores.generation.state` and
`AedosStores.previewEditor.state`; the preview store's `currentSlide` and the
legacy `window.currentSlide` are deliberately separately synchronized values.
The app also reads/writes the `outlineEditorState` facade and invokes iframe
editor APIs. Do not move whole blocks that close over these objects without
injecting the specific store/API they need.

| Lines | Responsibility and principal functions | Shared mutable state read / written | `window.*` API used or written | Proposed destination |
|---|---|---|---|---|
| 1–82 | `sanitizeModelOutput`, `gifToStaticDataUrl`; app bootstrap and store/logger acquisition | No app state in the two helpers; bootstrap obtains generation and preview stores | Reads `AedosStores`, `BrowserLogger`; helper declarations remain compatible until consumers are searched | Pure pieces to existing `features/shared/` or `features/chat/` modules, with thin classic wrappers |
| 83–353 | DOM references; top-panel mode/language/export-format controls, file-to-mode synchronization and message routing | Reads/writes generation `proModeEnabled`, `targetLanguage`, `requestedExportFormat`; reads attached files; reads preview iframe identity for messages | Reads `AedosStores`, `MobileRuntime`, `MobileConfig`; writes `_syncModeWithFiles` | Existing `features/shared/` controllers, then a focused `features/navigation/` controller if needed |
| 354–433 | Theme/language control initialization and native placeholder setup | Reads/writes theme storage and preview iframe theme; local placeholder state | Calls `AedosThemeController`; reads `MobileRuntime`, `__t` | Keep theme in `features/shared/theme-controller.js`; placeholder behavior belongs with chat composer |
| 434–1007 | Screen router (`navigateToHome/Chat/Editor`), conversation cleanup, upload/drop validation, attachment chips and generate-button validation | Reads/writes generation mode, attached files, active controllers, hero flags; reads/writes `outlineEditorState`; resets preview DOM and chat state | Writes `navigateToHome`, `navigateToChat`, `navigateToEditor`, `_attachedFiles` facade, `_syncModeWithFiles`, `validateGenerateButton`; reads/writes `_chipsRenderTimeout`; calls outline, modal, translation and mobile APIs | `features/navigation/screen-router.js` and `features/chat/attachments.js`; inject store/DOM actions instead of capturing app locals |
| 1008–1278 | Generate-button loading messages, hero text transitions, preview reset/title helpers and debug-canvas setup | Reads mode/language; writes transient timer fields, preview title/HTML/current slide | Reads/writes `_btnMsgTimer`, `_heroTypewriterTimer`, `_heroResetTimer`, `_manualZoomScale`; writes `currentSlide`; calls `AedosStores`, `__t`, `MobileRuntime` | `features/generation/controls.js`; debug canvas and title/reset helpers stay with preview lifecycle |
| 1279–1760 | `handleGenerate`: skeleton request construction, upload handoff, SSE consumption, partial outline updates and failure/cancel paths | Reads/writes generation controllers, sequence, files, backup skeleton and pending request body/headers; reads/writes outline state | Reads/writes `_activeGenController`, `_attachedFiles`, `_backupSkeleton`, `_pendingGenerateBodyData`, `_pendingGenerateHeaders`; calls `prepareOutlineStreaming`, `renderStreamingOutline`, `finalizeStreamingOutline`, `stopOutlineGeneration`, `navigateToChat` | `features/generation/skeleton-flow.js`; preserve SSE event order and pass explicit generation/outline store APIs |
| 1761–1919 | `proceedWithCurrentOutline`, request handoff and user-approved continuation | Reads skeleton, language, attachments and controller; writes pending request and progress timers | Writes `proceedWithCurrentOutline`, pending-body/header facades, `_proceedMsgInterval`; calls `startFinalGeneration` | Same skeleton-flow boundary as 1279–1760, with a wrapper retaining `window.proceedWithCurrentOutline` |
| 1920–2779 | `startFinalGeneration`: final SSE stream, incremental HTML, error/retry handling, generation identity and animated transition into preview | Reads/writes generation sequence/controllers/current-generation identity; preview HTML/title/iframe/insets/settling animation; consumes outline skeleton | Writes `startFinalGeneration`; uses `_pendingGenerateBodyData`, `_pendingGenerateHeaders`, `_proceedMsgInterval`, `_manualZoomScale`, `_pendingTransitionFn`; calls `initPreview`, `scaleIframe`, `navigateToEditor`, `AedosStores`, `AedosHttpSse` | `features/generation/final-generation.js` plus a distinct transition adapter; all async callbacks need an explicit generation/iframe token API |
| 2780–3410 | `initPreview`, slide discovery, `setupPreviewInteractions`, iframe initialization/restoration, editor/minimap/tools setup and dot regeneration | Reads/writes preview iframe, generated HTML, slide container/cursor/count, title and insets; rekeys slot overlay references during undo/redo | Writes `regenerateDotsCount`; reads/writes `_restoreBatchT`, `_refreshSlotOverlays`, `_ensureInternalOverlay`, `_buildOverlayForSlot`; calls iframe `editor*`, `initEditorUI`, `initMinimap`, `initTools` | `features/preview/iframe-lifecycle.js`; isolate restore/rebind API from `features/preview/image-slots.js` |
| 3411–3614 | Zoom state, sizing, pan synchronization and fullscreen entry/exit | Reads/writes preview insets and iframe transforms; uses mobile zoom/pan fallback | Reads/writes `_manualZoomScale`, `_baseScale`, `_mobile_zoom`, `_pan`; calls `MobileRuntime`, iframe `editor*` | `features/preview/zoom-controller.js` (new folder README if needed), consuming preview store and explicit viewport adapter |
| 3615–4135 | Image slot replacement, iframe drop handling, parent-side file-picker overlays and overlay rekey/position | Reads/writes preview iframe and `_overlayMap`; modifies iframe slot DOM and parent overlay DOM | Reads/writes `_ensureInternalOverlay`, `_triggerImagePicker`, `_pruneDeadSlotOverlays`, `_refreshSlotOverlays`, `_buildOverlayForSlot`, `_slotMsgHandler`; calls iframe `editorSaveState` and preview APIs | `features/preview/image-slots.js`; inject iframe/store operations and retain all editor-facing bridges |
| 4136–4443 | Slide navigation, dots/counters, keyboard, wheel, touch and mobile counter synchronization | Reads/writes preview slide cursor/count/container and legacy mirrored `currentSlide` | Writes `scrollToSlide`, `prevSlide`, `nextSlide`, `getCurrentSlide`, `getTotalSlides`; calls iframe `editor*`, `MobileRuntime`, `AedosMobileNavDots` | `features/preview/slide-navigation.js`, explicit preview-store methods and event callbacks |
| 4444–4507 | PDF/PPTX finalization, progress, download and export error display | Reads/writes requested export format; reads preview iframe/title | Uses `AedosExportSnapshot`; reads translation/modal APIs | Existing `features/export/` (new `finalize.js` if distinct); modal display remains an injected API |
| 4508–4618 | Reset, click-outside deselection, `fillInput`, suggestion-pill bindings | Resets preview store and overlays; updates composer input and modal state | Writes `fillInput`; calls iframe `editorDeselect`, translation and reset/navigation APIs | Reset belongs to router/preview lifecycle; `fillInput` stays as compatibility wrapper; suggestion pills join chat composer |

### App extraction order (lower to higher risk)

1. Extract pure `sanitizeModelOutput`/GIF conversion helpers; verify exact return
   bytes/data URL behavior and leave the classic declarations as forwarding
   wrappers until consumer search is clear.
2. Move attachment rendering and file validation to the existing chat feature.
   The module receives `getFiles/setFiles` over the generation store; no second
   mutable file array is allowed.
3. Move screen navigation and cleanup behind an explicit router API. Its inputs
   are the relevant DOM roots, generation/outline/preview stores, and injected
   callbacks; the router must not import app-local DOM constants.
4. Extract loading controls and timer ownership. Preserve the existing timer
   handles through accessors/adapters until HTML, tests and scripts no longer
   read the legacy names.
5. Extract skeleton request/SSE handling as one owner of `skeletonController`,
   request body/headers and outline state transitions; the module gets store
   APIs, not direct mutable snapshots.
6. Extract final-generation SSE separately from its transition adapter. Keep
   response chunk cadence, watchdog, event order, sequence checks and callbacks
   byte/timing-equivalent.
7. Extract preview iframe mount/restore lifecycle and image-slot overlays as
   two modules with an explicit iframe generation token and overlay registry
   API; do not share `_overlayMap` directly across modules.
8. Extract slide navigation and zoom/fullscreen behind the existing preview
   store; maintain the legacy mirrored `currentSlide` writes at the same points.
9. Extract export finalization and reset/modal wiring last; preserve download,
   progress and error-modal behavior, and keep `window.fillInput` until all
   markup consumers are migrated.

## `src/frontend/scripts/outline.js` — 1308 lines

This classic script owns the live outline editing experience. Its primary state
is the mutable `window.outlineEditorState` facade backed by
`AedosStores.outline`; skeleton arrays and slide objects are mutated in place.
The script also shares generation attachment/controller/timer bridges with
`app.js`. New boundaries must receive `getState()`/specific mutation methods or
an explicit outline API; they must not cache a stale skeleton reference.

| Lines | Responsibility and principal functions | Shared mutable state read / written | `window.*` API used or written | Proposed destination |
|---|---|---|---|---|
| 1–143 | File chip helper, scrolling, active outline container/DOM lookup, generate-button dispatch, bubble actions and follow-up container creation | Reads/writes outline `activeContainer` and skeleton; reads chat DOM and attached files indirectly | Reads `AedosChatRenderer`, `outlineEditorState`; calls app `navigateToChat`/generation APIs | `features/outline/container.js` (new, with README), retaining container facade functions in `outline.js` |
| 144–387 | `showOutlineEditorLoading`: reset or follow-up flow, conversation bubbles, prior-outline archival, loader and uploaded-file chips | Writes `isLoading`, active container and sometimes draft; reads/writes `_attachedFiles`, `_chipsRenderTimeout`; mutates chat/outline DOM | Reads/writes `outlineEditorState`, `_attachedFiles`, `_chipsRenderTimeout`; calls `toggleGenerateLoading`, `AedosThinking`, `AedosChatRenderer`, `__t` | `features/outline/conversation.js`; receives store/file APIs and render callbacks |
| 388–580 | `parsePartialSkeleton`, `prepareOutlineStreaming`, `renderStreamingOutline`, `finalizeStreamingOutline`; incremental JSON and slide updates | Parser itself is pure; stream functions mutate skeleton/mode/maxSlides/loading and DOM | Writes `parsePartialSkeleton`, `prepareOutlineStreaming`, `renderStreamingOutline`, `finalizeStreamingOutline`; calls `renderOutlineSlides`, chips and app validation APIs | `features/outline/stream-parser.js` (pure) and `features/outline/streaming.js` (orchestrator, separate APIs) |
| 581–675 | Suggested chip rendering, delayed reveal and primary proceed shortcut | Reads outline skeleton; writes/clears `_chipsRenderTimeout`; click actions can begin final generation | Writes `renderOutlineSuggestedChips`, `_chipsRenderTimeout`; reads `__t`, calls `proceedWithCurrentOutline`, `fillInput` | `features/outline/suggested-chips.js`; inject state getter/timer scheduler and action callbacks |
| 676–846 | `initOutlineEditor`, `renderOutlineSlides`, `bindOutlineEvents`; slide title/description/type/point controls and DOM listeners | Reads/writes skeleton slides, properties and role; active DOM container | Calls `AedosOutlineRenderer`; reads `outlineEditorState`; editing remains reachable from `initOutlineEditor` facade | Existing `features/outline/slide-renderer.js` for pure markup; `features/outline/editor-bindings.js` for DOM events |
| 847–920 | Stop generation, slide-count validation and blank-slide insertion/animation | Reads/writes loading state and skeleton slide array; reads maxSlides | Writes `stopOutlineGeneration`; reads/writes `_activeGenController`; calls `renderOutlineSlides`, `renderOutlineSuggestedChips`, `validateGenerateButton` | `features/outline/slide-actions.js`, using explicit outline/generation APIs |
| 921–1009 | `addSlideWithAI`: temporary skeleton card, request/fetch lifecycle, slide append and error cleanup | Reads/writes skeleton slide array and current loading state; owns a request-local controller/timer/placeholder | Reads/writes `outlineEditorState`; invokes `AedosHttpSse`, render/actions and translation APIs | `features/outline/incremental-generation.js`; controller passed in, no shared request state outside the outline/generation stores |
| 1010–1095 | Point insertion/deletion plus slide delete/reorder operations | Mutates `skeleton.slides` and nested `points`; may rerender and change focus/scroll | Writes `addBlankPoint`, `deleteSlide`, `moveSlideUp`, `moveSlideDown` | `features/outline/slide-actions.js`, with a single store-backed mutation API |
| 1096–1157 | `resumeOutlineEditor`: restore draft controls, dropdowns, hero/loading state and outline drawer | Reads/writes skeleton/loading; updates current DOM/hero and timer values | Writes `resumeOutlineEditor`; reads `outlineEditorState`, `__t`; clears typewriter/reset/message timer bridges | `features/outline/resume.js`, called by a compatibility wrapper |
| 1158–1308 | Legacy `window` facade, `syncCustomDropdowns`, dropdown and drawer/back-button event wiring | Reads outline state and active container; aborts shared generation controller; edits drawer DOM | Defines `showOutlineEditorLoading`, `initOutlineEditor`, `resumeOutlineEditor`, slide-action globals; reads/writes `_activeGenController`; calls app navigation and translation APIs | `outline.js` remains the facade/bootstrap; dropdown wiring can move to `features/outline/dropdowns.js` with injected store/action API |

### Outline extraction order (lower to higher risk)

1. Move `parsePartialSkeleton` to a pure parser module with JSDoc input/output
   typedefs; keep `window.parsePartialSkeleton` as a forwarding wrapper.
2. Preserve and isolate the existing `AedosOutlineRenderer` contract; any
   renderer work receives a container and slide data and never mutates store
   state.
3. Extract custom dropdown presentation/bindings with `syncCustomDropdowns`
   behind explicit callbacks for slide type and outline metadata.
4. Extract suggested-chip markup and delayed reveal; inject `getSkeleton`,
   `schedule/cancel`, and click actions so the timer is not shared implicitly.
5. Extract chat bubble/container archival and file-chip presentation; pass the
   active-container and attachment APIs and preserve node placement/order.
6. Extract streaming lifecycle around the pure parser. One module owns
   `prepare → render partial → finalize`, receives the outline store, and keeps
   `window.prepareOutlineStreaming`, `renderStreamingOutline`, and
   `finalizeStreamingOutline` wrappers.
7. Extract slide rendering and edit bindings. A single outline API owns all
   mutations of the existing skeleton object; listeners resolve `dataset.index`
   against the current `getState()` result on every event.
8. Extract blank/AI slide and point/delete/reorder actions; pass request/SSE
   transport and animation callbacks, keeping controller cancellation and
   mutation ordering explicit.
9. Extract resume/stop and finish by reducing `outline.js` to orchestration and
   compatibility facades. Retain each `window.*` name until the consumer audit
   proves it unused.

## `src/frontend/editor/editor.js` — 1898 lines

`initEditor()` runs inside the generated presentation iframe and closes over
all selection, transform, lock, clipboard, observer, history and UI state. It
imports the already-extracted editor-semantics/history/selection-geometry
helpers. Parent `app.js`, tools and the mobile bridge consume its iframe
`window.*` commands; parent and iframe are separate realms. The iframe module
must keep the existing event sequence and expose a small context/API when
responsibilities move, not duplicate these mutable variables.

| Lines | Responsibility and principal functions | Shared mutable state read / written | `window.*` API used or written | Proposed destination |
|---|---|---|---|---|
| 1–120 | Iframe bootstrap, fullscreen lock, editor state, clipboard/group model | Owns lock, selected node, drag/resize coordinates, snap lines, clipboard, drag group, frozen-slide map, restore flag | Reads parent fullscreen; writes `setLocked` later in bootstrap; imports `createAedosEditorSemantics` | Keep bootstrap in `editor/editor.js`; group semantics remain in `features/editor/semantics.js` |
| 121–168 | Selection UI creation/attachment, slide-change cleanup, activation/structure observers | Owns selection box, handles, toolbar/guides and observers; reads active slide DOM | Parent document fullscreen events; no new public bridge | `features/editor/lifecycle.js`, passed iframe document and an editor-context API |
| 169–435 | Toolbar markup, property button actions, color picker and palette | Reads selected element and computed/theme styles; writes selected node styles, selection UI and history | Writes/reads internal `editableSelectors`; invokes parent image picker/event fallback | `features/editor/toolbar.js` (view/actions separated if >300 lines), inject selected-element/history/image-picker methods |
| 436–711 | Editable target traversal, semantic grouping, freeze/normalize slide layout | Reads semantic selectors/container rules and geometry; writes node positioning/normalization markers and frozen state | Writes `editableSelectors`, `freezeAllSlides` | `features/editor/normalization.js`, receiving semantics and explicit save/restore callbacks |
| 712–791 | Rectangle intersection, slide-relative geometry and drag/resize collision/clamping | Pure rectangle inputs plus slide DOM dimensions; no app store state | No public window API | Existing `features/editor/selection-geometry.js` or a sibling pure `collision-geometry.js`; keep each module under 300 lines |
| 792–927 | Pointer selection, drag-start target resolution, snapping guides and mouseup cleanup | Reads/writes selection, drag flags, snap arrays, active target/group and selection UI | Dispatches `selection-changed`; invokes internal `selectElement`/`deselectGroup` | `features/editor/selection.js` for target/selection; transform event binding stays in `features/editor/transforms.js` |
| 928–1104 | Text edit entry/blur, plain-text paste, selected image-slot picker dispatch | Reads/writes selected node/contentEditable state, selection box, history and selection | Calls parent `_triggerImagePicker`; fallback custom event | `features/editor/content-editing.js`, injecting editor context and picker callback |
| 1105–1413 | Resize-handle and mousemove transform lifecycle, collision resolution and alignment snapping | Reads/writes drag/resize coordinates, handle, active target/group, snap lines, selected node, guides and history | Dispatches/consumes editor-local events; uses selection functions | `features/editor/transforms.js`; inject get/set transform-session API rather than importing mutable closure state |
| 1414–1608 | `selectElement`, `deselectGroup`, selection box update, history creation and element duplication setup | Reads/writes selected element/observers/selection UI/restore state and undo history | Writes `editor*` selection/history bridges at end of file | `features/editor/selection.js` and existing `features/editor/history.js`; history receives explicit callbacks/context |
| 1609–1787 | Keyboard shortcut handling: copy/paste/duplicate/delete/undo/redo and keyboard movement | Reads/writes selection, clipboard, history, frozen/normalized node geometry | Bridges the same public selection/history methods; dispatches parent-visible selection events | `features/editor/keyboard.js`, passed selection/clipboard/history/layer APIs |
| 1788–1898 | Parent-facing compatibility methods, front/back z-order and arrow-move commands; auto-init | Reads/writes selected element and history; adjusts DOM order/z-index/position | Defines `editorUndo`, `editorRedo`, `editorSaveState`, `editorDeselect`, `editorUpdateSelection`, `editorGetSelection`, `editorSelect`, `isJustSelected`, `editorIsDragging`, `editorDuplicateSelection`, `editorDeleteSelection`, `toFront`, `toBack`, `editorArrowMove`, `setLocked`, `freezeAllSlides`, `editableSelectors` | Keep these as `editor.js` facade wrappers; route to selection, layer, transform and history APIs only after consumer audit |

### Editor extraction order (lower to higher risk)

1. Consolidate only pure collision/rectangle helpers with the existing geometry
   module; no DOM mutation or closure state crosses this boundary.
2. Extract semantic target predicates and selector catalogs to the existing
   semantics module; retain `window.editableSelectors` as a wrapper/value until
   parent and mobile consumers are proven migrated.
3. Extract toolbar markup as a renderer of an explicit selected-element view
   model. Do not let a renderer read the closure's `selectedElement` directly.
4. Move toolbar handlers into a separate action module receiving editor API
   methods for font size, styles, delete/duplicate and picker operations.
5. Move slide observers, UI creation and lock/fullscreen lifecycle; bind event
   order in the iframe bootstrap and pass the document/window explicitly.
6. Move text/content editing handlers behind `getSelection`, `saveState`, and
   image-picker APIs; preserve blur and paste ordering exactly.
7. Move selection and selection-box behavior with one context object that owns
   selected element/observers; parent notifications remain the same event and
   timing.
8. Move drag/resize as one transform-session owner (start coordinates, active
   target, snap arrays and flags travel together); do not split mutable session
   fields between modules.
9. Move keyboard/clipboard and layer operations last; they consume selection,
   history and transform APIs, and keep all parent-facing `window.*` wrappers
   in the iframe bootstrap until the full consumer search is clean.

## Cross-cut rules

- Every move is code relocation or dependency injection only. No change to DOM
  text/attributes, CSS, visual baselines, contracts, timer values, animation
  starts, request ordering, stream chunk cadence, or event dispatch order.
- A cut that needs shared mutable data must either be the sole owner of that
  data or consume a documented API (`AedosStores.*`, explicit getter/setter
  methods, or one editor context object). Do not make a second copy or hand a
  mutable snapshot to a long-lived listener.
- Before removing any `window.*`, search all `src/frontend/**/*.js`, HTML
  including generated/iframe templates, `docs/CONTRACTS.md`, and `tests/`;
  record the exact search scope and zero matches in the removal commit.
- New module and its folder README/JSDoc typedefs land together. Keep each
  module at no more than 300 committed lines; split a proposed responsibility
  further if the measurement would exceed that cap.
- Each extraction block is one commit followed immediately by
  `npm run verify:all`. Never refresh a baseline to make a move pass. Lint/type
  ratchets remain at or below 129/16 respectively.

## 2026-10-03: diagnóstico de los dos cortes fallidos de toolbar

Los commits descartados `0e28d88` y `675f875` se recuperaron desde el reflog y
se verificaron en worktrees aislados. El checkout limpio de Git convirtió a LF
los dos fixtures grandes de sanitización marcados `eol=lf`, mientras el checkout
compartido conservaba CRLF; por eso, la primera ejecución de cada worktree
falló antes con dos hashes distintos. No se regeneró baseline: para continuar
la reproducción se copiaron en los worktrees temporales los mismos bytes ya
presentes en el checkout compartido; los worktrees se desecharán al terminar.
Tras esa corrección de entorno, ambas ejecuciones pasaron visual 6/6, PPTX
14/14 y PDF, y fallaron en `check:editor-safety`, antes del checkpoint 09, al
esperar `window.editorSelect` durante 10 segundos en `getEditorFrame()`.

| Intento | Primer error en el flujo del editor | Evidencia |
| --- | --- | --- |
| `0e28d88` | `ReferenceError: Cannot access 'showColorPicker' before initialization` | `editor.js:121:13`, en `bindToolbarEvents`; `initEditor` falló en la inicialización y `flow-01`–`flow-08` sí habían pasado; el timeout final fue `getEditorFrame` en `check-flow.js:56`, llamado desde `runMainFlow` antes de capturar `flow-09`. |
| `675f875` | `ReferenceError: Cannot access 'isTextEditableElement' before initialization` | `editor.js:122:13`, misma llamada/orden; el wrapper perezoso de `showColorPicker` quitó el primer TDZ, pero la referencia directa a `isTextEditableElement` seguía evaluándose antes de su inicialización. Mismos checkpoints y timeout 10 s en `getEditorFrame`. |

Los errores se capturaron adicionalmente escuchando `pageerror` del iframe; el
script previo solo acumulaba los errores del page y el timeout ocultaba la
excepción original. No hay evidencia de un selector ausente, de `this` perdido
ni de una carrera de registro del listener. `ensureUI()` crea el chrome del
editor antes del binding; el binder vuelve a ejecutarse desde el lifecycle de
selección después de instalar el markup dinámico. El comportamiento original
podía cerrar sobre constantes declaradas más tarde porque las leía al disparar
el evento, ya inicializadas. Al pasar esas constantes como argumentos de una
factory extraída, JavaScript las evalúa inmediatamente en el punto de registro,
y el TDZ dispara antes de instalar/terminar la inicialización.

### Estrategia segura para continuar editor.js

No reintentar el corte monolítico de todos los bindings. Dividirlo por grupos
de controles cohesivos, cada uno en su propio corte, y conservar en el
bootstrap la llamada a registro en el mismo punto y orden actuales. El API del
módulo recibirá callbacks que consulten estado tarde (por ejemplo,
`isTextEditableElement: (...args) => isTextEditableElement(...args)` y
`showColorPicker: (...args) => showColorPicker(...args)`), nunca el valor de
una `const` todavía en TDZ. El callback solo se invoca al evento, no durante el
registro. Pasar selección, historial y acciones mediante getters/funciones
explícitos; conservar `e.currentTarget`, el orden de `addEventListener`, los
selectores y el doble momento de binding (bootstrap y actualización del markup
al seleccionar). Cada grupo debe probar tanto registro temprano como
invocación posterior y revisar que todos los handlers conservan el mismo
receptor/evento. Si un grupo falla otra vez, registrarlo como no extraído y
pasar al siguiente corte independiente.
