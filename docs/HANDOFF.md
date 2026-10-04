# Traspaso — refactorización de Aedos

Actualizado el 2026-10-03 desde `refactor/fase-7-limpieza`. No se hizo push ni
se usó la red. El código de Etapa 7 y los ratchets están en commits separados;
la verificación completa pasó después de cada uno. Tras el commit documental,
confirma la punta con `git rev-parse refactor/fase-7-limpieza` y el estado con
`git status --porcelain`.

## Cadena y estado

La cadena local completa, hashes y comandos de publicación manual están en
[`docs/PUSH-ORDER.md`](PUSH-ORDER.md). `main` (`02cc2daba769b169afe417e87e6d2dbd8b224f20`)
es solo la base y está excluida de cualquier push. Los commits más recientes de
Etapa 7 son:

| Commit | Alcance |
| --- | --- |
| `925c9e6` | Split mecánico de CSS principal, mismo orden de cascada y bytes. |
| `4351869` | Catálogo único de assets CDN/SRI; mismas versiones y orden de carga. |
| `4135498` | Extracción de decisiones de rate limit. |
| `6a65b89` | Extracción de helpers del pipeline de prompts. |
| `0baf654` | Ratchets bajados por separado a lint 129 y tipos 16. |

El commit de este documento avanza la misma rama después de `0baf654`; no se
incluye un hash autorreferencial en el propio archivo. No cambió código de
`src/` en ese commit documental.

## Estado funcional y compuertas

- Etapa 2d: la revisión local de `npm audit` registró 16 avisos (12 high,
  4 moderate) y no retuvo upgrades. El inventario, transitividad y riesgos
  major están en `docs/KNOWN-ISSUES.md`; no se volvió a ejecutar audit en Etapa 7.
- Etapa 3 / red del editor: 30 checkpoints deterministas y 13 mutaciones
  canario. En diez ejecuciones seriales frescas el 2026-10-03, nueve pasaron
  (30/30 checkpoints y 13/13 mutaciones); la tercera falló intermitentemente
  en `flow-16-editor-layer`, región `36,10`. Una corrida completa posterior de
  `npm run verify:all` sí pasó con 30 checkpoints y 13/13 mutaciones. Esta
  observación fresca supersede el registro anterior de 10/10. El detalle
  `NO cubierto` está en `docs/CONTRACTS.md`.
- Etapa 4: módulos extraídos para HTTP/SSE, stores, renderers, herramientas,
  editor y móvil; el orden de bootstrap/bridges se conserva. El inventario
  histórico está en `docs/FRONTEND-INVENTORY.md`.
- Etapa 5: ESM nativo selectivo, sin Vite. Se retiraron tres bridges internos
  del iframe para factories privados (`AedosEditorSemantics`,
  `AedosEditorHistory`, `AedosEditorSelectionGeometry`); siguen
  `window.editableSelectors` y los bridges usados por app, HTML, tools, móvil e
  iframe. `window.AedosHttpSse` sigue temporalmente como fachada compatible.
- Etapa 6: JSDoc/checkJs gradual; el frontend sigue fuera del `include` general
  de `tsconfig.json`, salvo los módulos de geometría/semántica señalados. No se
  introdujo TypeScript que requiera build de producción.
- Etapa 7: CSS split byte-idéntico, catálogo CDN, rate limiter y pipeline
  divididos; no se eliminó outline legacy ni se dividieron PPTX.

`npm run verify:all` pasó después de `4135498`, `6a65b89` y `0baf654`; los dos
últimos resultados fueron código 0. En cada pasada final: visual 6/6 capturas
con 0 píxeles distintos; las 8 mutaciones visuales dieron el resultado esperado;
PPTX 14/14 paquetes; PDF conservó sus 8 hashes de texto/estructura; flujo de
editor con providers mockeados pasó y sus 13/13 mutaciones se detectaron; lint,
typecheck y formato pasaron. PowerPoint COM se omitió porque no está instalado.
No hubo llamadas reales a proveedores.

## Medidas de fuentes

Todas las cifras siguientes se midieron con `git show <commit>:<archivo> | wc
-l`, no con el árbol de trabajo:

