# Plan de preproducción, despliegue y rollback

Estado: runbook preparado; **no se ha desplegado**. Los bloques deben salir
juntos en una misma revisión compatible, en el orden técnico Bloque 1 → 4 → 3
→ 2. No probar contra el sitio ni el Redis de producción.

Escala vigente: Gemini 1.6/3.2, Haiku/GPT 1.2/2.4, Nemotron 0.8/1.6
créditos/slide Flash/Pro. Cupo 50 créditos/IP/día UTC; todos los modelos
permiten Flash hasta 8 y Pro hasta 15 con saldo completo. Gemini Pro máximo
usa 48 créditos (96%). Estos precios sustituyen las cifras de reportes previos.
Los defaults USD permanecen $0.25/día, $1/mes y $0.24 por request e IP/día;
la justificación y la envolvente están en [DECISIONS-BLOQUE-2.md](DECISIONS-BLOQUE-2.md).

## Verificación real de preproducción

`npm run verify:preprod` es el comando único. Antes de iniciar, valida todas
las variables y confirmaciones de aislamiento; después corre la matriz de
fallos sintéticos, Redis local con ACL/reinicio, Redis remoto aislado, smoke SSE
de Gemini sobre el servicio de preproducción y llamadas reales con Gemini y
OpenRouter desde los mismos adapters del repo. El harness ejecuta una respuesta
Gemini válida, un HTTP de autenticación fallido con sufijo inválido, una cuota
Gemini de proyecto bajo que debe producir 429 y un corte inyectado después de
recibir un frame de contenido real de Gemini. Los tres últimos deben reintentar
el mismo modelo con OpenRouter. El corte se inserta en el lector local entre el
servidor de Google y el adapter; es un corte real de una respuesta upstream,
pero no afirma que Google causara el corte histórico.

Entregar las claves mediante `.env.preprod` local ignorado por git, copiando
`.env.preprod.example`. El runner lo carga automáticamente; formatos, ACKs,
permisos, cuotas y revocación en [PREPROD-HANDOFF.md](PREPROD-HANDOFF.md).
No incluir valores reales en la terminal, capturas o documentación.

```powershell
npm run verify:preprod -- --rehearsal
npm run verify:preprod
```

El servicio detrás de `AEDOS_PREPROD_URL` debe tener una key Gemini de prueba
válida y las mismas versiones/cambios de backend y frontend de esta revisión.
Configurar allí `NODE_ENV=preproduction`, `AEDOS_REDIS_TEST_LABEL=staging-...`,
`AEDOS_REDIS_TEST_ACK=ISOLATED_PREPRODUCTION_REDIS_ONLY` y la URL/token de la
misma base aislada que usará el verificador. Son las entradas ya definidas,
sin credenciales adicionales. El hostname remoto debe contener un segmento
`staging`, `preprod`, `preproduction` o `isolated`; se permite loopback local.
`/health` emite una attestation sin secretos únicamente con esa configuración.
El runner exige entorno preproduction y coincidencia de etiqueta/fingerprint
Redis, con redirecciones desactivadas, ANTES de generar o escribir en Redis.
Un servidor production devuelve su health habitual y no autoriza la suite.
`GEMINI_API_KEY` y `AEDOS_GEMINI_429_API_KEY` se usan solo desde el proceso
local de verificación; OpenRouter también se usa localmente. Las llamadas
generan contenido breve, limitan salida a 512 tokens y usan topes de prueba
estrictos ($0.05 por request/IP); puede haber un costo real pequeño del proveedor.
Se usan 512 para dejar espacio al razonamiento y al saludo visible; el router
conserva ese límite en directo y fallback, sin ampliarlo al máximo del modelo.
La suite prueba también Haiku, GPT y Nemotron directamente por OpenRouter, con
la política real de razonamiento y los techos de precio del catálogo.
Los adapters del harness conservan los globales de $0.25/día y $1/mes, con
los límites por request/IP de prueba más estrictos ya indicados.
La base Upstash remota recibe claves aleatorias con TTL, no borra claves del
usuario. Confirmar que ambas Redis variables apuntan a bases separadas de
producción. Al terminar, revocar las claves temporales y retirar `.env.preprod`, según el handoff.

