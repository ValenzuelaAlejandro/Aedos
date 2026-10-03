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
