# Arquitectura del backend

Este documento describe la forma actual del backend de Aedos después de la
refactorización 3b.2. `src/backend/server.js` sigue siendo la fachada de
bootstrap: conserva la inicialización eager de Puppeteer, la construcción de
dependencias, el orden de middleware/rutas y los exports públicos.

## Mapa de responsabilidades

| Carpeta | Responsabilidad | Punto de entrada o contrato |
|---|---|---|
| `server.js` | Fachada HTTP, bootstrap y composición | `app`, exports públicos, orden observable |
| `contracts/` | Límites, errores, SSE y normalización de requests | `limits.js`, `errors.js`, `sse.js`, `request-normalizers.js` |
| `config/` | Lectura y resolución de configuración de entorno | `env.js` |
| `providers/` | Adaptadores de proveedores IA y fallback | `gemini.js`, `openrouter.js`, `fallback.js` |
| `queues/` | Concurrencia y colas de generación/finalización | `generation.js`, `finalize.js` |
| `pipeline/` | Flujo de skeleton, outline-item y streaming | `skeleton.js`, `outline-item.js`, `stream.js` |
| `http/middleware/` | CORS, logging, headers, redirect y estáticos | Fábricas registradas por `server.js` |
| `http/routes/` | Registro y handlers HTTP | Entrada, generación, finalize y descarga |
| `export/` | Render y finalización de documentos | `pdf.js`, `pptx-finalize.js` |
| `files/` | Uploads, adjuntos, directorios y descargas | Utilidades usadas por rutas |
| `browser/` | Gestión del navegador Puppeteer | `manager.js` |
| `sanitization/` | Sanitización e inyección de HTML | `html.js` |
| `prompts/` | Prompts de las etapas de generación | Módulos por etapa |
| `utils/` | Logger, rate limiter, export warnings y renderer PPTX | Utilidades transversales |

## Flujo de una solicitud de generación

1. El bootstrap de `server.js` resuelve entorno y defaults, inicializa el
   navegador eager y crea la aplicación.
2. La solicitud atraviesa CORS, logging/request-id, headers de seguridad,
   redirect canónico y estáticos, en el orden congelado por el snapshot de
   router.
3. El registro de rutas aplica los parsers y middleware de cada endpoint. La
   entrada se normaliza según el contrato existente, se validan límites y
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

## Límites de la fase 3b.2

La extracción 3b2.4 del renderer PPTX no se aplicó: el bloque restante en
`server.js` es monolítico y supera el objetivo de 200 líneas; separarlo en
módulos de 300/400 líneas requeriría reescribir lógica o cambiar el momento de
inicialización. Se conserva el código para no alterar el comportamiento.

La comparación de normalizadores cubrió 18 casos. No se sustituyó ninguna
validación inline: hubo una diferencia observable para `idioma: "ja"`, donde
el normalizador también devuelve `fields.idioma`, mientras la proyección inline
sólo devuelve `{ valid: false }`. Además, la selección Pro automática por
adjuntos pertenece al frontend; el backend sólo expone la información de
adjuntos existente.