El comando falla rápido antes de cualquier llamada externa si faltan entradas o
una confirmación de aislamiento. El smoke remoto exige SSE, `X-Request-Id`,
contenido antes del evento final, proveedor Gemini y modelo elegido. El harness
de adapters comprueba status/motivo HTTP, reset del stream, contenido parcial
antes del corte, recuperación OpenRouter con el mismo modelo y correlación por
request ID en logs/telemetría. La matriz sintética cubre además 5xx, timeout,
respuesta vacía, safety, OpenRouter disponible/no disponible, un único débito y
limpieza del parcial en chat/presentación.

Si el test de 429 no ve exactamente una respuesta de cuota 429, la suite falla;
no lo cuenta como error de autenticación ni continúa como si fuera cuota baja.
El script del endpoint remoto valida Gemini configurado en el servicio y no
cambia la configuración remota. La prueba local de fallback usa la key de
Gemini adulterada y la de OpenRouter válida en los adapters de este checkout.
Antes de exponer usuarios, también ejecuta en un canary interno el caso de
fallback a través del proxy/CDN previsto, para comprobar que no amortigua SSE.

## Diagnóstico del incidente histórico

Con un `requestId` o traza sanitizada, busca un request y sus intentos:

```text
HGETALL {aedos-provider-calls}:request:<requestId>
XRANGE {aedos-provider-calls}:attempts - + COUNT 100
XRANGE {aedos-spend}:overages - + COUNT 100
```

En logs correlacionados filtra el mismo `requestId` y ordena por timestamp. La
secuencia esperada para fallback correcto es error Gemini con `fallbackReason`,
reset del stream, intento OpenRouter para el mismo `requestedModelId`, cierre
exitoso y un evento de uso. Revisa `errorCode`, `outcome`, latencia, tokens,
`cost_usd`, `cost_estimated`, telemetría no disponible, pausas USD, claves
`usage-v2-request:<requestId>` duplicadas, saldo negativo y eventos de exceso.
El allowlist de telemetría excluye prompt, archivo, key y texto del proveedor.
No atribuir la causa al incidente hasta recibir su request ID/traza original.

## Orden y ventana de despliegue

Cuando haya aprobación explícita para desplegar:

1. Elegir una ventana de baja actividad y guardar release/configuración actuales
   de forma segura. Revisar uso, saldo del proveedor y gasto Redis. No copiar
   secretos a tickets ni terminal compartida.
2. Fijar los límites acordados en variables de entorno antes de publicar:
   $0.25/día, $1/mes, $0.24/IP/día, $0.24/request, margen 1.25, duración
   máxima 600,000 ms y streams de hasta 180,000 ms. No existe una feature flag
   para ignorar el guard; se debe activar con configuración segura y solo subir
   límites después de observar mediciones.
3. Cerrar temporalmente nuevas peticiones de generación en el proxy/plataforma
   y drenar las activas antes del cambio de escala. No servir versiones viejas
   y nuevas simultáneamente contra el ledger migrado. Publicar backend y
   frontend como una unidad bajo esa ventana de mantenimiento; abrir al canary
   después de los smoke. La migración de créditos es lazy,
   atómica y compatible con la vista legacy; no ejecutar un reescrito masivo.
   Hacer smoke interno de `/health`, `/api/usage`, `/api/models`, chat y una
   presentación Flash mínima, seguidos por un Pro mínimo.
4. Verificar en Redis las claves de saldo `usage-v2`, los mirrors legacy,
   `schema-v2`, las reservas/idempotencia, gasto por día/mes/IP, pausa y stream
   de telemetría. Confirmar `remainingUnits >= 0`, liquidación/refund únicos y
   que error de Redis rechaza el uso pagado.
5. Abrir al canary y comprobar UI/API: sliders Flash 1–8 y Pro 1–15, chat con
   modelo y Pro bloqueados, idioma editable, porcentaje diario, aviso de
   reintento traducido y legible en claro/oscuro. Confirmar inglés/español y
   las opciones de idioma de salida.
6. Mantener observación reforzada 30 minutos, luego revisar las primeras 24 h
   y el gasto mensual diariamente. No ampliar presupuesto para tapar una prueba
   fallida.

