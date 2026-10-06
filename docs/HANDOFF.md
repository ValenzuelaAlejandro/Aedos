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
| `refactor/fase-8e-app` | `32a3980` | Cierre documental previo al resultado 10/10 |

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

Diez corridas seriales consecutivas de `npm run check:editor-safety` terminaron
en código 0 (10/10): cada una pasó el browser flow, `flow-16-editor-layer`
marcó 0 píxeles distintos y detectó 13/13 sentinels. Logs temporales locales:
`%TEMP%\aedos-editor-safety-1.log` a `%TEMP%\aedos-editor-safety-10.log`.

Pendientes del usuario/entorno: push manual, CI de GitHub, smoke test con IA
real y `npm audit` con red. No publicar `main`, tags ni usar force.

## Reanudación desde 8e — estabilidad de captura (2026-10-04)

Continuación local desde `refactor/fase-8e-app` en `831c18414d247fbfc5e8a072dbf7958f9de72ad8`. No se leyó `.env`, no se usó red ni se contactaron proveedores reales; no se tocaron `src/` ni baselines.

Diagnóstico sobre el HEAD inicial:

- `npm run check:editor-safety`: 20 corridas iniciales, 19 pasaron y 1 falló en `flow-14-editor-redo`. La salida del comparador informó 0 píxeles sobre umbral, distancia regional máxima 41.6, región `0,9`; el análisis RGB exacto encontró 28 píxeles no idénticos, acotados al borde/sombra del thumbnail activo. Capturas del actual, baseline y diff: `%TEMP%\aedos-stage0-visual-831c184\flow-14-editor-redo-{actual,baseline,diff}.png`.
- `npm run check:baseline:visual`: 20/20 corridas; seis capturas aprobadas en cada una. `flow-01-landing` no falló en esta serie y no requirió cambios.
- La espera previa de iframe load, fuentes del iframe y dos frames no comprobaba que el tile anfitrión del minimapa hubiera estabilizado su geometría/estilo tras refrescar el thumbnail. En `scripts/editor-safety/check-flow.js`, la espera aguarda también `document.fonts.ready` del documento anfitrión y tres frames consecutivos con geometría, transformación, opacidad, borde y sombra idénticos para el tile. No hay sleeps, tolerancias nuevas ni regeneración de imágenes.
- Confirmación posterior al cambio: `npm run check:editor-safety` 20/20 en verde; cada corrida pasó todos los checkpoints y detectó 13/13 sentinels. Logs: `%TEMP%\aedos-stage0-fixed-831c184\editor-safety-1.log` a `editor-safety-20.log`.
- Se revirtió el primer commit del harness (`4224910`) porque `verify:all` detectó dos `no-undef` (`requestAnimationFrame`) y el ratchet subió a 121. La declaración del global se añade en el reintento. La reversión `f13d619` pasó `verify:all` con lint 119, tipos 16 y formato correcto.
- Durante la exploración se probó y descartó una espera visual global: tres ejecuciones capturaron incorrectamente el panel de herramientas en `flow-13-editor-undo` (140276 píxeles, 10.8238%, región 41,9). El estado de DOM/estilos no representaba el compuesto del screenshot. Ese helper global no está en el cambio final; capturas: `%TEMP%\aedos-stage0-visual-831c184\flow-13-editor-undo-{actual,baseline,diff}.png`.

Este cambio fue exclusivamente de sincronización del harness. Se registra debajo el resultado de la continuación.

### Ejecución posterior — editor/app y cierre (2026-10-04)

El corte de cálculo de snap guides quedó en `bb44e47` (`refactor(editor): extract snap guide calculation`). El intento `819ae70` falló en los loaders VM con `SyntaxError: Cannot use import statement outside a module`; fue revertido en `1facf87` y el `verify:all` del revert pasó. Se adaptaron los loaders de drag/resize para inyectar el módulo en el sandbox y se volvió a aplicar el corte. Pruebas enfocadas y `verify:all` pasaron. La función conserva el orden de candidatos/targets, tolerancia estricta y desempate. No hubo cambios en CSS, markup o eventos.

Diez ejecuciones seriales finales de `npm run check:editor-safety`: 10/10 códigos 0, todas con “Editor safety browser flow passed” y 13/13 sentinels. Logs fuera del repo: `%TEMP%\aedos-stage8e-final-editor-safety\run-1.log` a `run-10.log`.

