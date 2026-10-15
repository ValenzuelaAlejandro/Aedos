# Providers

Gemini, OpenRouter, fallback routing, streaming parsers, and the guarded test
provider seam. No provider module performs a real call during tests.

The runtime uses `model-selection.js` for every stage. Gemini uses its direct
model first, then the same public model ID on OpenRouter. Other catalog models
retry on OpenRouter with price-sorted provider failover. There are at most three
transport attempts; a safety failure permits only one further attempt. The old
configured fallback factory remains for compatibility tests and is not wired to
the application runtime.

`stream-buffer.js` now yields **live** SSE chunks while checking terminal markers,
safety, malformed frames, idle/total deadlines, cancellation, and a 2 MiB cap.
Its historical filename does not imply buffering the complete response.
`STAGE_TIMEOUT_MS` configures the total deadline for each provider stream attempt
(default 180000 ms); the parser aborts the upstream response when it expires.
The stage runner does not race stream reads against a second timer.
`output-validation.js` checks final stage output. The selected-model router owns
the live generator and catches acceptance, read, and validation errors in the
same attempt lifecycle. Before a retry it yields `type: reset`; HTTP consumers
clear their accumulated text and emit `{reset:true, stage, attempt}`. The UI
discards the failed draft/iframe and changes only the existing orb status text
to a translated retry label. The next content chunk restores normal status.
Only done events commit chat history and user credits. This supersedes the
initial Block 1 buffering approach at the user's request.

`request-context.js` carries HTTP correlation through asynchronous requests.
`telemetry.js` emits an allowlisted `provider_call` row and awaits its durable
write for at most two seconds. It logs `provider_telemetry_unavailable` on missing
storage, failure, or an unconfirmed write; generation may still complete.
`telemetry-store.js` uses the existing Upstash Redis connection, not a new SQL
service. Its logical attempt table is the bounded Redis Stream
`{aedos-provider-calls}:attempts` (approximately 100,000 recent rows), with a
30-day per-request hash index `{aedos-provider-calls}:request:<requestId>`.
The index and stream write are atomic. Production requires configured Upstash
credentials and permissions for EVAL/XADD/HSET/EXPIRE. Tests bypass the default
store; injected store tests exercise persistence separately.

Rows include request/attempt IDs, stage, Pro/Flash mode, selected and effective
model, responding provider when reported, fallback reason, latency, outcome,
usage and USD cost. No prompts, attachments, credentials, or raw vendor error
text are stored. Direct Gemini costs are conservative list-price equivalents
before free quota, marked estimated; they are not an assertion of actual Google
charges. OpenRouter usage costs take precedence; missing usage retains the
conservative reservation, including failed attempts that might incur upstream
charges. Owner USD caps remain enforced independently of user credits.

Inspect rows with Redis `XRANGE {aedos-provider-calls}:attempts - + COUNT 100`,
or `HGETALL {aedos-provider-calls}:request:<requestId>`. Correlate the request ID
with the HTTP `X-Request-Id` header and server logs. Check storage alerts after
deployment; no live database write or production diagnosis is claimed by unit
tests.

Run `npm run test:provider-fallback` for transport, output, safety, cancellation,
credit idempotency, telemetry, live-before-completion delivery, reset isolation,
retry status translations, credit loading and frontend terminal-event checks.
Run `npm run test:streaming-ui` for local browser captures at 390/1440 pixels in
light/dark themes. It uses controlled provider streams and mocked credit/model
responses; it does not test the owner's production credentials.
Provider request settings follow the official
[provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
and [reasoning](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
documentation: low effort where supported, disabled reasoning for Nemotron's
toggle-only capability, and ascending provider prices.
