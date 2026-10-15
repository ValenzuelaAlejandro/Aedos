# Decisiones vigentes del Bloque 2

Revisión: 15 de octubre de 2026, America/Tijuana. Implementado localmente; sin
despliegue. Este documento sustituye las propuestas anteriores de precios y
presupuesto. La app es gratuita: los créditos son capacidad de uso, nunca ingresos.

## Escala única y motivo del cambio

El código recibido tenía una escala histórica más alta para los cuatro modelos créditos por
slide Flash/Pro. La primera auditoría había propuesto multiplicar por 0.4;
posteriormente se restauró la escala original por la aprobación provisional
anterior. Eso dejaba Gemini Pro de 15 slides en 120 créditos y limitaba su
slider a 6 con el cupo de 50. Fue una inconsistencia de producto.

La instrucción actual delega resolverla. Se elige **la escala 0.4× como única
vigente**, conservando 50 créditos/IP/día UTC, Flash 1–8, Pro 1–15 y Pro = 2×
Flash. No se aumenta ni se reescala el saldo. El backend define las constantes
en `src/backend/config/usage-policy.js`; el catálogo y API derivan de ellas.
El catálogo frontend de arranque las refleja y las pruebas detectan divergencias.

| Modelo | Flash créditos/slide | Pro créditos/slide | Flash máximo: 8 slides | Pro máximo: 15 slides |
| --- | ---: | ---: | ---: | ---: |
| Gemini | 1.6 | 3.2 | 12.8 créditos · 25.6% | 48 créditos · 96% |
| Haiku | 1.2 | 2.4 | 9.6 créditos · 19.2% | 36 créditos · 72% |
| GPT | 1.2 | 2.4 | 9.6 créditos · 19.2% | 36 créditos · 72% |
| Nemotron | 0.8 | 1.6 | 6.4 créditos · 12.8% | 24 créditos · 48% |

Un crédito = 1,000 unidades internas = 2% del cupo. La tabla cuenta una
presentación que completa correctamente. Fallos no debitan al usuario;
fallback exitoso liquida una vez. Solo se liquida lo efectivamente entregado.

Con saldo completo, todo valor del slider cabe para todo modelo/modo. Después
de consumir saldo, el máximo visible también se acota por
`floor(remainingUnits / rate)`. Si no cabe ni una slide se deshabilita Generar
y se muestra uso insuficiente; el backend rechaza una petición manipulada
antes del proveedor. Cambiar el modo también actualiza el máximo.
`tests/frontend-credits.test.js` recorre los 92 valores modelo/modo/cantidad,
valida el límite de modo, compara UI/API/backend y reserva contra un ledger
con saldo real completo. Cambiar precios, cupo o límites de forma incompatible
hace fallar la prueba.

El chat conserva su política por tokens ponderados; no usa el precio por slide.
Referencia Gemini Flash: 2,000 tokens de entrada + 500 de salida ponderada ×5
equivalen a 1 crédito. Pesos por modelo y mínimo de 250 unidades están en
`usage-policy.js`; Pro duplica exactamente el resultado Flash. Sin usage
válido se estima con tokenizer y se marca en telemetría. Modelo y Pro quedan
bloqueados por conversación en frontend y backend; el idioma se puede cambiar.

## Presupuesto del propietario

Estos son los **defaults activos del código y .env.example**. Variables de
entorno del proceso pueden sustituirlos; los valores efectivamente instalados
en producción todavía no se han inspeccionado ni modificado. La inspección
limitada a esas variables numéricas no encontró overrides locales.

| Límite | Default USD | Variable |
| --- | ---: | --- |
| Global diario UTC | 0.25 | `PAID_SPEND_DAILY_USD` |
| Global mensual UTC | 1.00 | `PAID_SPEND_MONTHLY_USD` |
| Una IP por día UTC | 0.24 | `PAID_SPEND_PER_IP_DAILY_USD` |
| Request completo, entre intentos y etapas | 0.24 | `AI_SPEND_MAX_REQUEST_USD` |
| Margen por reserva | 1.25× | `AI_SPEND_RESERVATION_MARGIN` |
| Piso de saldo OpenRouter, si se consulta | 1.00 | `PAID_BALANCE_FLOOR_USD` |

El margen es configurable pero no baja de 1×: un valor menor no puede
autorizar una reserva inferior al estimate. El default permanece en 1.25×.

