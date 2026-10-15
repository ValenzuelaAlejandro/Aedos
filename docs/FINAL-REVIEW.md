# Revisión final independiente

Revisión local del 15-10-2026 (America/Tijuana). **No listo para desplegar**:
faltan la integración real aislada con proveedores/Redis/proxy y la traza para
diagnosticar el incidente histórico. El comando y sus bloqueos están listos;
la única entrada pendiente es la lista externa ya definida. No se ha desplegado.
El baseline visual conocido sigue aislado como excepción explícita, sin
regenerar imágenes ni alterar umbrales.

## Lista original y evidencia

| Punto | Estado | Evidencia / límite práctico |
| --- | --- | --- |
| Orbs fuera del canvas móvil | Corregido localmente | `npm run test:streaming-ui`; geometría y capturas chat/presentación 390/1440 claro/oscuro en [block4](evidence/block4/). |
| Texto bajo las orbs en claro | Corregido localmente | Contraste medido ≥14.30:1 en los temas probados; retry usa el texto existente, traducido, sin banner/toast/icono de error. |
| Pro solapado con idioma | Corregido localmente | Geometría en navegador 390/1440, más comprobaciones previas 320/360; capturas Block 4 y slider Pro Block 2. |
| Icono de idioma descentrado | Corregido localmente | Alineación y cajas verificadas; capturas 390/1440 claro/oscuro. |
| “Servidor despertando” no aparece o se borra al escribir | Corregido localmente | Harness de carga lenta/503 y `frontend-credit-loading.test.js`; escribir no limpia la espera. Capturas `usage-loading-*`. |
| Pro = Flash en costo | Corregido | Escala única por slide, Pro = 2× Flash. Chat ponderado también duplica exactamente. Contratos de precios, usage-policy y tabla abajo. |
| Modelo y Pro cambiables en chat | Corregido localmente | Deshabilitados y visibles; backend rechaza peticiones manipuladas por conversación. Idioma libre, probado durante chat. Capturas `conversation-lock-*`. |
| Slider distinto de lo generado | Corregido localmente | Flash 1–8, Pro 1–15, todos caben en saldo completo. Prueba exhaustiva de 92 valores UI/backend/ledger; contratos de conteo/completado solo de slides faltantes. |
| Errores Gemini sin fallback | Parcial: corregido local, pendiente real | Matriz 429/5xx/timeout/vacío/corte/SSE/safety con OpenRouter disponible/no disponible. Mismo modelo, reset parcial, stream nuevo y débito único. Falta ejecutar proveedores reales y diagnosticar traza histórica. |
| Chat sin cobro coherente | Corregido localmente; pendiente conciliación real | Tokens ponderados, commit solo al completar, estimate marcado sin usage, sin historial parcial. Contratos, matriz de fallback y Redis local. |

## Escala final

Cupo: 50 créditos/IP/día UTC = 50,000 unidades. La escala 0.4× queda vigente
para que todo máximo quepa; las cifras de reportes anteriores se sustituyeron.
La explicación del cambio está en [DECISIONS-BLOQUE-2.md](DECISIONS-BLOQUE-2.md).
Los tests también verifican que esta tabla coincide exactamente con el código.

| Modelo | Flash créditos/slide | Pro créditos/slide | Flash máximo: 8 slides | Pro máximo: 15 slides |
| --- | ---: | ---: | ---: | ---: |
| Gemini | 1.6 | 3.2 | 12.8 créditos · 25.6% | 48 créditos · 96% |
| Haiku | 1.2 | 2.4 | 9.6 créditos · 19.2% | 36 créditos · 72% |
| GPT | 1.2 | 2.4 | 9.6 créditos · 19.2% | 36 créditos · 72% |
| Nemotron | 0.8 | 1.6 | 6.4 créditos · 12.8% | 24 créditos · 48% |

Con saldo parcial, el rango se reduce a lo asequible; sin saldo para una slide,
slider y Generar se deshabilitan y aparece el mensaje de uso insuficiente.
La API calcula el precio y valida modo/cantidad sin confiar en el frontend.

## Presupuesto y exceso

| Concepto | Default / resultado |
| --- | --- |
| Request / IP al día | $0.24 nominal por cada límite |
| Global día / mes | $0.25 / $1; configurables por entorno |
| IPs para agotar diario | 63: 62 completas y $0.12 de la última |
| IPs para agotar mensual | 1,875 IP-días equivalentes; 63 recurrentes en 30 días, 61 en 31 días |
| Mes de 28/29 días | El diario limita el agregado a $420/$435 |
| Gemini Pro 15 por OpenRouter | 48 créditos, 96%; ≈$0.15 típico recibido como escenario de planificación |
| Request acotado probado | Tres etapas Pro con 60,000 bytes cada una: $0.165264 estimados; la siguiente reparación máxima se rechaza antes del proveedor |
| Exceso probado en Redis real | Reserva $0.0125 → costo simulado $0.02; exceso $0.0075, evento crítico idempotente, pausa y persistencia tras reiniciar |