| Archivo | `main` (`02cc2da`) | cierre 4d (`2fd866a`) | fase 6 (`3e466ce`) | etapa 7 código (`0baf654`) |
| --- | ---: | ---: | ---: | ---: |
| `src/frontend/scripts/app.js` | 4,916 | 4,632 | 4,618 | 4,618 |
| `src/frontend/scripts/outline.js` | 1,369 | 1,308 | 1,308 | 1,308 |
| `src/frontend/editor/editor.js` | 2,205 | 1,894 | 1,898 | 1,898 |

Otras medidas de cierre:

- CSS original en fase 6: 4,038 líneas, 93,300 bytes. La concatenación en el
  orden `foundation`, `chat`, `settings`, `dialogs`, `preview`, `workspace`
  tiene SHA-256 `85fdf3cf4d79ea40f67e5a2f5352fa40a153d2cb0c9b5f7f2dbcbf7c3cb90db3`
  y 93,300 bytes, idéntica al original. Las seis capturas se mantuvieron en
  0 diferencias.
- `server.js`: 424 líneas en `refactor/fase-3c-fix` (`67d248b`); 427 en los
  commits posteriores/currentes. El delta (+3 neto) es el middleware de errores
  Multer de `459c932`, no una refactorización de Etapa 7.
- Rate limiter: `rate-limiter.js` 545 → 334 líneas y nuevo
  `rate-limit-evaluators.js` 252.
- Pipeline: `prompts/pipeline.js` 489 → 165 líneas; nuevos
  `json-extraction.js` 124, `stage-runner.js` 166 y
  `skeleton-enrichment.js` 61. Los cuerpos ejecutables trasladados se
  compararon con el blob anterior; los prompts no se editaron.
- `utils/pptx-export.js` sigue en 792 líneas y `export/pptx-renderer.js` en
  1,258: se aplazaron por acoplamiento de serialización/DOM y riesgo sobre el
  baseline de paquetes.
- Ratchets al entrar a Etapa 7: lint 132, TypeScript 29. Tras el refactor:
  lint 129, TypeScript 16. Los dos baselines se bajaron solo en `0baf654`, en
  commit separado, y después se volvió a ejecutar `verify:all`.

## ESM, globals y rendimiento

En la medición registrada de siete muestras, la mediana hasta mostrar el chat
(FCP) fue 108 ms antes de migrar editor + HTTP/SSE a ESM y 128 ms después: +20
ms (+18.5%). No se atribuye causalidad a una sola capa y no se añadió Vite. Un
intento de migrar renderers a ESM (`df02cd2`) falló el harness porque esperaba
`renderSlides`; se revirtió íntegramente en `55274ce`. Las rutas y carga actual
se sirven sin build.

Medición comparativa fresca con Puppeteer, cinco muestras por árbol, servidor
HTTP estático local y requests externos abortados: `main` 1016/100/92/108/92 ms
(mediana 100 ms); Fase 7 112/108/112/112/108 ms (mediana 112 ms). El primer
FCP de `main` fue un arranque frío atípico. Este harness mide la pintura inicial
de `#chat-screen`, no la disponibilidad del backend, y no es directamente
comparable con la medición histórica de siete muestras.

La auditoría actual sin red (`npm audit --offline --json`) salió con código 0 y
metadatos locales en cero; esto no renueva la base de avisos del registro. La
última auditoría conectada documentada para Etapa 2d encontró 16 avisos
(12 high, 4 moderate), que continúan pendientes sin upgrades runtime retenidos.
El árbol Git local mide 6,763,349 bytes de blobs rastreados en HEAD; `.git`
ocupaba 7,225,673 bytes en la inspección actual.

Los helpers internos ya no globales tienen test de ausencia; los bridges
observables están enumerados en `docs/CONTRACTS.md`. Los usuarios HTML/iframe,
`app.js`, `outline.js`, tools y móvil son la razón para no borrar los globals
públicos restantes.

## Pendientes y decisiones que requieren aprobación

