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