Máximo 27 llamadas, 10 minutos por request, 3 minutos por stream y salida
acotada por etapa. El guard reserva antes de cada transporte y OpenRouter
recibe precio máximo y parámetros requeridos. Una IP puede gastar como máximo
1.6% del presupuesto global diario; múltiples IPs pueden agotarlo, pero no
elevar el cap compartido. IP no equivale a identidad.

El cap es nominal: un cobro real externo superior aún puede exceder la reserva
del request ya iniciado. Está probado el registro/alerta crítica y pausa de
reservas posteriores durante una hora. La alerta se emite a logs y Redis;
configurar el canal externo de monitorización sigue siendo operación de despliegue,
sin credencial adicional pedida ahora.

## Calidad y comprobaciones

- `npm run verify:all` pasó con código 0; integra baseline determinista, contratos, matriz de
  proveedores, streaming UI, calidad y las firmas visuales conocidas aisladas.
- `npm run verify:redis:local` pasó con ACL default off, usuario nombrado,
  RDB/reinicio, migración 1:1000, concurrencia, liquidación, refund idempotente,
  débito único, telemetría y exceso/pausa persistentes.
- Calidad: 0 errores TypeScript; 31 avisos ESLint heredados (40 recibidos en este cierre).
  El ratchet previo ignoraba severidad error. Ahora verifica también los
  59 diagnósticos previos reproducidos contra HEAD y falla ante cualquiera
  nuevo; no se afirma que `npm run lint` esté libre de deuda.
  Inventario y alcance: [LINT-DEBT.md](LINT-DEBT.md).
- Se corrigieron los nueve avisos de prompts, diccionarios y logger. El resto
  corresponde a cuerpos ajenos intactos, incluso en archivos con firmas/tipos
  modificados previamente; se documenta su alcance sin refactor global.
- La suite visual conocida reproduce solo sus firmas documentadas y rechaza
  fallos diferentes: [KNOWN-VISUAL-BASELINE-ISSUE.md](KNOWN-VISUAL-BASELINE-ISSUE.md).
- Evidencia actualizada de uso, saldo, slider por modo y tope: [índice de capturas](evidence/block2/README.md).
  El harness captura 390/1440 px claro/oscuro y se inspeccionaron las imágenes.
- La prueba de aislamiento verifica todos los datos ausentes, hosts productivos,
  acknowledgements, Redis distinto y attestation production ausente. Sin los
  datos no se hace ninguna llamada externa. Sin attestation válida no se
  genera ni se escribe en Redis.

El ensayo aprobado está registrado en
[evidence/preprod/rehearsal-results.json](evidence/preprod/rehearsal-results.json).

La preparación real usa la política de razonamiento del catálogo y conserva
el límite de 512 tokens en el router y en cada adapter. Incluye Gemini y sus
fallos HTTP/429/corte/vacío/safety e indisponibilidad controlada, más un smoke directo Haiku/GPT/Nemotron. Los 128 tokens
del primer harness se sustituyeron por 512 para dejar espacio a pensamiento
y texto visible. Ninguna llamada real se ha contado como probada sin claves.

## Cierre adicional: margen, aislamiento y handoff

La prueba de handler completo en `slide-generation.test.js` toma el quote
real del servicio frontend, reserva mediante middleware y entrega Gemini Pro
15: la liquidación final es exactamente 48.000 unidades (96%), saldo 2.000
(4%). Los 92 valores del slider también concuerdan entre UI y backend, con
replay de commit sin doble débito. Una entrega incompleta liquida solo slides
entregadas; el estimado completo es máximo, no promesa de cobrar slides ausentes.

El mínimo liquidado de chat es 250/500 unidades Flash/Pro; iniciar exige cubrir
la reserva de tokens completa. Gemini Pro reserva 14.564 unidades (29,128%;
la UI muestra 29,1%). El 4% no permite ese chat ni otra slide Pro. Se explica
en EN/ES, se deshabilita enviar y se ofrece Nueva conversación para elegir
otro modelo/modo; el modelo actual nunca cambia. Una slide Gemini Flash cabe
en las 2.000 unidades restantes. Capturas `chat-margin-*` en 390/1440 claro/
oscuro, derivadas de un commit de ledger local, junto a `usage-insufficient-*`.