- El usuario debe publicar manualmente las ramas usando `docs/PUSH-ORDER.md`.
  No se comprobó GitHub Actions para la punta final. CI remoto y smoke test
  controlado con proveedores reales siguen pendientes del usuario; no se
  contactaron proveedores durante este trabajo.
- Continúan 16 hallazgos de `npm audit`; alinear el Motion npm/CDN requeriría
  cambiar la versión cargada. Hace falta aprobación y una comprobación completa
  de baselines antes de cualquiera de esos cambios.
- Vite no se aplicó: requiere confirmar hosting/rutas públicas/iframe y volver a
  medir FCP. La mediana observada empeoró 20 ms después de ESM.
- El split adicional de `utils/pptx-export.js` y `export/pptx-renderer.js` queda
  para una decisión con un seam de serialización medible; no se arriesgó el
  baseline PPTX de 14 paquetes.
- `#outline-legacy-container` sigue en el DOM y tiene consumidores JS/DOM
  (`outline-edge-tab`, `legacy-outline-title-input`, `btn-add-slide-ai`,
  `outline-empty-state`, `outline-slide-count`); su eliminación necesita una
  auditoría y autorización aparte.
- La baseline visual no es una garantía matemática para cualquier cambio
  subumbral; sí detectó las seis mutaciones intencionales de UI y dejó pasar el
  control de comentario CSS. Máscaras actuales: ninguna.
- `check:editor-safety` no cubre aún reorder por drag-and-drop, tema dentro del
  preview, providers reales/fallo midstream, exportación real dentro del flujo
  del editor ni zoom fullscreen; detalles en `docs/CONTRACTS.md`.

El escáner de `require` literal desde `server.js` alcanzó 56/57 módulos backend;
el único archivo no alcanzado es `contracts/types.js`, typedef puro permitido.
No hay módulos nuevos huérfanos. `tmp/` no tiene archivos rastreados; no se
borraron artifacts ignorados del usuario.

## Etapa 8 — cierre parcial (actualizado 2026-10-03)

La continuación avanzó hasta `refactor/fase-8d-editor` (`669d83a`). La Etapa 8d
no se completó: las extracciones intentadas para reducir `editor.js` tuvieron
que revertirse tras fallar `verify:all`; los dos intentos más recientes de
extraer los bindings de toolbar tampoco quedaron verdes. De acuerdo con la
compuerta de dos intentos, el trabajo de código se detuvo. Una reproducción
diagnóstica local posterior sí observó `EDITOR_READY` y no encontró excepción
de inicialización del iframe; solo apareció un error de consola de recurso
bloqueado por el interceptor. Esto no identifica la causa de los timeouts del
gate y no se considera explicación concluyente.

Cadena local, sin push:

| Rama | HEAD | Resultado relevante |
| --- | --- | --- |
| `refactor/fase-7-limpieza` | `e472f37` | Base de esta ejecución |
| `refactor/fase-8a-red-estable` | `565a8f0d296fa85b1ec92ba1a08c24dc7c74c9e6` | Safety estabilizado; verify verde |
| `refactor/fase-8b-inventario` | `a1cd537d6190c81aeb8027c378e7c31a0d5bb9f7` | Inventario y parser streaming extraído |
| `refactor/fase-8c-outline` | `d730eea` | Outline dividido; ratchet actualizado |
| `refactor/fase-8d-editor` | `669d83af7896db0d4ccad5c96f6f67366a8861fc` | Editor parcialmente dividido; varias extracciones revertidas |

Los hashes de ramas 8a–8c y la secuencia histórica indicada arriba proceden del
handoff anterior; la rama 8d y el HEAD aquí registrados corresponden a la
continuación actual. No se hizo push.

Commits relevantes en 8c:

- `931fa1f` extrajo el render de streaming; `verify:all` pasó.
- `1cdff5e` extrajo el render de chips; `verify:all` pasó.
- `4d93187` intentó extraer bindings de edición. `verify:all` falló con
  `Lint ratchet increased: rules= files=src\frontend\features\outline\editor-bindings.js`.
  ESLint aislado mostró `max-lines-per-function`: `bindEvents` tenía 136 líneas
  frente al máximo 80. Revertido por `86526a1`; el verify del revert pasó.
