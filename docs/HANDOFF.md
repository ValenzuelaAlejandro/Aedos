# Traspaso — refactorización Aedos

## Cadena de ramas

Hashes observados localmente antes de este documento:

| Orden | Rama                               | Hash                                       |
| ----: | ---------------------------------- | ------------------------------------------ |
|     1 | `refactor/fase-0-red-seguridad`    | `d1f07114376c17e408bb6fc7c91d21287d4d9974` |
|     2 | `refactor/fase-0b-cierre-huecos`   | `8f53dfe068f7a89a06587b9de19684be0453f8a2` |
|     3 | `refactor/fase-1-calidad-base`     | `3c962717bc458a30b4230edfef766d874afb9da1` |
|     4 | `refactor/fase-2-contratos`        | `a7df061b21f3778db10505854725617e65110c7d` |
|     5 | `refactor/fase-3a-backend-base`    | `6d05d8307f0210901586cb95bbc83fecc13cb043` |
|     6 | `refactor/fase-3a-bis-extraccion`  | `2f0569fafe9ff0ac089fa90b4e978ec0f70b2951` |
|     7 | `refactor/fase-3b1-colas-export`   | `5e75fc16b6ad09bcea3d6da0dd558b63c1a0fc3a` |
|     8 | `refactor/fase-3b2-pipeline-rutas` | `21b238af9d8c41ccdfad6efa32b77c3ccf17be31` |
|     9 | `refactor/fase-3c-cierre-backend`  | `ff967744dfb10e24c07ce3a85108c50b3a690532` |
|    10 | `refactor/fase-3c-fix`             | `3d8399fd6c7905194543cb585f7fc29efbad117d` |
|    11 | `refactor/fix-sanitizacion`        | `42987acaf87bbfe1e8b3deef38893f119cca1a7e` |

El commit de estas notas actualizará el hash de `refactor/fase-3c-fix`; consultar `git rev-parse HEAD` para el valor definitivo.

## Estado

- Backend refactorizado; `src/backend/server.js` tiene 424 líneas.
- Métricas reportadas para esta fase: lint 179 y typecheck 30.
- No se modificaron `src/`, `tests/` ni baselines para este cierre.
- Se revisó `.github/workflows/ci.yml`: `push` y `pull_request` no tienen filtro de ramas.
- No se ha confirmado una ejecución de GitHub Actions para estas ramas.

## Verificación

Comando: `npm run verify:all` (ejecutado el 2026-09-30 en Windows). No terminó correctamente: las suites `test:safe` (36 pruebas), `test:contract` (25), `test:provider-network` (3) y `test:provider-timeout` (1) llegaron a sus resultados de pase; al terminar `test:provider-timeout`, el proceso Node abortó con `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94` (código de salida PowerShell `-1073740791`). En esa ejecución Puppeteer también registró `spawn EPERM` al intentar iniciar Chrome. Por tanto, `verify:all` queda pendiente de una ejecución completa exitosa en un entorno compatible.

## Riesgos aceptados / known issues

- Ciclo de vida de cola y `req.close`.
- Sanitización con casos aún por revisar.
- Multer puede responder 500.
- Sin fallback midstream después de comenzar el stream.
- `npm audit` reportó 12 vulnerabilidades; no ejecutar `audit fix` sin revisar.
- Puppeteer puede inicializarse al importar módulos.
- No se ha realizado smoke test con proveedores reales.
- GitHub Actions todavía no se ha observado correr para estas ramas.

## Diagnóstico de cobertura visual (histórico, corregido en Fase 3d)

La atribución anterior de `80/80/17/0` al fondo rojo era incorrecta. La
reproducción controlada cambió `body` a rojo, pero `#chat-screen` cubría el
viewport completo y lo pintaba opaco; ese cambio no era visible. Los 80 píxeles
desktop medidos en el worktree limpio eran el botón dev-only
`#btn-debug-last-generated`, presente en la baseline antigua pero ausente cuando
`HEAD /__dev__/last-generated` respondía 404. El rectángulo del diff fue
`x=989..1004, y=496..512`. Evidencia e imágenes:
[`docs/visual-baseline-diagnosis/README.md`](visual-baseline-diagnosis/README.md).