`npm run verify:preprod -- --rehearsal` ejecuta la misma suite que el modo real
con la app HTTP real, Gemini/OpenRouter falsos y Redis local aislado. Cubre
válido, HTTP, 429, corte, vacío, safety, indisponibilidad, débito único y
request IDs. El bloqueo de conexiones externas, producción, ACKs y redacción
de secretos tienen contratos automatizados. Las inyecciones controladas
están descritas en [PREPROD-HANDOFF.md](PREPROD-HANDOFF.md); no se equipara
el ensayo a proveedores/proxy remotos reales.

No se rehidratan precios desde Redis, localStorage ni request/env: solo se
migran saldos y estados idempotentes. Catálogo congelado, namespace usage-v2,
migración 1:1000, respuestas no-store y assets versionados evitan restaurar
una escala antigua. Los requests pendientes de una versión vieja deben
drenarse antes de sustituir la revisión, como exige el runbook; no se borra
ni recalcula el consumo histórico de usuarios a mitad del día. Los topes USD
sí son configurables por entorno y se revisarán en staging antes de desplegar.

La política generada al final de cada documento se compara exactamente con
config por test; las tablas de precios y catálogos frontend/backend también.
`node scripts/policy-documentation.js --write` sincroniza esos bloques.

## Archivos y reproducción

- Precios y límites: `src/backend/config/usage-policy.js`,
  `src/backend/config/provider-spend.js`, catálogo frontend y `.env.example`.
- Reserva y rutas: `src/backend/utils/spend-guard.js`,
  `src/backend/providers/openrouter.js` y `model-selection.js`.
- Aislamiento real: `src/backend/utils/preproduction-isolation.js`,
  `src/backend/http/routes/entry.js` y `scripts/prod-checks/`.
- Secretos: `src/backend/utils/redact-secrets.js`, logger y telemetría,
  `scripts/prod-checks/redacted-output.js`; contratos de redacción y persistencia.
- Frontend: `credits-ui.js`, `credits-service.js`, `i18n-en.js`, `i18n-es.js`,
  su cargador `i18n.js`, versiones de assets en `index.html` y contraste de saldo.
- Política documental: `scripts/policy-documentation.js`, bloques de config
  generados y sus tests de consistencia.
- Calidad: `scripts/lint-ratchet.js`, inventarios de lint en
  `tests/baseline/`, orquestación de prompts y eliminación de asignaciones
  sin uso en los bloques modificados. El baseline visual permanece intacto.
- Pruebas: `tests/frontend-credits.test.js`, contratos de créditos/modelos,
  `same-model-fallback.test.js`, `preproduction-safety.test.js`,
  `policy-documentation.test.js`, `rehearsal-network.test.js`,
  `preproduction-redaction.test.js`, `tests/spend-guard.test.js` y
  `scripts/redis-local/verify-local-redis.js`.
- Evidencia UI: `scripts/capture-block2-ui.js` y 32 PNG originales en
  `docs/evidence/block2/`, junto a las ocho capturas de streaming Block 4.

Reproducir: `npm run verify:all`, `npm run verify:redis:local`,
`node scripts/capture-block2-ui.js`, `npm run verify:preprod -- --rehearsal` y, una vez entregada la lista externa,
`npm run verify:preprod`. El registro resumido de resultados está en
[evidence/quality/verification-results.json](evidence/quality/verification-results.json).

## Bloqueadores y única lista externa

La integración real y el incidente histórico siguen **pendientes**. El formato,
permisos/cuotas y revocación de cada entrada están en
[PREPROD-HANDOFF.md](PREPROD-HANDOFF.md) y `.env.preprod.example`.
Entregar solo las entradas siguientes; los secretos se entregan en
un archivo local `.env.preprod` ignorado por git; no se incluyen en repositorio, capturas ni logs:

1. `AEDOS_PREPROD_URL=https://aedos-staging.<dominio>`, con confirmación de
   que es un entorno aislado. Preparación del servicio en [DEPLOY-PLAN.md](DEPLOY-PLAN.md).
2. `GEMINI_API_KEY=<key-válida-de-prueba>` y
   `AEDOS_GEMINI_429_API_KEY=<key-de-proyecto-de-cuota-baja>`.
3. `OPENROUTER_API_KEY=<key-de-prueba-con-saldo-limitado>`.
4. `UPSTASH_REDIS_REST_URL=https://<base-aislada>.upstash.io`,
   `UPSTASH_REDIS_REST_TOKEN=<token>` y etiqueta `staging-<nombre>`.
5. Request ID o traza sanitizada del incidente: timestamp, proveedor, modelo,
   status/código, request/attempt IDs y eventos SSE; excluir contenido del
   usuario, datos personales, adjuntos, tokens de autenticación y claves.

Las confirmaciones de aislamiento son valores literales del runbook, no datos
adicionales. Con esas entradas se ejecutará `npm run verify:preprod`, se
corregirá cualquier fallo y se repetirá hasta pasar, antes de emitir el
veredicto final. Incluso entonces se esperará la instrucción “despliega”.

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
