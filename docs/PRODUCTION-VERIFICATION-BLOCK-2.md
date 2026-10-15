# Verificación aislada del Bloque 2

Código local: Gemini 1.6/3.2, Haiku/GPT 1.2/2.4, Nemotron 0.8/1.6
créditos/slide Flash/Pro. Cupo 50 créditos/IP/día UTC; Flash 1–8 y Pro 1–15.
Pro cuesta exactamente el doble de Flash. Todos los máximos de modo caben
en saldo completo; si queda menos saldo, el slider y Generar se ajustan.

Defaults USD: $0.25/día, $1/mes, $0.24/IP/día y $0.24/request,
margen 1.25; máximo 27 llamadas, diez minutos por request y tres por stream.
La justificación, porcentajes y límites están en
[DECISIONS-BLOQUE-2.md](DECISIONS-BLOQUE-2.md).

Comprobaciones locales:
`npm run verify:all`, `npm run verify:redis:local` y
`node scripts/capture-block2-ui.js`. Redis local usa ACL nombrada, default
deshabilitado, RDB y reinicio. Incluye un costo real simulado mayor a la
reserva, evento crítico idempotente y pausa persistente tras reiniciar.
Las capturas verifican uso estimado, slider Flash/Pro, saldo bajo y tope USD
en 390/1440 claro/oscuro.

La integración real se ejecutará con **`npm run verify:preprod`**.
No es una prueba puramente local: requiere las cinco entradas externas de
[DEPLOY-PLAN.md](DEPLOY-PLAN.md). No se ha ejecutado sin esas credenciales.

Primero se comprueba cada dato, acknowledgements, hostname staging/preprod,
HTTPS y origen Redis; si falta algo, no hay llamadas externas. Después se
consulta /health sin seguir redirecciones. Debe responder attestation de
NODE_ENV=preproduction, etiqueta staging y fingerprint del mismo Redis.
Un servidor production no la emite; sin ella no hay llamadas de proveedor ni
escrituras Redis. También se deniegan explícitamente los hosts productivos.

La suite real cubre Gemini válido, HTTP auténtico de key de prueba inválida,
429 exacto de proyecto de cuota baja, corte inyectado después de texto de una
respuesta real Gemini y retry OpenRouter con el mismo modelo. Las llamadas
directas de prueba usan salida de 512 tokens y cap $0.05 por request/IP;
el smoke del servicio usa el presupuesto configurado de preproducción.
También hay un smoke directo de Haiku, GPT y Nemotron, con política real de
razonamiento, ruta compatible y techo de tarifa; el router conserva la cota
de salida de la prueba. 512 deja margen para razonamiento más respuesta visible.
El guard global de esos adapters de prueba es $0.25/día y $1/mes en la base
aislada; no reemplaza los defaults de producción $0.25/$1.
La matriz sintética adicional cubre SSE, safety, timeout y OpenRouter no
disponible, con limpieza de parcial y débito único. Un 400 no sustituye a 429
y el corte controlado no demuestra la causa del incidente histórico.


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
