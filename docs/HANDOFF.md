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

## Etapa 8 — cierre parcial (2026-10-03)

La ejecución se detuvo en la Etapa 3 por la compuerta de dos intentos: dos
extracciones del binder de edición fueron rechazadas por `verify:all` y se
revirtieron. No se crearon las ramas 8d/8e ni se inició la Etapa 6.

Cadena local, sin push:

| Rama | HEAD | Resultado relevante |
| --- | --- | --- |
| `refactor/fase-7-limpieza` | `e472f37` | Base de esta ejecución |
| `refactor/fase-8a-red-estable` | `565a8f0d296fa85b1ec92ba1a08c24dc7c74c9e6` | Safety estabilizado; verify verde |
| `refactor/fase-8b-inventario` | `a1cd537d6190c81aeb8027c378e7c31a0d5bb9f7` | Inventario y parser streaming extraído |
| `refactor/fase-8c-outline` | `7df25906d15fa59005a88c8ddf0e04bd5bb8dddc` | Código: parser/render streaming y chips; binder revertido |

Después de esta punta de código se añadió el handoff en el commit docs-only
`eea84173f5c2500c8c24b2ed5a786a587e0e6005`; ese commit pasó `verify:all` y es
la punta actual de la rama. No cambia los blobs de código medidos abajo.

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
formato correcto. El último verify fue el del revert `7df2590`. No se tocaron
baselines. La verificación incluye solo providers simulados/locales; no hubo
llamadas reales ni acceso a red externa. No se leyó `.env`.

Medidas de archivos obtenidas con `git show <ref>:<archivo> | wc -l`:

| Archivo | Inicio 8a (`565a8f0`) | Código 8c (`7df2590`) |
| --- | ---: | ---: |
| `src/frontend/scripts/app.js` | 4,618 | 4,618 |
| `src/frontend/scripts/outline.js` | 1,308 | 1,147 |
| `src/frontend/editor/editor.js` | 1,898 | 1,898 |
| `features/outline/stream-parser.js` | — | 51 |
| `features/outline/stream-renderer.js` | — | 85 |
| `features/outline/chips-renderer.js` | — | 94 |

El objetivo de `outline.js` ≤300 líneas no se alcanzó. Los globals legacy
`window.parsePartialSkeleton`, `window.renderStreamingOutline` y
`window.renderOutlineSuggestedChips` se conservaron como fachadas; no se eliminó
ningún `window.*`. El helper `addSlideWithAI` sigue definido localmente, pero la
búsqueda en el repo encontró solo su declaración y el botón `#btn-add-slide-ai`
en HTML, sin llamada ni listener encontrado. No se extrajo código inalcanzable
a un módulo; decidir si retirar ese helper o reconectar el botón queda pendiente.

La Etapa 1 terminó con 30/30 ejecuciones consecutivas de
`npm run check:editor-safety` en verde y 13/13 sentinels detectados. La Etapa 2
está documentada en `docs/FRONTEND-INVENTORY.md`. Pendiente al reanudar: resolver
el probe de mutación del binder sin elevar lint/type ratchets; terminar los
cortes de outline, luego crear 8d/8e y completar arquitectura, contratos,
handoff y orden de push. Push, CI de GitHub, smoke test con providers reales y
`npm audit` conectado continúan pendientes del usuario/entorno.