Las cifras anteriores de un diario y mensual exploratorios insuficientes eran el presupuesto exploratorio.
el mensual exploratorio implicaba en promedio $1/día y no podía sostener el objetivo de 100
usuarios diarios a ≈$0.15 por presentación Gemini Pro de 15 slides.
Defaults originales del dueño: $0.25/día y $1/mes. Se conservan; el límite compartido protege el gasto de un servicio gratuito.
Es capacidad presupuestada para un lanzamiento gratuito, no una medición de
usuarios ni una garantía de que cada request termine a ese costo.

El cap de $0.24/IP/día queda por debajo del diario global de $0.25 y permite un deck típico de
$0.15 con reserva de $0.1875 al margen 1.25. Mantenerlo igual al cap por request
impide repetir requests para evitar el límite por IP. La escala de créditos
no altera las tarifas del proveedor: Gemini Pro de 15 slides ahora sí cabe por
48 créditos y ≈$0.15 típico. El máximo nominal por IP sigue siendo $0.24,
incluso si usa los 50 créditos en muchas operaciones distintas.

| Caso | Envolvente nominal / IPs necesarias |
| --- | --- |
| Peor caso admitido por request | $0.24 entre proveedores, reintentos y reparaciones |
| Máximo por IP al día | $0.24 y 50 créditos |
| Agotar $0.25 en un día | 2 IPs: una llega a $0.24 y otra consume hasta $0.01 |
| Agotar $1 en un mes | 4 días al tope global de $0.25; varias IPs pueden alcanzar el tope diario en cada día |
| Mes de 28/29/30/31 días | El cap mensual de $1 es el límite efectivo; el diario de $0.25 solo permitiría $7/$7.25/$7.50/$7.75 |
| Gemini Pro de 15 slides, todo en OpenRouter | 48 créditos = 96%; ≈$0.15 típico, hasta $0.24 nominal admitido por guard |

La rotación de IP multiplica los cupos gratuitos. No aumenta el presupuesto
USD compartido, pero sí puede agotarlo y perjudicar disponibilidad. NAT, VPN
y redes escolares impiden tratar IP como identidad. Sin cuentas verificadas
no se promete impedir este abuso. La política mantiene el límite global;
no lo eleva automáticamente para compensar IPs nuevas. Para otra escala de
DAU, cambiar las variables de presupuesto y volver a medir, sin tocar precios
de uso salvo nueva decisión explícita.

## Reserva, límites duros y demostración numérica

Cada transporte obtiene una reserva Redis atómica ANTES de llamar al proveedor:
`ceil(estimatedUsd × 1.25 × 1,000,000)`. Se comprueba
`settledMicroUsd + reservedMicroUsd + nuevaReserva <= 240,000`,
además de día, mes e IP. Una llamada individual sobredimensionada se rechaza
incluso sin contexto HTTP. HTTP mantiene el estado agregado de toda la petición.

Límites independientes del presupuesto: 27 llamadas de proveedor como máximo,
600,000 ms por request, 180,000 ms por stream; salida máxima Flash 8,192,
Stage1 4,096, Stage2 4,096, Stage3 16,384 tokens. Chat limita entrada a 12,288
y salida a 4,096. Los loops de reparaciones/reintentos también quedan dentro
del mismo contador, reloj y presupuesto; safety permite un intento adicional.

**No se promete ejecutar 27 llamadas al máximo de tokens por $0.24.** El
presupuesto autoriza un prefijo acotado y rechaza la siguiente reparación o
fallback si no cabe. Sin ese rechazo, 27 Stage3 de Gemini con 60,000 bytes de
prompt costarían hasta $2.150928 estimados, o $2.68866 de reservas con margen.

Ejemplo conservador reproducido por prueba: 60,000 bytes de texto por etapa,
más 1,024 tokens de sobrecarga; Gemini configurado a $0.50/M entrada y $3/M
salida. Stage1/2 cuestan hasta $0.0428 cada una; Stage3 hasta $0.079664.
Total de las tres: $0.165264. Reservarlas simultáneamente requeriría $0.20658;
la ejecución secuencial reserva antes de cada llamada y liquida después.
Una cuarta Stage3 al máximo se rechaza antes de transporte porque
$0.165264 + $0.09958 de nueva reserva supera $0.24.

