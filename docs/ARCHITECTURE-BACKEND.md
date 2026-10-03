# Arquitectura del backend

Este documento describe la forma actual del backend después de la limpieza de
la Etapa 7. `src/backend/server.js` sigue siendo la fachada de
bootstrap: conserva la inicialización eager de Puppeteer, la construcción de
dependencias, el orden de middleware/rutas y los exports públicos.

## Mapa de responsabilidades

| Carpeta | Responsabilidad | Punto de entrada o contrato |
|---|---|---|
| `server.js` | Fachada HTTP, bootstrap y composición | `app`, exports públicos, orden observable |
| `contracts/` | Límites, errores, SSE, sanitización de temas y normalización de requests | `limits.js`, `errors.js`, `sse.js`, `topic-sanitizer.js`, `request-normalizers.js` |
| `config/` | Lectura, modelos y validación de configuración de entorno | `env.js`, `models.js`, `environment.js` |
| `providers/` | Adaptadores de proveedores IA, fallback y composición runtime | `gemini.js`, `openrouter.js`, `fallback.js`, `runtime.js` |
| `queues/` | Concurrencia y colas de generación/finalización | `generation.js`, `finalize.js` |
| `pipeline/` | Flujo de skeleton, outline-item y streaming | `skeleton.js`, `outline-item.js`, `stream.js` |
| `http/middleware/` | CORS, logging, headers, redirect y estáticos | Fábricas registradas por `server.js` |
| `http/` | Ensamblaje y handlers HTTP | `register-routes.js` y `routes/` |
| `export/` | Render y finalización de documentos | `pdf.js`, `pptx-finalize.js` |
| `files/` | Uploads, adjuntos, directorios y descargas | Utilidades usadas por rutas |
| `browser/` | Gestión del navegador Puppeteer | `manager.js` |
| `sanitization/` | Sanitización e inyección de HTML | `html.js` |
| `prompts/` | Orquestación y contenido de los prompts de generación | `pipeline.js`, `stage-runner.js`, `json-extraction.js`, `skeleton-enrichment.js` y prompts por etapa |
| `utils/` | Logger, fachada de rate limiter, evaluadores y export warnings/PPTX | Utilidades transversales |

## Flujo de una solicitud de generación

1. El bootstrap de `server.js` resuelve entorno y defaults, crea las factories,
   registra middleware y conserva la inicialización eager del navegador.
2. La solicitud atraviesa CORS, logging/request-id, headers de seguridad,
   redirect canónico y estáticos, en el orden congelado por el snapshot de
   router.
3. `http/register-routes.js` aplica las rutas en orden congelado. Los parsers y
   middleware de cada endpoint permanecen dentro de sus fábricas. La entrada se
   normaliza según el contrato existente, se validan límites y
   adjuntos, y la generación se entrega a `queues/generation.js`.
4. La cola invoca el pipeline. `pipeline/skeleton.js` y
   `pipeline/outline-item.js` construyen las etapas; `pipeline/stream.js`
   conserva el forwarding SSE, reintentos y bytes observables.
5. Los adaptadores de `providers/` resuelven el proveedor configurado o el
   fallback. Los eventos SSE llegan al cliente con sus payloads y errores
   históricos.
6. Al completar la generación, la salida HTML pasa por sanitización e
   inyección. El cliente recibe el documento y los metadatos en el mismo
   formato.
7. Las rutas de `finalize` y descarga delegan la finalización PDF/PPTX,
   almacenan o leen el artefacto mediante `files/` y conservan TTL, headers,
   status y payloads.

Los límites y errores no deben duplicarse en handlers: están centralizados en
`contracts/limits.js`, `contracts/errors.js`, `contracts/request-normalizers.js`
y `contracts/sse.js`, junto con los defaults de entorno de `config/env.js` y
`contracts/config-defaults.js`.

## Recetas de extensión

### Añadir un endpoint