- `c7d3c7c` separó el binding en helpers sin avisos ESLint, pero el sentinel
  `outline-title` falló antes de calidad: `Mutation anchor not found in
  /scripts/outline.js: slides[idx].title = e.target.value;`. El probe de
  `scripts/editor-safety/mutation-probes.js` aún esperaba el código en el archivo
  antiguo, cuando ya vivía en el módulo nuevo. Revertido por `7df2590`; su
  `verify:all` pasó. La próxima ejecución autorizada debe actualizar primero el
  probe para mutar y verificar el módulo extraído, y volver a comprobarlo antes
  de crear otro commit.

Los verifies exitosos de esta cadena acabaron en código 0, lint 129, tipos 16 y
formato correcto. En 8c, el último verify fue el del revert `7df2590`; en 8d,
el último verify fue el del revert `669d83a`. No se tocaron
baselines. La verificación incluye solo providers simulados/locales; no hubo
llamadas reales ni acceso a red externa. No se leyó `.env`.

Medidas actuales de archivos obtenidas con `git show <ref>:<archivo> | wc -l`:

| Archivo | Inicio 8a (`565a8f0`) | HEAD 8d (`669d83a`) |
| --- | ---: | ---: |
| `src/frontend/scripts/app.js` | 4,618 | 4,618 |
| `src/frontend/scripts/outline.js` | 1,308 | 230 |
| `src/frontend/editor/editor.js` | 1,898 | 660 |

En HEAD 8d, `outline.js` mide 230 líneas y cumple el objetivo ≤300. Los globals legacy
`window.parsePartialSkeleton`, `window.renderStreamingOutline` y
`window.renderOutlineSuggestedChips` se conservaron como fachadas; no se eliminó
ningún `window.*`. El helper `addSlideWithAI` sigue definido localmente, pero la
búsqueda en el repo encontró solo su declaración y el botón `#btn-add-slide-ai`
en HTML, sin llamada ni listener encontrado. No se extrajo código inalcanzable
a un módulo; decidir si retirar ese helper o reconectar el botón queda pendiente.

La Etapa 1 terminó con 30/30 ejecuciones consecutivas de
`npm run check:editor-safety` en verde y 13/13 sentinels detectados. La Etapa 2
está documentada en `docs/FRONTEND-INVENTORY.md`. Pendiente al reanudar: resolver
la causa de los fallos intermitentes del editor-safety gate en las extracciones
de toolbar, completar `editor.js` ≤300, extraer `app.js` hasta ≤400, actualizar
`docs/ARCHITECTURE-FRONTEND.md`, `docs/CONTRACTS.md` y `docs/PUSH-ORDER.md` para
la cadena final. La Etapa 8e no se inició. Push, CI de GitHub, smoke test con
providers reales y `npm audit` conectado continúan pendientes del usuario/
entorno. Ratchets actuales: lint 119 y tipos 16; el último `verify:all` tras el
revert `669d83a` terminó en código 0 con baselines y pruebas aprobadas. La
reproducción diagnóstica de iframe no modificó archivos.

## Continuación Etapa 8 — 2026-10-04

Trabajo local sin push ni red, en `refactor/fase-8e-app`, creado desde el estado
verificado `refactor/fase-8d-editor` (`97168e4`). No se leyó `.env`, no se
hicieron llamadas reales a proveedores y no se añadieron dependencias. Este
tramo es parcial: la meta de ≤300 líneas para `editor.js` y ≤400 para `app.js`
no se alcanzó; el inventario actualizado y las razones están en
`docs/FRONTEND-INVENTORY.md`. No se regeneró ninguna baseline.

### Ramas 8a–8e

| Rama | Hash de referencia al cierre | Estado |
| --- | --- | --- |
| `refactor/fase-8a-red-estable` | `565a8f0d296fa85b1ec92ba1a08c24dc7c74c9e6` | Base anterior, Etapa 1 |
| `refactor/fase-8b-inventario` | `a1cd537d6190c81aeb8027c378e7c31a0d5bb9f7` | Base anterior, inventario |
| `refactor/fase-8c-outline` | `d730eeabf3d144f5d71273b1dc0b3abffcd3dc75` | Base anterior, outline |
| `refactor/fase-8d-editor` | `97168e4f54f1d6f704a0700f9d5d43b608882d53` | Base verificada antes de nuevos cortes |
| `refactor/fase-8e-app` | `523464fb98da490855dbbe02c46ce56aff4f0a93` | Código verificado antes del cierre documental |