Tamaños en refs de código `831c184` → `bb44e47`, mediante `git show <ref>:<archivo> | wc -l`: `src/frontend/editor/editor.js` 457 → 457; `src/frontend/scripts/app.js` 4,492 → 4,492. Objetivos ≤300/≤400 no alcanzados. El store `pointer-state.js`, targets y módulos de drag/resize ya existían; el nuevo `snap-guide-calculation.js` tiene 26 líneas. La coordinación del listener de movimiento (normalización, selección, transformaciones e historial) permanece en el editor.

El router fue el primer corte app considerado, pero no se extrajo ni se reporta como fallo de test: la acción de volver a home reinicia conjuntamente DOM, stores/draft, adjuntos, generación y transición pendiente, y no hay API explícita verificada para conservar identidad/orden. Por ese motivo los demás cortes de app (adjuntos, overlays, navegación, zoom, exportación, preview, chat/renderizado, transición, SSE y orquestación) tampoco se ejecutaron. Sus fronteras y causa de riesgo están en `docs/FRONTEND-INVENTORY.md`. `window.*` no se eliminó.

## Continuación autónoma Etapa 9 (2026-10-04, parcial)

### Ramas locales

Se parte de `refactor/fase-8e-app` en `2ebf64c`. Rama 9a: `refactor/fase-9a-app-estado`; rama 9b: `refactor/fase-9b-app-bloques`; rama 9c actual: `refactor/fase-9c-editor`. Tras los commits de estado, `dc2c832` es la punta de 9a y la base con que se crearon 9b y 9c. No se hicieron commits de extracción en 9b/9c durante esta ejecución y no se hizo push. Este commit documental actualizará únicamente la punta de 9c; confirma los refs con `git rev-parse` al terminar.

### Cortes 9a ejecutados y compuertas

| Commit | Corte | Resultado de `npm run verify:all` | Ratchets medidos |
| --- | --- | --- | --- |
| `ff0e2f3` | Inventario estado app | Pasó | 119 / 16 |
| `7160b31` | Grupo de mensajes/timers de botón de generación | Pasó | 119 / 16 |
| `f16d863` | Estado de placeholder y warmup del input | Pasó | lint 117 / tipos 16 |
| `d4cf892` | Baseline lint reducida en commit separado | Pasó | 117 / 16 |
| `87acebd` | Estado mutable de navegación/cooldown/swipe | Pasó | 117 / 16 |
| `4f63ea3` | Constantes y fallback de viewport/zoom | Pasó | 117 / 16 |
| `5412b9d` | Flags de lifecycle preview/minimap | Pasó | lint 115 / tipos 16 |
| `dc2c832` | Baseline lint reducida en commit separado | Pasó | 115 / 16 |

Las pruebas editor-safety y visuales se mantuvieron en verde en las compuertas;
mutaciones editoriales detectadas: 13/13. La verificación PPTX reportó 14
paquetes OK y PDF igual a su manifiesto. PowerPoint COM no está disponible en
este entorno. No se regeneraron baselines visuales/PDF/PPTX. Una ejecución
manual de `npx eslint src/frontend/scripts/app.js` mostró 5 errores en otras
zonas del archivo (`no-useless-assignment` y `no-useless-escape`); el
ratchet oficial de lint siguió pasando con 115 advertencias. No se atribuyen al
corte de navegación.

### Límites y pendientes de refactor

Estado de `app.js` movido a `chatState`, `navigationState`, `zoomState` y
`previewUiState`, sin mover funciones ni quitar `window.*`. No se completó la
migración de todas las variables del callback ni el `dom` único; faltan estado
de router/adjuntos/SSE/overlays/exportación/tema y consultas DOM cacheadas.
`app.js` y `editor.js` no alcanzan ≤400/≤300 líneas. No se ejecutaron cortes de
bloques en 9b ni de editor en 9c. Por lo tanto esta entrega es un avance
verificado, no la finalización de la refactorización pedida. La estrategia
segura pendiente es extraer primero stores/estado y una API explícita de DOM,
y solo luego bloques como factories `createX(ctx)` en su punto original de
registro, con un gate completo por commit.

Medidas con `git show <ref>:<archivo> | wc -l`: desde `2ebf64c`,
`src/frontend/scripts/app.js` 4,492 → `dc2c832` 4,497; el crecimiento neto de
5 líneas corresponde a los objetos de estado, no a una extracción de funciones.
`src/frontend/editor/editor.js` permanece 457 → 457.