Crear una fábrica en `src/backend/http/routes/` que reciba dependencias de
bootstrap y registre únicamente sus rutas. Añadirla al punto equivalente de
`generation-endpoints.js` o al módulo de ruta correspondiente, manteniendo el
orden y los nombres de las capas. Añadir o actualizar el snapshot de router,
un contrato de payload/error y pruebas sin proveedores reales. Ejecutar
`npm run verify:all` antes de cada commit.

### Añadir un proveedor IA

Implementar el adaptador en `src/backend/providers/`, reutilizar los contratos
de `providers/common.js` y conectar la selección/fallback desde
`providers/fallback.js` y la configuración de entorno. Añadir pruebas de
forma, timeout, error y fallback usando stubs; no hacer llamadas de red en la
suite. Verificar que los eventos SSE, límites y mensajes existentes no cambien.

### Añadir un formato de exportación

Colocar el render/postprocesado en `src/backend/export/` o en una utilidad
específica si el momento de inicialización lo exige. Integrar el finalizador,
la ruta HTTP, la descarga y el baseline correspondiente. Añadir pruebas de
errores, TTL, headers y bytes; actualizar el snapshot sólo si el endpoint es
intencionalmente nuevo. El renderer PPTX monolítico actual no se divide sin
un corte seguro que preserve su inicialización y estado.

## Límites de la fase 3c

El renderer PPTX se movió entero a `export/pptx-renderer.js` por la excepción de
bloque monolítico; `utils/pptx-export.js` quedó intacto. `server.js` termina en
424 LF, no alcanza el objetivo de 200 sin trasladar la composición de factories,
los process handlers o el guard de arranque; las dos últimas extracciones se
dejaron fuera cuando el ratchet detectó TS2322 y se documentan como no aplicadas.

La comparación HTTP de normalizadores cubrió 50 casos con igualdad exacta de
status y cuerpo. Los helpers están integrados en las rutas de generación y la
suite contractual vuelve a ejecutar el probe. La selección Pro automática por
adjuntos pertenece al frontend; el backend sólo expone la información de
adjuntos existente.

## Cierre de Etapa 7

- `utils/rate-limiter.js` conserva Redis, auditoría de IP, middleware y la
  fachada pública. `utils/rate-limit-evaluators.js` contiene sólo las decisiones
  de contador/cooldown. Se midieron 545 líneas antes, y después 334 en la
  fachada más 252 en el helper; las cifras salen de `git show <commit>:<path> |
  wc -l`. `src/backend/utils/README.md` registra el límite de la extracción.
- `prompts/pipeline.js` conserva el orden de etapas y ahora mide 165 líneas
  frente a 489 antes. `json-extraction.js` (124), `stage-runner.js` (166) y
  `skeleton-enrichment.js` (61) son los módulos conectados. Los cuerpos
  ejecutables se trasladaron sin reescritura; se añadieron pruebas locales para
  parseo, defaults del skeleton y error permanente de quota.
- Los nuevos módulos están por debajo de 300 líneas y `prompts/README.md`
  describe responsabilidades. `base.js`, `stage2-design.js` y
  `stage3-compositor.js` retienen textos/plantillas interpoladas: dividirlos
  exigiría mover fragmentos de payload y elevaría el riesgo de cambiar el prompt
  enviado al proveedor.
- `server.js` tiene 424 líneas en `refactor/fase-3c-fix` y 427 en la punta
  posterior a Multer; el cambio neto corresponde al import y middleware
  `handleUploadError` de `459c932`. En Etapa 7 no se cambió.
- `utils/pptx-export.js` (792 líneas) y `export/pptx-renderer.js` (1,258)
  permanecen juntos en sus responsabilidades actuales: su orden de serialización,
  captura de DOM y dependencias de inicialización están acoplados al baseline de
  14 paquetes. El corte propuesto necesita una interfaz específica y una
  comparación binaria/estructural por cada extracción; no se intentó en esta
  etapa.
- `npm run verify:all` pasó después de cada commit de código y después del
  commit separado de reducción de ratchets. El baseline PPTX siguió en 14
  paquetes, el PDF en sus 8 páginas estructuralmente iguales, y la visual en
  6/6 capturas sin diferencias.