El commit documental que actualiza este handoff avanzará el HEAD de 8e; como
un documento no puede contener su propio hash, la punta publicable exacta es el
resultado de `git rev-parse refactor/fase-8e-app` al terminar.

### Medidas y módulos

LOC medidos con `git show <ref>:<archivo> | wc -l`:

| Archivo | Inicio 8d (`d7c69cc`) | Código verificado 8e (`523464f`) |
| --- | ---: | ---: |
| `src/frontend/scripts/app.js` | 4,618 | 4,492 |
| `src/frontend/scripts/outline.js` | 230 | 230 |
| `src/frontend/editor/editor.js` | 660 | 582 |

Módulos nuevos del tramo (todos <300 líneas):
`editor/toolbar-size-events.js` (23), `toolbar-action-events.js` (57),
`toolbar-swatch-events.js` (32), `mouseup-cleanup.js` (37),
`font-size-actions.js` (28), `shared/content-utils.js` (55),
`app/tooltips.js` (57). Sus READMEs quedaron en cada carpeta.

### Cortes completados y pendientes

- Diagnóstico de toolbar documentado: los dos fallos descartados fueron TDZ por
  evaluar referencias `const` tardías al registrar listeners; no fue un `this`,
  selector, iframe-ready ni orden de listener roto. Se extrajeron size/action/
  swatch bindings, cleanup mouseup y font-size actions con callbacks explícitos.
- App: utilidades compartidas (sanitización/GIF) y tooltips extraídos, dejando
  sus aliases globales y el punto original de registro de tooltips.
- `editor.js` queda en 582 líneas. No se extrajo el bloque body/selection
  pointer-event (mousedown/mousemove/resize): drag, resize, normalización,
  selección, snap guides, historial y flags comparten más de una docena de
  valores léxicos. Un corte mecánico sin un contexto getter/setter probado
  podría cambiar orden de eventos o capturar un snapshot. Es el siguiente corte
  que requiere diseñar/testear un único API de estado explícito.
- `app.js` queda en 4,492 líneas. Solo se extrajeron 2 de los 18 cortes
  inventariados; dropdowns, router/adjuntos, SSE, transición preview, zoom,
  overlays, navegación y exportación siguen en el orquestador porque comparten
  stores, DOM, timers/controllers y bridges. No se eliminaron globals.
- Conservados: `window.sanitizeModelOutput`, `window.gifToStaticDataUrl`,
  `window.AedosContentUtils`, `window.AedosAppTooltips`, todas las fachadas de
  editor, outline, preview, navegación y generación. Ningún `window.*` existente
  se retiró; los dos nuevos namespaces son aditivos.
- Ratchets antes/después: lint `119 → 119`; typecheck `16 → 16`.

### Compuertas verificadas

`npm run verify:all` terminó en código 0 tras cada commit: `a0d830a`, `d6ffaed`,
`f65a134`, `79eb502`, `97168e4`, `3d3da98`, `f15a8b9`, `e165685` y `523464f`.
En los resultados recientes: visual 6/6, 8/8 mutaciones visuales, PPTX 14/14,
PDF con 8 páginas/hashes estables, editor safety browser flow en verde y 13/13
sentinels, lint 119, tipos 16 y formato correcto. PowerPoint COM se omitió por
requerir Windows/PowerPoint. Son pruebas locales con providers simulados; no
son CI de GitHub ni un smoke test de IA real.

Antes de cerrar, ejecutar las 10 corridas seriales requeridas de
`npm run check:editor-safety` y registrar el resultado real. Pendientes del
usuario/entorno: push manual, CI de GitHub, smoke test con IA real y `npm audit`
con red. No publicar `main`, tags ni usar force.