Validación actual: 10 ejecuciones seriales nuevas de `npm run
check:editor-safety` sobre el código de la punta `dc2c832`, 10/10 en verde;
cada ejecución completó el flujo browser y detectó 13/13 sentinels. Logs:
`%TEMP%\aedos-stage9-editor-safety\run-1.log` a `run-10.log`. Los únicos
cambios posteriores a esa validación son documentación.

Push manual, CI de GitHub, smoke test con IA real y `npm audit` con red dependen
del usuario. No hubo push, llamadas reales a proveedores ni acceso a `.env`.

| Commit | Resultado de su compuerta |
| --- | --- |
| `4224910` | Primer intento de estabilidad; `verify:all` detectó lint 121 por `requestAnimationFrame` no declarado. Revertido. |
| `f13d619` | Revert anterior; `verify:all` pasó con lint 119/tipos 16. |
| `da491ef` | Espera determinista focalizada del tile de minimapa; `verify:all` pasó y 20/20 editor-safety quedó verde. |
| `819ae70` | Primer intento del cálculo snap; verify falló por import ESM no transformado en loaders VM. |
| `1facf87` | Revert del intento snap; `verify:all` pasó. |
| `bb44e47` | Reintento con loaders VM adaptados; pruebas enfocadas y `verify:all` pasaron. |

En la compuerta final: visual 6/6, mutaciones visuales 8/8, PPTX 14/14, PDF,
editor safety browser flow y 13/13 sentinels, lint 119, tipos 16 y formato
correcto. PowerPoint COM no corrió (requiere PowerPoint). Variaciones regionales
pequeñas que pasaron: `mobile-light` RGB 9.3, `flow-19` RGB 10.3, `flow-20`
RGB 9.9, con cero píxeles sobre umbral. No se modificaron tolerancias ni
baselines.

Pendientes: terminar los cortes editor/app; push manual (no realizado), CI de
GitHub, smoke test con IA real y `npm audit` con red. No se leyó `.env`, no se
usó red, no hubo proveedores reales, dependencias nuevas ni `npm audit fix`.

## Continuación fase 10: bloques verticales (2026-10-04)

Base: `refactor/fase-9c-editor` en `c884fd8`. Ramas locales creadas en cadena:
`refactor/fase-10a-app-bloques` (`dfa026778b9614b77a9fc66657911a8af56aef9b`)
y `refactor/fase-10b-editor` (punta de código `ff46ad93e21bfd92535358a9fe2b271cd11ce9fb`; este cierre documental va en un commit posterior).
No hubo push ni uso de red.

Mediciones de blobs con `git show <ref>:<archivo> | wc -l`:

| Archivo | Inicio `c884fd8` | Punta 10a | Punta de código 10b |
|---|---:|---:|---:|
| `src/frontend/scripts/app.js` | 4,497 | 2,765 | 2,633 |
| `src/frontend/editor/editor.js` | 457 | 457 | 353 |

Se redujeron 1,864 líneas netas de `app.js` y 104 de `editor.js`. No se llegó
a ≤400/≤300. Se extrajeron router, adjuntos, sub-bloques de overlays, zoom,
navegación, exportación, varios bloques de preview, entrada/loading del chat;
en editor, bindings de puntero, contenido, toolbar y lock/fullscreen. Permanecen
mensajes/renderizado, transiciones, `handleGenerate` y `startFinalGeneration`
(incluido SSE), el lifecycle principal del iframe, parte de image-slots y la
orquestación/reset. Sus closures interconectan stores, controllers, iframe
actual, `window.*`, orden de timers/eventos y callbacks asíncronos; no se forzó
el límite de líneas. El detalle de módulos y razones está en
`docs/FRONTEND-INVENTORY.md`.

Módulos nuevos de esta continuación (líneas del blob HEAD, cada uno ≤300):