## Fase 3d — Baseline visual

- Rama iniciada desde `refactor/fase-3c-fix` en `67d248bcdf976c726d73f930353ba683f8cd3808`.
- Capturas: `desktop-light.png`, `desktop-dark.png`, `mobile-light.png`,
  `modal-error-mobile.png`, `outline-editable-desktop.png` y
  `presentation-iframe-desktop.png`.
- Los estados claros/oscuros se fuerzan explícitamente; animaciones apagadas,
  requests externos bloqueados, providers configurados en stub y el probe del
  botón dev fijado en 404.
- Comparación: pixelmatch threshold 0.03, ratio máximo 0.01%, mosaicos de 32×32
  con distancia euclidiana RGB máxima 20; cero máscaras.
- Diez ejecuciones consecutivas de `npm run check:baseline:visual`: 10/10
  código 0, 0 píxeles sobre el umbral en cada una. La máxima distancia regional
  observada fue 9.3 (móvil), debajo del límite 20.
- Mutaciones comprobadas: `#chat-screen` rojo detectado (1,166,371 px);
  body rojo no visible y pasa (0); botón +20px detectado (35 px y distancia
  regional 336.2); texto rojo (7,765 px); radio cero (205 px); icono oculto
  (18 px); título +2px (15,358 px); comentario CSS pasa (0).
- Ningún archivo de `src/` se cambió.

## Pendientes para continuar

1. Ejecutar smoke test manual controlado con proveedores reales.
2. Crear/usar la rama de integración después de acordar su base.
3. Resolver los known issues priorizados; el error HTTP de Multer se corrigió
   en `refactor/fix-multer` (véase la sección Etapa 2c).
4. Completar Fase 0c.
5. Completar Fase 4 del frontend.
6. Repetir `npm run verify:all` en un entorno compatible con Puppeteer y Windows/Linux CI, y observar Actions.

## Etapa 3 — red de seguridad del editor (completada)

- Rama: `refactor/fase-0c-editor-red`, basada en `refactor/fix-audit` (`3114bde`).
- Añadido `scripts/editor-safety/`: flujo Puppeteer por estados, comparación
  visual, contratos DOM/SSE y 13 mutaciones canario. No se modifica `src/`.
- Generación y exportación se interceptan con fixtures deterministas; se
  bloquean requests externos, se desactivan animaciones/transiciones y se
  usa un servidor efímero de loopback. No se llaman proveedores reales.
- Capturas por estado añadidas en `tests/baseline/editor-safety/`. Se regeneran
  porque esta etapa añade estados que no existían en la baseline anterior; no
  se regeneró el baseline general, PDF ni PPTX.
- Limitaciones `NO cubierto` (el detalle y motivo están en
  `docs/CONTRACTS.md`): botón Add Section oculto validado con click programático,
  reorder por drag-and-drop, tema en preview, proveedor real/fallo mid-stream,
  render/export real y zoom fullscreen.
- Hallazgos del harness: el mock HTTP detectó correctamente que omitir
  `response.ok` deja el modal de error oculto; la prueba espera un máximo de
  2.5 s y captura el estado ausente. La prueba de capas espera a
  `is-editor-ready` antes de obtener el iframe para evitar medir durante su
  reemplazo final.
- El minimapa actualiza sus miniaturas 800 ms después de mutaciones del iframe.
  El estado de resaltado inicial no se considera visualmente cubierto en la
  captura de zoom reset; esa captura omite el minimapa y los pasos siguientes
  ejercitan clic en miniatura 1/2, esperan el refresh y verifican el índice
  activo. La temporización de esa actualización sigue siendo un riesgo conocido.
- `check:editor-safety` quedó integrado en `verify:baseline` y por tanto en
  `verify:all`. La suite cubre 30 checkpoints visuales/de estado y 13
  mutaciones canario; una ejecución completa terminó con 13/13 detectadas.