## Métricas, alertas y éxito

Correlacionar `provider_call`, `chat_usage`, eventos HTTP y claves Redis con
`requestId`/`attemptId`. Panel y alertas deben mostrar tasa de fallback por
proveedor/motivo; errores HTTP, 429, 5xx, safety, stream y timeout por proveedor;
latencia mediana/p95 por etapa; reservas pendientes y exceso USD; gasto diario,
mensual y por IP; pausas; tasa de error de Redis; saldo negativo/insuficiente;
reembolsos, duplicados de idempotencia, y entregas parciales o fallidas.
Alertar al 75% y 90% de los topes diario/mensual, ante cualquier exceso, al
fallar persistencia/ACL y ante un saldo negativo o débito doble. Excluir prompts,
adjuntos y secretos.

La salida de canary se considera exitosa si los smoke reales, 429, corte,
fallback del mismo modelo y Redis aislado pasan; no hay consumo doble, parcial
mezclado ni saldo negativo; el guard rechaza antes de proveedor al alcanzar sus
reservas y devuelve el saldo intacto; y errores/gasto/latencia/fallback se
mantienen en el nivel esperado. La verificación conocida de `flow-01-landing`
continúa marcada pendiente hasta corregir el harness, sin regenerar imágenes ni
umbrales para forzar el pase.

## Rollback

1. Para detener gasto, establecer `PAID_SPEND_DAILY_USD=0` en el servicio y
   dejar terminar requests abiertos; no cambiar modelos ni limpiar reservas.
2. Revertir aplicación y assets a la revisión guardada. Conservar Redis, claves
   `usage-v2`, `schema-v2`, request IDs idempotentes, reservas, pausa y
   telemetría. No borrar datos para reabrir tráfico.
3. Verificar lectura legacy: la revisión nueva refleja créditos completos hacia
   abajo para clientes antiguos; las fracciones ya consumidas no se regalan. La
   reserva de esquema mantiene los counters legacy consistentes. Probar saldo
   y esquemas sobre el ledger antes de reabrir.
4. Si hubo exceso, dejar cerradas las llamadas pagadas hasta conciliar la fila
   `{aedos-spend}:overages` con la consola del proveedor. No ajustar contadores
   manualmente.
5. Guardar logs del request y sus intentos sin datos del usuario; registrar
   versión, timestamp, proveedor, modelo, razón, tokens/USD y estado de saldo.

## Datos externos pendientes

Para ejecutar el comando hace falta entregar una sola vez: URL aislada de
preproducción y confirmación de no producción; una key Gemini de prueba válida
y otra asociada a un proyecto de cuota baja agotable; key OpenRouter con saldo
limitado; URL/token de Redis aislado; y request ID o traza sanitizada del
incidente para diagnosticarlo. El formato seguro y exacto está resumido en
[`FINAL-REVIEW.md`](FINAL-REVIEW.md); no pegues secretos en archivos o logs.

<!-- CURRENT-POLICY:START -->
Política vigente generada desde config. No editar las cifras a mano.

Cupo diario UTC por IP: 50 créditos = 50000 unidades. Pro = 2× Flash.

| Modelo | Créditos/slide Flash / Pro | Máximo slides Flash / Pro | Uso de presentación máxima Flash / Pro |
| --- | --- | --- | --- |
| Gemini 3 Flash | 1.6 / 3.2 | 8 / 15 | 25.6% / 96% |
| Nemotron 3.5 Lightning | 0.8 / 1.6 | 8 / 15 | 12.8% / 48% |
| GPT-6 Luna | 1.2 / 2.4 | 8 / 15 | 19.2% / 72% |
| Claude Haiku 5.5 | 1.2 / 2.4 | 8 / 15 | 19.2% / 72% |

Topes nominales USD: request 0.24; IP/día 0.24; global/día 0.25; global/mes 1.
Margen de reserva: 1.25; duración máxima request: 600000 ms.
Mínimo liquidado de chat Flash: 250 unidades; Pro: 500. Para iniciar se exige la reserva completa de tokens, no solo ese mínimo.
<!-- CURRENT-POLICY:END -->