| Módulo | Líneas |
|---|---:|
| `features/chat/attachments.js` | 244 |
| `features/chat/input-controller.js` | 95 |
| `features/chat/loading-controller.js` | 182 |
| `features/preview/overlay-style.js` | 126 |
| `features/preview/overlay-labels.js` | 108 |
| `features/preview/zoom-controls.js` | 76 |
| `features/preview/slide-navigation.js` | 132 |
| `features/export/export-actions.js` | 83 |
| `features/preview/slide-input.js` | 167 |
| `features/preview/slot-image-replacement.js` | 45 |
| `features/preview/overlay-positioning.js` | 76 |
| `features/preview/state-restore.js` | 132 |
| `features/preview/iframe-scale.js` | 165 |
| `features/preview/carousel-layout.js` | 111 |
| `features/preview/layout-settler.js` | 50 |
| `features/preview/interactions.js` | 228 |
| `features/app/router.js` | 252 |
| `features/editor/pointer-interactions.js` | 113 |
| `features/editor/content-bindings.js` | 66 |
| `features/editor/toolbar-bindings.js` | 61 |
| `features/editor/lock-lifecycle.js` | 34 |

Los `window.*` existentes se conservaron. Se añadieron los bootstraps
`window.AedosChatInput` y `window.AedosChatLoading`; ningún global legacy fue
eliminado. Ratchets medidos en los blobs: inicio lint 115 / tipos 16; final lint
91 / tipos 16. El baseline de lint bajó solo de 92 a 91 en el commit separado
`ff46ad9`; tipos permaneció igual.

### Gates de código

`verify:all` pasó en cada commit aceptado, salvo donde se indica. Los commits de
baseline de lint fueron commits separados y también tuvieron gate completo.

| Commits | Resultado real de `verify:all` |
|---|---|
| `c43d22e`, `dbc4cce`, `96a53c1`, `bab3f6d`, `14c02d4`, `abf5153`, `4073fc5`, `1cae126`, `7d8ae9c`, `8aac3e9` | Pasó |
| `41697ba` | Falló: sentinel `app-preview-render` no encontró el ancla `doc.write('<!DOCTYPE html>' + html);` en el source servido |
| `9e9f2cf` | Reversión del intento; pasó |
| `0e75dc6` | Falló el mismo sentinel de preview (`scripts/editor-safety/runtime.js:89`; sonda `mutation-probes.js:84`) aunque el ancla estaba inline |
| `03ad83e` | Reversión del intento; pasó |
| `468d92c` | Pasó |
| `fb96fef` | Falló visualmente: `presentation-iframe-desktop`, 30 píxeles (0,0023%), tile 30,0, máxima distancia RGB 252,9 |
| `7854923` | Reversión; pasó |
| `bbb3da0`, `c3be855`, `2744a30`, `9164bbd`, `536a422`, `21bdc05`, `9df3d20`, `301382c`, `dfeeedc`, `10388a6`, `2d1e90e`, `73d43ff`, `dfa0267` | Pasó |
| `391d3eb` | Pasó al repetir tras checkpoint visual pequeño de `flow-19-editor-minimap`: 120 px (0,0093%), region 2,11; hubo pasadas verdes posteriores, sin cambios de tolerancia/baseline |
| `24736b4` | Pasó |
| `0b0e902`, `0309df2` | Pasó |
| `d5c84f4` | Falló (no visual): `Cannot read properties of undefined (reading 'activeElement')`; binding de teclado omitió `document` al delegar |
| `167a395` | Reversión obligatoria del corte fallido; pasó |
| `a9056a7`, `ff46ad9` | Pasó |

La `check:editor-safety` en serie terminó con 10 ejecuciones consecutivas
verdes (cada una browser flow OK y sentinels 13/13). Logs fuera del repo:
`%TEMP%\aedos-phase10-editor-safety-final-1.log` a `-10.log`. Hubo una corrida
preliminar previa que falló solamente en `flow-19-editor-minimap` con 120 píxeles
(0,0093%), región 2,11; la corrida verde siguiente y las diez consecutivas
reportaron 0 píxeles distintos en el minimapa. No se cambiaron baselines,
máscaras ni tolerancias.

El gate final reportó lint 91, tipos 16, formato correcto, PPTX baseline 14/14,
PDF idéntico, editor safety y sentinels 13/13. La verificación de render COM se
omitió porque requiere PowerPoint. Las llamadas de proveedor permanecieron
mockeadas/abortadas. Pendientes del usuario: push manual de las ramas, CI de
GitHub, smoke test con proveedor IA real y `npm audit` con red. No se modificó
`src/backend`, no se leyeron `.env`/claves, no se instalaron dependencias y no
se ejecutó `npm audit fix`.

Comando de push solicitado (no ejecutado):