El bound de entrada cuenta bytes UTF-8 del texto/payload y añade 1,024 tokens;
adjuntos y OCR requieren verificar metadatos reales en preproducción. Los
requests cuyo estimate no cabe se rechazan, sin asumir costo cero ni recortar
silenciosamente contenido. El límite remoto de salida incluye razonamiento
según el contrato del proveedor. Las tarifas configuradas se fijan además en
`provider.max_price`, con `require_parameters: true`, en OpenRouter:
se excluyen rutas más caras o que no respeten los parámetros, manteniendo el
mismo modelo. Si no queda ruta compatible, se devuelve error.

Fuentes primarias consultadas el 15-10-2026:
[tarifas Gemini/OpenRouter](https://openrouter.ai/google/gemini-3-flash-preview),
[precio máximo por proveedor](https://openrouter.ai/blog/tutorials/how-to-get-the-lowest-cost-llm-inference-on-openrouter/),
[tokens de razonamiento OpenRouter](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens),
[límite conjunto de pensamiento y salida Gemini](https://ai.google.dev/gemini-api/docs/generate-content/thinking?hl=en).
$0.15 es el escenario típico de planificación recibido, no un máximo ni una
medición pagada de este trabajo.

## Costo real superior y comportamiento de los topes

El costo reportado sustituye el estimate al liquidar. Si supera la reserva,
Lua registra request ID, proveedor, modelo, reserva, costo real y diferencia
en `{aedos-spend}:overages`, marca `alert=critical` y activa una pausa de una
hora en `{aedos-spend}:paused`. Stderr emite `provider_spend_overage`.
Toda reserva posterior, incluido fallback, queda bloqueada durante la pausa.
Configurar una alerta de operación para ese evento es un paso del runbook;
no se ha configurado un servicio externo de alertas.

La prueba automatizada de adapter simula un usage real superior, confirma
reserva ANTES de transporte y que una petición posterior, incluso desde otra
IP, no llama al proveedor. Redis local ejecuta el Lua real: reserva $0.0125,
liquida $0.02, registra exceso $0.0075 una sola vez y conserva evento/pausa
tras reiniciar. $0.24 es una cota nominal de admisión; un proveedor ya llamado
puede facturar por encima de su contrato/estimate. No hay garantía matemática
sobre facturación externa inesperada.

Día/mes/IP/request agotados o pausa rechazan ANTES del siguiente proveedor,
sin cambiar modelo y sin consumir uso gratuito por una operación fallida.
La UI muestra el mensaje de presupuesto/uso correspondiente. El fallback se
bloquea también si requeriría una nueva reserva que no cabe. Redis caído falla
cerrado. Intentos fallidos pueden costar al propietario aunque no debiten
créditos al usuario.
El mensaje de presupuesto no promete desbloqueo con el reinicio diario: un
tope puede ser del request, mensual o una pausa preventiva. Permite acortar
la petición o reintentar más tarde, sin sugerir un cambio automático de modelo.

## Operación y pruebas

Migración lazy y atómica: 1 crédito legacy → 1,000 unidades; mirrors legacy
permiten rollback sin regalar fracciones. `npm run verify:all` incluye contratos,
matriz de proveedores, streaming UI, calidad y baseline conocido aislado.
`npm run verify:redis:local` comprueba ACL, persistencia, concurrencia,
liquidación, reembolso idempotente, débito único y exceso real simulado.
`node scripts/capture-block2-ui.js` actualiza evidencia de uso/slider/topes.
`npm run verify:preprod` exige aislamiento y credenciales; las pruebas reales
siguen pendientes. Ver [DEPLOY-PLAN.md](DEPLOY-PLAN.md).


## Ensayo sin credenciales y entrega externa

`npm run verify:preprod -- --rehearsal` pasó con la app real, proveedores HTTP
falsos y Redis local aislado; ejecuta los mismos scripts del modo real y
verifica bloqueo de red externa, aislamiento, redacción, errores y liquidación.
Resultados: [evidence/preprod/rehearsal-results.json](evidence/preprod/rehearsal-results.json).
Para la ejecución remota se exige `.env.preprod` local ignorado por git; no
se reutilizan claves omitidas desde el entorno heredado. Formatos, permisos,
cuotas, revocación y diagnóstico: [PREPROD-HANDOFF.md](PREPROD-HANDOFF.md).
La integración real y la causa del incidente siguen pendientes.

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
