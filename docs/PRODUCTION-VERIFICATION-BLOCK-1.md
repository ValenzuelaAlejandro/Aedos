# Block 1: verification required before deployment

Current single-command entry point: `npm run verify:preprod`, with exactly
the five external inputs listed in `FINAL-REVIEW.md`. Missing inputs fail
offline. A staging/preprod target must then attest `NODE_ENV=preproduction`
and the same isolated Redis label/fingerprint through `/health`; production
does not emit that proof. No paid generation or Redis write starts without
it, and redirects/known production hosts are blocked. Runtime settings and
the current price/budget scale are in `DECISIONS-BLOQUE-2.md` and
`DEPLOY-PLAN.md`; this checklist does not define a separate policy.

Nothing has been deployed. Local fault tests and screenshots use test providers
and isolated/in-memory storage. They do **not** prove live vendor interoperability,
production Redis permissions, or the historic production incident's root cause.
Perform the checks below in a separate local/preproduction process with live
vendor access and an isolated Redis database, before rolling out this revision.
Do not alter the live Gemini key or exhaust a shared project's quota to test it.

## Inputs required for the predeployment run

- A local/preproduction backend configured with the same provider adapter and
  proxy path intended for deployment, but with test-only provider credentials.
- A Gemini test key that can be deliberately made invalid or restricted, plus a
  separate OpenRouter key/account with a small, isolated spend allowance.
- A separate Redis database with deployment-equivalent commands, persistence,
  eviction and ACLs. Do not point this exercise at the live ledger.
- The deployed trusted-proxy/IP settings and one affected production request ID
  (or a sanitized trace) if the goal includes confirming the original incident's
  cause.

No production secret is needed in source control or this document. The live
failure test below uses a real Google HTTP response from the test key, then checks
the OpenRouter retry against the same selected model and request correlation ID.

## Providers and a real Gemini failure

1. Keep provider stubs disabled. Configure a valid OpenRouter key and a separate
   Gemini testing key/project in the preproduction process. Verify the exact
   catalog IDs and the owner USD guard's available budget. A missing key or an
   exhausted spend cap must produce a terminal error, never another model.
2. Run one small normal Gemini chat request and one small presentation. Confirm
   content arrives before done and the chosen model is unchanged. Verify all
   Pro stages independently; content/design must not use the old Flash Lite
   defaults. Verify Claude, GPT and Nemotron directly as well.
3. To obtain a **real HTTP failure from Google**, temporarily use a test-only key
   restricted so it cannot call the Gemini API, or an invalid test key, in that
   isolated process. Leave OpenRouter valid. Google should return an actual
   400/403 rather than a local mock. If a real 429 is specifically needed, use a
   separate low-quota test project; do not intentionally burn production quota.
4. Submit chat and presentation requests from the local browser. Expect a reset,
   only the existing orb text changing to the output-language retry label, and
   a fresh live stream from `google/gemini-3-flash-preview` on OpenRouter.
   Compare `X-Request-Id` with each provider row: failed direct attempt, fallback
   reason, successful OpenRouter attempt, and matching requested/effective model.
   Check one user debit only when done succeeds. Restore the testing Gemini key.
5. A real acceptance failure does not test a midstream cut. Separately interrupt
   a **live testing** response after several chunks using a controlled local
   network fault/proxy. Check that the draft/slides disappear before new content,
   no failed chat turn enters history, and no duplicate sections/reasoning remain.
   Label this as an injected network cut on a real stream, not a proven vendor
   outage. Also set a short `STAGE_TIMEOUT_MS` in the isolated process and
   confirm its per-attempt deadline aborts a stalled upstream read. Check idle
   timeout, normal EOF, provider error frames, empty output, final-error behavior,
   and client cancellation.
6. In an isolated safety test, confirm no more than one additional attempt and
   one clear terminal message if the block persists. Do not weaken safety
   settings. Inspect low reasoning and price-sorted provider routing in actual
   request/usage metadata; Nemotron uses its supported off toggle.
7. Verify attachment interoperability separately (image/PDF/extracted text),
   actual token usage, reported responding provider, and cost settlement. Gemini
   direct USD telemetry is a list-price estimate before free quota; OpenRouter
   usage cost should replace estimates when supplied. Do not treat unknown usage
   on an interrupted request as zero cost.

## Redis, correlation and user credits

Use a separate Redis database with the same permissions/settings as deployment.
Never paste its URL/token into logs or documentation. Test default persistence
with test mode/stubs off; test mode intentionally bypasses the default store.

- Confirm `EVAL`, `XADD`, `HSET`, and `EXPIRE` succeed. For one HTTP request,
  inspect `HGETALL {aedos-provider-calls}:request:<requestId>` and
  `XRANGE {aedos-provider-calls}:attempts - + COUNT 100`.
- Verify a unique attempt ID per actual transport call; one request ID across
  direct/fallback attempts and across Pro stages. Rows need mode, selected and
  effective model, provider, reason, latency, outcome, tokens and USD estimate or
  actual usage. No prompts, keys, attachment data or raw vendor error text.
- Verify the stream's approximately 100,000-row retention and the request index's
  30-day TTL; read the same rows after restarting the backend. Confirm the
  database's persistence and eviction policy are suitable for cost analysis.
- Check atomic reserve/commit/refund with one successful fallback, duplicate
  idempotency keys, cancellation, exhausted retries and interrupted clients.
  Failed upstream attempts may cost the owner; they must not cause extra user
  credit debits. Verify the trusted proxy/IP path used for the free allowance.
- Induce a telemetry write failure or delay in the isolated environment. Confirm
  `provider_telemetry_unavailable` includes request/attempt IDs and the two-second
  telemetry deadline does not hang the stream. A telemetry failure alone must
  not replace a valid answer; independent credit/spend storage failures remain
  fail-closed and can legitimately prevent completion.
- Exercise low owner balance, daily/monthly caps and model unavailability. Do
  not raise production spend limits just to force a successful fallback test.

## UI and incident follow-through

Compare the real integration with the checked local 390/1440 light/dark captures.
Verify no red retry state, banner, toast or new icon, and that normal status
returns only with new content. Repeat at least once through the intended proxy
to check buffering/SSE forwarding and cancellation, without deploying this code
to the public application. The baseline visual harness issue remains pending in
`KNOWN-VISUAL-BASELINE-ISSUE.md`.

For the historic Gemini-error incident, a concrete diagnosis still requires an
affected production request ID/log trace. The revised logs distinguish acceptance
failure, stream failure, fallback success and final failure. Do not announce that
the exact production incident is resolved solely from local synthetic tests.


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