```powershell
git branch --format="%(refname:short)" --list "refactor/*" | ForEach-Object { git push -u origin $_ }
```

## Cierre 10b: extracciones verticales (2026-10-05)

Este cierre supersede los estados parciales descritos arriba. Rama actual
`refactor/fase-10b-editor`; último commit de código/test verificado
`ba52e3f2e3144bd4100a0eaeccd636bb557fa09d`. El commit documental presente
avanza la rama; resuelve el tip final con `git rev-parse refactor/fase-10b-editor`.
La cadena local es `refactor/fase-10a-app-bloques`
(`dfa026778b9614b77a9fc66657911a8af56aef9b`) →
`refactor/fase-10b-editor` (`ba52e3f2e3144bd4100a0eaeccd636bb557fa09d`). No se
hizo push ni se usó red.

Tamaños tomados de blobs con `git show <ref>:<archivo> | wc -l`:
`app.js` 4.492 (`05f4322`) → 400; `editor.js` 582 (`05f4322`) → 286. Ambos
objetivos (≤400 y ≤300) se alcanzaron. Los ocho últimos cortes de app redujeron
845 líneas desde 1.245 en `9c10f95`; el detalle y las líneas de todos los
módulos nuevos están en `docs/FRONTEND-INVENTORY.md`. No se eliminó ningún
`window.*`; se conservaron las fachadas, el orden de instanciación, listeners,
timers y callbacks. Lint descendió 119 → 57 y typecheck se mantuvo en 16.

La investigación del checkpoint de tema vacío encontró dos condiciones de
captura: el baseline conserva el foco de `#w-tema` (`autofocus`) y oculta el
cursor decorativo `.hero-cursor`. El test ahora afirma el foco esperado y oculta
solo ese cursor, igual que el capturador de landing. Un desenfoque produjo un
segundo diff con el cursor visible, por lo que no se adoptó. No se cambió código
de producto, baseline, máscara ni tolerancia. La ejecución aislada y el gate
completo dieron 0 píxeles distintos en ese checkpoint. Luego se ejecutó
`npm run check:editor-safety` diez veces seguidas: 10/10 pasaron; cada corrida
confirmó browser flow correcto y 13/13 sentinels detectados.

Verificaciones completas confirmadas en commits aceptados de 10b: `a9056a7`,
`149d3db`, `c4144ba`, `0878482`, `1d6d7d6`, `2ac0ef5`, `ad3ec05`, `9ba6590`,
`a5121af`, `b5e1d06`, `b5bfe84`, `56b2fe1`, `3a6e0c8`, `1187dd7`, `de16bec`,
`263d5df`, `1708d86`, `e80f126`, `9ad7a66`, `d3486df`, `ccbd86d`, `a0249fb`,
`8ace056`, `cb4d3b8`, `9c10f95`, `aedac40`, `d151196`, `baa7642`, `47aa1c3`,
`920b2c7`, `e80ea13`, `cd77b56`, `70baf76`, `3870658`, `ba52e3f`:
`npm run verify:all` pasó después de cada commit aceptado. Gates finales:
PPTX 14/14, PDF baseline idéntica, visual/editor safety aprobados, lint 57,
tipos 16 y Prettier correcto. Ver render COM se omitió porque PowerPoint no
está instalado. Proveedores mockeados; solicitudes externas abortadas.

Intentos fallidos de cortes fueron revertidos y luego resueltos con pruebas
adaptadas: `fb12543`/`858c199` y `f8443b9`/`b658194` (sentinels skeleton/SSE),
`97840ee`/`41b1d96` (assertion de setup preview) y
`34cce6c`/`0def295` (mutation probe de validación). Otros diagnósticos: falta de
`G_FONTS` en preview-loading, límite `max-lines` del test de buffer, loader VM
incompatible con `import` ESM en snap, y wrapper de teclado sin `document`
(`activeElement` indefinido). Ninguno quedó en HEAD.

Pendiente del usuario: publicar manualmente las ramas; comprobar CI de GitHub;
smoke test con proveedor IA real; correr `npm audit` con red. No se leyeron
`.env`/claves, no se llamó a proveedores reales, no se agregaron dependencias y
no se ejecutó `npm audit fix`.

Comando de push (solo referencia, no ejecutado):

```powershell
git branch --format="%(refname:short)" --list "refactor/*" | ForEach-Object { git push -u origin $_ }
```
