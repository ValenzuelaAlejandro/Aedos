# Auditoría de catches silenciosos

Auditoría realizada sobre `src/backend/` en Fase 3a. No se modificó ningún
catch; la tabla describe qué información se descarta hoy.

| Archivo y línea | Forma | Qué se oculta o descarta |
|---|---|---|
| `server.js:718, 772, 952, 980` | `catch (_) { /* skip malformed SSE frames */ }` | Frames SSE del proveedor que no pueden parsearse. |
| `server.js:836` | catch vacío | Fallo al escribir metadata SSE cuando el socket ya no acepta datos. |
| `server.js:1278` | `return false` | Fallo al localizar el ejecutable de Chrome. |
| `server.js:1308` | `return null` | Fallo al inspeccionar/descomprimir Chrome. |
| `server.js:1339` | `return` | Fallo de limpieza de cache de Chrome. |
| `server.js:1679, 1748` | catch vacío | Fallos de escritura/cierre SSE después de desconexión. |
| `server.js:1920, 2205, 2299, 2309` | comentarios y continuación | Socket cerrado durante generación o forwarding SSE. |
| `server.js:4300, 4310` | comentario | El logging de cierre de respuesta nunca debe tumbar el proceso. |
| `logger.js:97` | `return` fallback | Valor no serializable en contexto de logging. |
| `pipeline.js:99, 113` | fall-through | Intentos de reparación/parseo JSON que deben continuar con el siguiente método. |
| `request-normalizers.js:34` | devuelve original | JSON malformado en un campo multipart; conserva el quirk actual. |

También existen `.catch(() => {})` explícitos en esperas de Puppeteer
(`server.js:2710, 2713, 2734, 4074, 4081, 4090, 4161`) que absorben timeouts
de red, fonts, iconos o screenshots no críticos. No se tocaron porque cambiar
su observabilidad o timing afectaría PDF/PPTX.

## Cambios de ubicación en Fase 3b

La lógica se movió sin cambiar su política de absorción ni sus mensajes:

| Nuevo archivo | Catches movidos | Responsabilidad |
|---|---|---|
| `src/backend/browser/manager.js` | búsqueda/extracción/instalación de Chrome y diagnóstico de `puppeteer.launch` | Recuperación y ciclo de vida del singleton Puppeteer. |
| `src/backend/export/pdf.js` | esperas de red, fonts, iconos, normalización de layout y metadata `pdf-lib` | Render y postprocesado PDF. |
| `src/backend/export/pptx-finalize.js` | No añade catches; la captura HTTP continúa en `server.js` | Validación, respuesta y TTL de `finalize-pptx`. |

Los handlers de ruta y los catches de errores HTTP permanecen en `server.js` para
conservar el orden observable y la forma de respuesta.

## Cambios de ubicación en Fase 3c

Las referencias de línea de la tabla histórica anterior corresponden a la
versión de Fase 3a y pueden quedar desfasadas después de extraer módulos. La
referencia mantenible es ahora archivo + responsabilidad:

| Área | Ubicación actual | Política conservada |
|---|---|---|
| Pipeline y streaming | `src/backend/pipeline/skeleton.js`, `outline-item.js`, `stream.js` | Reparación/parseo y forwarding SSE mantienen sus fall-throughs, reintentos y silencios existentes. |
| Salida de generación | `src/backend/http/routes/generate-output.js`, `generate-errors.js`, `generate.js` | Los catches HTTP y de escritura SSE conservan status, payload, mensajes y orden. |
| Finalización y descarga | `src/backend/http/routes/finalize.js`, `download.js` | Se mantiene la política de error, TTL y cierre de respuesta. |
| Middleware | `src/backend/http/middleware/request-logging.js`, `cors.js`, `security-headers.js`, `canonical-redirect.js`, `static-files.js` | No se introdujeron catches nuevos ni se cambió la observabilidad. |

La extracción 3c movió el renderer PPTX entero a `export/pptx-renderer.js`, el
runtime de providers, rutas y contratos. Los catches y sus políticas se
conservaron; `utils/pptx-export.js` no se tocó. El sanitizer, los errores 500 de
Multer y la semántica de `req.close` siguen sin corregirse por ser cambios de
comportamiento reservados para otra fase.