- Diez ejecuciones consecutivas finales de `npm run check:editor-safety`
  terminaron con exit 0. En cada una, los 30 checkpoints tuvieron 0 píxeles
  distintos y las 13 mutaciones fueron detectadas. Las salidas se midieron
  directamente; los logs locales temporales están bajo `tmp/`.
- Diagnóstico de estabilidad: una serie preliminar falló por `ProtocolError:
  Promise was collected` al esperar `requestAnimationFrame` de miniaturas iframe
  reemplazables; la espera ahora verifica documento completo y fuentes cargadas,
  sin retener promesas dentro de esos iframes. Otra serie falló porque `flow-04`
  capturaba antes de que aparecieran los chips ya esperados por el flujo; el
  checkpoint ahora espera los chips. Se regeneraron solo `flow-04`, `flow-19`
  y `flow-20`; los otros 27 PNG conservaron exactamente su SHA-256. Ningún
  baseline general, PDF o PPTX cambió.
- `npm run verify:quality` pasó: lint permaneció en 175 (baseline 175) y
  TypeScript en 29 diagnósticos (baseline 29). Formato pasó. `src/` no se
  modificó.
- La verificación completa `npm run verify:all` posterior al commit queda como
  compuerta obligatoria antes de continuar a Etapa 4.

## Etapa 2c — errores de carga Multer

- Antes del arreglo, archivo >10 MiB, cuarto archivo, extensión `.exe` y
  nombre sin extensión devolvían `500 text/html` con el manejador por defecto
  de Express y una página que incluía el mensaje/traza del error.
- Ahora el middleware de carga produce JSON `{ "error": "..." }`: tamaño
  excedido es 413; cantidad, extensión y nombre son 400. El caso exactamente
  10 MiB también se observa como `LIMIT_FILE_SIZE` en la versión instalada y
  devuelve 413.
- El frontend ya comprueba `response.ok`, lee `errorData.error` y lo presenta;
  no distingue 400 de 413 ni tiene una pantalla específica de error de carga.
  Antes de enviar, limita localmente cada archivo a 10 MB y el total a 3.
- `npm run test:contract`, `npm run verify:quality` y `npm run verify:all`
  pasaron en Windows con Node v24.19.0. Visual: 6/6 capturas, todas 0 píxeles
  distintos; mutaciones 8/8. PPTX: baseline 14 paquetes; COM render omitido
  porque PowerPoint no está instalado. PDF: baseline pasó. No hubo proveedores
  reales ni push.
- Rama: `refactor/fix-multer`, basada en `42987ac`. Consulta `git rev-parse
  HEAD` para su hash actual.

## Etapa 2d — revisión de dependencias

- Rama `refactor/fix-audit`, base `459c932`; el árbol Git inició limpio.
- Auditoría en npm 11.17.0 contra `https://registry.npmjs.org/`: conexión
  correcta, 16 vulnerabilidades en total (12 high, 4 moderate, 0 low/critical).
  Las 16 entradas están presentes con `npm ls --omit=dev`, es decir, alcanzan
  producción; 3 directas (`express`, `multer`, `puppeteer`) y 13 transitivas.
  El inventario paquete/severidad está en `docs/KNOWN-ISSUES.md`.
- Se revisó un dry-run (29 cambios semver, 7 retiros, 0 adiciones). Ensayo
  aplicado solo para evaluación: audit quedó en 8 high, pero `verify:all`
  falló antes de llegar a las baselines: el test de 10 MiB esperaba 413 y con
  Multer 2.4.0 observó 200. Ese cambio incumple el contrato congelado.
- Se descartó el ensayo; `package-lock.json` se restauró y `npm ci
  --ignore-scripts` reinstaló Express 4.22.2, Multer 2.2.0 y Puppeteer 24.39.1.
  No hay cambios de dependencias ni commit correctivo de audit. No se ejecutó
  ninguna actualización major. La familia Puppeteer requiere 25.12.0 major
  para eliminar los 8 high restantes del ensayo; riesgo documentado en
  `docs/KNOWN-ISSUES.md`.
- El commit `459c932` ya documenta y traduce a HTTP 413 el caso exactamente
  10 MiB. El inventario y la conclusión de esta revisión se registran en esta
  rama de documentación; no se tocaron baselines.
