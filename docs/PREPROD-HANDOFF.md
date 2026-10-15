# Entrega de preproducción e incidente

No se ha desplegado. El ensayo usa proveedores falsos, la aplicación real y
Redis local aislado. No sustituye la comprobación de Google, OpenRouter,
Upstash ni del proxy remoto. No hay diagnóstico causal del incidente sin su traza.

Crear localmente `.env.preprod` copiando `.env.preprod.example`. Está ignorado
por git (`git check-ignore .env.preprod`). No pegar secretos en este chat,
commits, capturas ni tickets. El runner lo carga antes de validar entradas.
El archivo es obligatorio en modo real: las variables omitidas no se completan
con claves heredadas de la sesión. Las cinco entradas externas necesarias están
consolidadas aquí:

| Entrada | Variables y formato exacto | Origen y permiso mínimo | Cuota recomendada y revocación |
| --- | --- | --- | --- |
| 1. Servicio aislado | `AEDOS_PREPROD_URL=https://aedos-staging.<dominio>`; origen HTTPS, sin ruta/query/usuario. `AEDOS_PREPROD_VERIFICATION_ACK=ISOLATED_PREPRODUCTION_ONLY` | Servicio de staging administrado por el propietario; acceso HTTP al health y generación. Confirmar expresamente que no es producción y que usa esta revisión | Una instancia temporal; apagar al concluir. No requiere acceso de administrador al verificador |
| 2. Google | `GEMINI_API_KEY=<cadena emitida por Google>` y `AEDOS_GEMINI_429_API_KEY=<otra clave, de otro proyecto con cuota agotada>`; sin prefijo Bearer | Google AI Studio → API keys. Restringir a Gemini/Generative Language API. La cuota se aplica por proyecto; dos claves del mismo proyecto no aíslan cuotas | Proyecto válido con al menos 10 llamadas disponibles al modelo seleccionado; proyecto separado con cuota baja ya agotada que devuelva 429 auténtico. No agotar producción ni intentar forzar 429 con tráfico masivo. Usar free tier si el modelo está disponible; si exige facturación, proyecto separado con presupuesto vigilado. Eliminar ambas claves en AI Studio al terminar |
| 3. OpenRouter | `OPENROUTER_API_KEY=<clave de inferencia>`; sin prefijo Bearer | OpenRouter → Settings → Keys. Clave ordinaria de inferencia, sin Management API key ni permisos de administración | Límite de gasto recomendado USD 1 y sin recarga automática para este ensayo de respuestas breves; el harness reserva como máximo USD 0.05 por request/IP. Revocar la clave en Keys al terminar, aunque sobre saldo |
| 4. Redis aislado | `UPSTASH_REDIS_REST_URL=https://<base>.upstash.io`; `UPSTASH_REDIS_REST_TOKEN=<token REST de escritura>`; `AEDOS_REDIS_TEST_LABEL=staging-<identificador>`; `AEDOS_LIVE_REDIS_LABEL` idéntica; `AEDOS_REDIS_TEST_ACK=ISOLATED_PREPRODUCTION_REDIS_ONLY`; `AEDOS_LIVE_TEST_ACK=ISOLATED_PREPRODUCTION_ONLY` | Upstash Console → base de staging → Connect/REST. Token de la base aislada con GET/SET/EVAL, hashes, streams, contadores y expiración; read-only no sirve. No se necesita token de cuenta ni administración | Base vacía separada, cuota disponible para unos miles de comandos. Los datos de prueba tienen IDs aleatorios y TTL. Rotar token o eliminar la base temporal al terminar; actualizar también el servicio staging si se mantiene |
| 5. Incidente histórico | `AEDOS_INCIDENT_REQUEST_ID=<UUID o identificador correlacionado>` opcional en el archivo; traza sanitizada en archivo local. No es credencial ni habilita llamadas | Logs existentes del servicio/Redis; exportación de lectura, sin acceso de escritura requerido | Sin cuota de proveedor. Retirar exportaciones locales cuando el diagnóstico quede documentado y revocar cualquier acceso temporal a logs |

El servidor de staging debe tener `NODE_ENV=preproduction`, las mismas variables
Redis/etiqueta/ACK y una clave Gemini válida de prueba. `/health` debe acreditar
`environment=preproduction`, etiqueta y fingerprint SHA256 del origen Redis.
El runner valida todo antes de llamadas pagadas o escrituras. Dominios de
producción conocidos, hosts sin etiqueta, redirects, ACK ausentes, health de
production o fingerprint diferente bloquean la ejecución. El ACK expresa una
confirmación humana de aislamiento; una etiqueta no demuestra por sí sola
que una base nunca haya sido utilizada en producción.

