# Inventario de `src/backend/server.js`

Inventario de la rama `refactor/fase-3c-cierre-backend`, basado en el blob Git
de `HEAD`. El archivo contiene 1858 líneas físicas LF; las cifras de tamaño de
esta tabla son rangos inclusivos del mismo blob. `server.js` sigue siendo la
fachada pública y el orden de composición es observable.

| Rango | Tamaño | Responsabilidad actual | Destino propuesto |
|---:|---:|---|---|
| 1–37 | 37 | dotenv, imports de contratos, colas, exportadores, archivos y límites | `server.js` bootstrap/imports mínimos |
| 38–105 | 68 | `PUPPETEER_CACHE_DIR`, importación del browser manager, logger, runtime config y creación de colas | `server.js` bootstrap; factories existentes |
| 106–157 | 52 | pressure middleware, seams de provider, app Express y factories PDF/PPTX | `http/bootstrap.js` o bootstrap final |
| 158–239 | 82 | entorno de ejecución, carpetas de examples, modelos IA, reasoning y banner | `config/` + `providers/`; composición en bootstrap |
| 240–305 | 66 | CORS, validación de entorno, logging, headers, redirect y estáticos | `http/bootstrap.js` conservando el orden |
| 309–323 | 15 | creación de directorios temporales/examples | `files/directories.js` ya existente |
| 325–402 | 78 | safety net de layout, sanitización delegada, título y nombres de archivos HTML | `sanitization/` y `files/` |
| 404–470 | 67 | adaptadores Gemini/OpenRouter, fallback y composición de handlers skeleton/outline | `providers/` + `pipeline/` existentes |
| 472–480 | 9 | inicialización eager de Puppeteer y handler SIGINT | `browser/manager.js` sólo si el orden queda demostrado |
| 481–559 | 79 | registro de entry/generation routes y `sanitizeTema` | `http/routes/` y `contracts/` |
| 561–566 | 6 | adaptación de fuente PPTX | módulo renderer PPTX nuevo |
| 567–1783 | 1217 | renderer editable PPTX: browser/page, carga de HTML, assets, DOM/CSS, rasterización, modelos, shapes, textos, tablas, warnings, debug y creación del buffer | `src/backend/export/pptx-renderer.js`; excepción monolítica >400 líneas |
| 1785–1799 | 15 | registro de finalize y download routes | `http/routes/` y `export/` existentes |
| 1801–1827 | 27 | handlers globales `uncaughtException` y `unhandledRejection` | sólo mover si el registro queda en el mismo punto |
| 1829–1849 | 21 | guard `require.main`, verificación Redis, `listen`, `requestTimeout` y `headersTimeout` | bootstrap final; no mover timers sin prueba de orden |
| 1851–1858 | 8 | fachada exportada pública | `server.js`, sin cambiar claves ni tipos |

## Puntos que requieren especial cuidado

### Renderer PPTX

El bloque 567–1783 contiene una única función monolítica de 1217 líneas. Incluye
el momento de crear/reutilizar la página Puppeteer y todos los cierres `finally`.
Se moverá entero a un archivo propio dentro de `src/backend/export/`, sin tocar
`src/backend/utils/pptx-export.js`. La excepción de tamaño está justificada por
la regla 11: partirlo ahora exigiría reescribir lógica o modificar estado/timing.
La división posterior debe hacerse con snapshots de bytes, warnings, paquetes y
timers.

### Rate limiter y límites

La implementación vive ya en `src/backend/utils/rate-limiter.js`; `server.js`
sólo importa `verifyRedis`, `checkRateLimits` y `checkFinalizeLimits` (líneas
73–75), documenta sus dos usos (233–235) y verifica Redis antes de `listen`
(1829–1848). El destino de la composición es el bootstrap, no una segunda
implementación.

### Timers TTL y process handlers

`DOWNLOAD_TTL_MS` llega desde `contracts/limits.js` y se usa tanto en el
finalizador como en `server.requestTimeout`. `headersTimeout` permanece en
11 minutos. Los handlers de `SIGINT`, `uncaughtException` y
`unhandledRejection` deben conservar orden, mensajes y momento de registro; si
no se puede demostrar equivalencia, permanecen en `server.js` y se documenta la
excepción.

### Arranque y fachada

El orden que debe conservarse es: dotenv (cuando aplica) → configuración →
cache/importación de Puppeteer → app/middleware → inicialización eager del
browser → rutas → listeners de proceso → verificación Redis → `listen` y
timeouts. La fachada final debe seguir exportando exactamente:

```text
app
sanitizeTema
sanitizeGeneratedHtml
buildPrompt
setTestProviderOverride
clearTestProviderOverride
```