## Comandos y alcance del ensayo

```powershell
npm run verify:preprod -- --rehearsal
npm run verify:preprod
npm run verify:all
```

El primero descarta el entorno heredado, usa credenciales ficticias y no carga
`.env` ni `.env.preprod`. Inicia Gemini/OpenRouter HTTP falsos y una fachada
REST sobre un Redis Memurai con ACL, en loopback. Ejecuta la misma secuencia
de scripts y aserciones que el segundo: matriz de fallos, persistencia/reinicio,
ledger aislado, SSE HTTP de la app real y adapters de proveedores con Gemini
válido, HTTP inválido, 429, corte, vacío, safety, OpenRouter disponible/no
disponible, modelo fijo, request ID y liquidación única. El preload restringe
fetch y conexiones TCP/TLS a loopback; los únicos nombres upstream permitidos
se redirigen al transporte local. Las pruebas rechazan salida externa por
fetch, HTTP/HTTPS, TCP y redirección. No se habilita este transporte en la app
normal ni mediante configuración de producción.

En modo real, válido/HTTP inválido/429 usan servicios reales. Corte, vacío y
safety son fallos controlados sobre la respuesta de Gemini; la indisponibilidad
completa se inyecta antes del transporte para no depender de una caída real de
OpenRouter. No se afirma que esos errores fueran causados por los proveedores.
Los tests de contratos comprueban además que safety no admite más de un intento
extra. El humo remoto exige contenido SSE, modelo, proveedor y X-Request-Id.

## Redacción y rotación

Logger y telemetría redactan claves activas incluso dentro de errores, URLs y
campos anidados; los comandos de preproducción también filtran stdout/stderr.
Los tests inyectan un secreto canario, revisan salida y persistencia, preservan
contadores de tokens y escanean assets del navegador/evidencia por secretos
activos. Las capturas usan datos ficticios y nunca abren el archivo de claves.
No se garantiza limpiar exportaciones históricas producidas antes de esta
protección: sanitizarlas con la plantilla siguiente antes de entregarlas.

Después de registrar el resultado: revocar claves Google y OpenRouter, rotar
el token Redis o eliminar la base aislada, apagar el servicio temporal y borrar
`.env.preprod` local cuando ya no sea necesario. No borrar ni resetear Redis
de producción. Una nueva ejecución requiere nuevas claves limitadas.

## Plantilla de traza sanitizada y diagnóstico preparado

Conservar: timestamp UTC, requestId, attemptId, stage, mode, requestedModelId,
effectiveModelId, provider/respondingProvider, retry, fallbackReason, outcome,
status HTTP, errorCode, finish_reason, duración, prompt/completion/reasoning
token counts, usage_units, cost_usd, cost_estimated y cost_basis. Conservar el
orden de los eventos reset/content/done sin conservar el contenido.

Borrar: Authorization, cookies, claves, tokens, URLs con query, headers de
usuario, IP/datos personales, prompts/respuestas, archivos y base64. Sustituir
la IP por un seudónimo estable si hay que relacionar cuotas entre requests.

Con el request ID:

1. Filtrar logs JSON por `requestId` exacto y ordenar por timestamp/attemptId.
2. Consultar, con acceso de lectura, `HGETALL {aedos-provider-calls}:request:<requestId>`.
   Si el índice expiró (30 días), consultar el export de logs o buscar el ID en
   el stream `{aedos-provider-calls}:attempts` retenido; no inventar datos faltantes.
3. Relacionar `provider_call`, advertencias de fallback y `chat_usage`. Separar
   HTTP no aceptado, aceptación sin terminal SSE, safety, timeout y límite de gasto.
4. Verificar que todos los `effectiveModelId` coincidan con el elegido; el modelo
   directo Google se normaliza mediante requested/effective ID del catálogo.
5. Buscar en `{aedos-spend}:overages` eventos con ese ID y el estado preventivo
   `{aedos-spend}:paused`; contrastar cuotas del proyecto Google a esa hora.
6. Comparar intentos completos, reset y única liquidación; contrastar costos con
   usage/factura y marcar estimaciones. Informar causa, evidencia, corrección y
   reproducción; dejar como indeterminado cualquier dato que la traza no permita.

Fuentes para preparar accesos: [claves Gemini](https://ai.google.dev/gemini-api/docs/api-key),
[cuotas por proyecto](https://ai.google.dev/gemini-api/docs/rate-limits),
[límites de claves OpenRouter](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys)
y [REST de Upstash](https://upstash.com/docs/redis/features/restapi).
