# AI generation audit and approval proposal

> Historical snapshot from before the approved Block 1 → 4 → 3 sequence. Its
> “no implementation” observations and proposed order are superseded by the
> current local work. For current behavior and the A1–A5 decision report, see
> [`BLOCK-1-IMPLEMENTATION.md`](BLOCK-1-IMPLEMENTATION.md),
> [`BLOCK-4-IMPLEMENTATION.md`](BLOCK-4-IMPLEMENTATION.md),
> [`BLOCK-3-IMPLEMENTATION.md`](BLOCK-3-IMPLEMENTATION.md), and
> [`AUDITORIA-A1-A5-BLOQUE-2.md`](AUDITORIA-A1-A5-BLOQUE-2.md).

Audit date: October 14, 2026 (America/Tijuana). At the time of this snapshot,
implementation was awaiting confirmation. The user later authorized all four
blocks; current status and behavior are documented in the implementation and
final-review reports above. No source or baseline changes were made as part of
this historical audit snapshot.

## Evidence and limitations

The audit combines source tracing, 37 existing automated tests, and a Chromium reproduction at 1440×900 and 390×900. Browser requests for credits, models, outline generation, and final generation were intercepted; no paid generation or production credit mutation was needed. External static script/style/font dependencies were permitted after an initial offline run failed because GSAP was unavailable. The final browser run completed with those dependencies available.

The browser used a deliberately supplied eight-slide outline to isolate downstream behavior. This proves the request reduction; it does not measure how often a live model returns eight slides. Production request traces were not available, so the exact incident behind repeated Gemini errors cannot be attributed to one deployed request.

Machine-readable final browser observations are in `docs/AI-GENERATION-AUDIT-EVIDENCE.json`. The reproducible local harness is `tmp/request-audit.cjs` (temporary and Git-ignored); run `node tmp/request-audit.cjs` from the repository root.

## Audit 2A: current billing

Source: `src/backend/config/model-catalog.js`, `src/backend/http/middleware/generation-credits.js`, `src/backend/pipeline/skeleton.js`, `src/backend/pipeline/outline-item.js`, and `src/backend/http/routes/credits.js`.

| Selected model | Flash presentation | Pro presentation | First outline/chat turn | Outline revision/chat turn, either mode |
| --- | --- | --- | --- | --- |
| Gemini 3 Flash | 10 credits/deck | 10 credits/deck | 0 credits, separate 10/day outline quota | 1 credit |
| Claude Haiku 5.5 | 3 credits/requested slide | 3 credits/requested slide | 0 credits, same quota | 1 credit |
| GPT-6 Luna | 3 credits/requested slide | 3 credits/requested slide | 0 credits, same quota | 1 credit |
| Nemotron 3.5 Lightning | 2 credits/requested slide | 2 credits/requested slide | 0 credits, same quota | 1 credit |

There is no Pro multiplier. `quoteModel(model, slides)` receives no mode. The backend reserves the whole quote before generation and commits that quote when it returns HTML; it does not reconcile against delivered slides. A successful revision returning `action: proceed` also commits one credit, in addition to the subsequent presentation cost. Adding an outline item costs one credit. The standalone spend endpoint accepts `chat` and charges one immediately; the inspected chat UI instead uses the reservation in the skeleton endpoint, so a double charge from these two endpoints was not demonstrated.

The daily allowance is 50 credits, keyed by IP, resetting at midnight UTC. This is not an authenticated account wallet. The separate outline quota is consumed before a provider response, with no corresponding failed-request refund visible in the route.

### OpenRouter cost estimate and proposed prices

Rates were retrieved from the [official Models API](https://openrouter.ai/api/v1/models) during this audit. Values below assume normal prompt sizes, no tools/search or image/audio input, no cache discount, and one successful attempt. Reasoning low controls effort, not a fixed number of billable tokens. Output budgets below include assumed reasoning tokens.

| Model | USD / million input tokens | USD / million output tokens | Illustrative Flash USD/slide | Illustrative Pro USD/slide | Proposed Flash credits/slide | Proposed Pro credits/slide |
| --- | --- | --- | --- | --- | --- | --- |
| Gemini 3 Flash | 0.50 | 3.00 | 0.00500 | 0.00850 | 4 | 8 |
| Claude Haiku 5.5 | 0.10 | 0.50 | 0.00085 | 0.00145 | 3 | 6 |
| GPT-6 Luna | 0.10 | 0.50 | 0.00085 | 0.00145 | 3 | 6 |
| Nemotron 3.5 Lightning | 0.07 | 0.20 | 0.00037 | 0.00064 | 2 | 4 |

These are scenarios, not measured per-slide costs: Flash assumes 1,000 input + 1,500 output tokens per delivered slide, including amortized outline overhead. Pro assumes aggregate 2,000 input + 2,500 output tokens per slide across outline/content, design, and HTML stages. For example Gemini Flash = 1,000×0.0000005 + 1,500×0.000003. Real overhead varies with deck size, repeated prompts, user files, reasoning length, and retries. The proposal models all stages at the selected model's rate; today's Pro pipeline can mix models.

Haiku pricing increases above 100,000 input tokens; GPT above 272,000. Those tiers are excluded from the illustrative figures. Nemotron's live rate differs from the source catalog's 0.06/0.16 per million and should be refreshed when implementation is approved.

The app has no USD selling price per credit. Consequently, an actual financial margin cannot be established from credit counts alone. At an explicit *planning assumption* of USD 0.002 revenue/budget per credit, Gemini Flash costs USD 0.005 against USD 0.008 credit value (37.5% contribution before infrastructure and retries); Gemini Pro costs USD 0.0085 against USD 0.016 (46.9%). Claude/GPT have larger headroom in these scenarios. These are conditional examples, not a new monetary credit value or a guaranteed margin. Validate with observed usage and a bounded retry budget before claiming profitability. With the current free allowance, these numbers describe subsidy budgeting rather than revenue.

Proposed configuration: `PRO_CREDIT_MULTIPLIER = 2`, one model-specific per-slide Flash rate, and a server-calculated quote independent of responding provider. Reserve the requested maximum once, then atomically settle `completeDeliveredSlides × rate × multiplier`, refunding the difference. Internal retries must share the same operation ID. Replays must return the prior result/status rather than charge again. No proposed price is implemented.

## Audit 2B: chat behavior and gaps

The current chat is an outline/revision workflow, not a separate general-purpose conversation billing API. Its model input is resolved per request. There is no server-owned conversation record binding model, mode, language, or skeleton to the user/session.

| Case | Current behavior | Gap and proposed rule |
| --- | --- | --- |
| Change model mid-conversation | Next request reads mutable frontend `selectedModelId`; backend accepts another allowed model | Bind the chosen model to a server-owned conversation; reject mismatched request fields |
| Toggle Pro mid-conversation | Outline payload uses `mode: chat`; backend treats it as Flash. Final request reads the current Pro toggle | Store generation mode separately from operation type; lock it for the conversation and enforce it server-side |
| Fallback | Same outline reservation; no separate debit for the fallback | Preserve one charge, but keep the same selected model and price |
| Chat associated with a generated presentation | Follow-up revision uses client-supplied `currentSkeleton`; generating HTML again creates a new presentation request ID/charge | Associate presentation and conversation IDs, inherit their model/mode/language, and distinguish a revision from a new render |
| Change language | New outline uses current language; final request clones language from the previously saved body | Can produce inconsistent outline/HTML languages; lock output language for the conversation |

Initial quota vs paid revision is selected by whether the request contains an object-valued `currentSkeleton`. Omitting it starts another free outline request until the ten/day quota, bypassing the distinction between initial and follow-up turns. A malicious client can provide an arbitrary skeleton. This is a missing conversation authorization boundary, not a demonstrated credit-ledger race.

The ledger has atomic reservations, refunds, and duplicate-key protection. Existing tests pass those cases. A fresh client key nevertheless represents a fresh billable operation; there is no persisted conversation turn identity/result cache. Disconnection and partial-delivery semantics need explicit settlement rather than assuming socket completion proves receipt.

The browser reproduction confirms that model, Pro, and language controls are enabled after an outline completes at both widths. During loading, `loading-controller.js` disables the model button (`modeBtn` actually references that button in `app.js`) and language button, but not the separate `generation-mode-toggle`.

Proposal: create a server-owned conversation before the first turn, bound to an opaque authorized owner/session. Lock model, mode, and output language until a new conversation. UI language may remain changeable only after separating it from output language. Enforce every generation/revision/outline-item request against the stored context, never solely request fields or a bare client conversation ID. Keep first-outline quota behavior explicit; propose successful follow-up turns at 1 credit Flash / 2 Pro, one debit per complete result, with free failures. A render is billed by delivered slides separately; label both actions in the UI. Persist whether the initial free turn has already been used so omitting a skeleton cannot reset that state.

## Audit 3: 15 requested, 8 generated

The browser captured the same sequence on desktop and mobile:

```json
{"path":"/generate-skeleton","slides":15,"mode":"chat","modelId":"google/gemini-3-flash-preview"}
{"path":"/generate","slides":8,"mode":"flash","modelId":"google/gemini-3-flash-preview"}
```

1. `skeleton-generation.js:81` sends the selected slider value. The initial payload is correct for Flash.
2. `pipeline/skeleton.js` reads and uses `requestedSlides` only for validation and an upper bound. It builds `buildStage1Prompt(topic, language)` without passing the requested count. Its `mode: chat` also loses the Pro distinction.
3. `prompts/stage1-content.js:29` instructs: `slide_count: what the user asks for, or 6-8 based on complexity. NEVER exceed 8.` Short prompts default to eight. The numeric slider value is absent from this prompt unless the user separately writes it in their topic.
4. `final-generation.js:40` sets the final request to the minimum of the slider count and returned skeleton length. `approved-outline-proceed.js` also derives the count from the skeleton and updates the slider. Thus an eight-slide outline turns the later request into eight even when the original target was fifteen.
5. `normalizeSlides` caps Pro at eight; model metadata, frontend mode limits, and the HTML sanitizer reinforce eight for Pro. `parseInt` also accepts fractional or trailing-text slide inputs instead of strictly validating an integer.
6. Flash prompt `base.js` prioritizes the provided skeleton and asks for exactly `CONFIG.slide_count` sections. Pro stages use the provided skeleton or generate another content plan with the same eight-slide prompt. No final undercount repair exists.
7. Provider output ceilings exist: Flash 32,768; Stage1 8,192; Stage2 16,384; Stage3 65,536 tokens. Haiku further caps Stage1 to 4,096 and Stage3 to 32,768. Tokens are a secondary truncation risk; the reproduced eight-slide request reduction happens before generation and does not require a token cutoff.
8. Oversized outline arrays are sliced. The stream consumer stops on a mode-wide upper bound, counts opening tags per chunk (a split tag may escape counting), and can drop an entire chunk that crosses that bound. Final HTML processing trims beyond the mode-wide maximum. These are upper limits, not requested-count checks; there is no verified slide-merging stage explaining the observed 15→8 behavior.

Root cause: the requested count is treated as an upper bound, the content prompt imposes eight, and the frontend replaces the original target with the outline length. Pro separately has an explicit eight-slide product limit.

Proposal after confirmation: preserve an immutable target count in conversation/generation state; pass it into every prompt and stage; remove contradictory eight-slide rules; support the requested maximum in Pro through bounded batches rather than silent clamping. Count complete slide sections after final processing. Generate only missing slides with shared design/context and deduplicate/renumber them. Bound repair attempts. If completion remains impossible, return an explicit partial-result status, delivered/requested counts, and charge only complete delivered slides. Decide final token budgets using measured deck outputs rather than merely raising every ceiling.

## Audit 4.5: server wake-up message

Confirmed at both 1440 and 390 pixels with `/api/credits` returning 503:

| Step | Message | Hidden | CSS display |
| --- | --- | --- | --- |
| Initial unavailable balance | Server may be waking up | false | block |
| Type into topic field while credits still unavailable | Empty | true | none |

The cause is shared UI state, not a mobile-only request timer. `credits-ui.js` initially shows `credits.unavailable`, but `updateCostPreview()` clears the same `credits-status` node whenever the provisional balance appears sufficient, except for `paused`. Typing, slider changes, or mode/model rerenders can invoke it before credits load. Mobile and desktop use the same service; a higher frequency of recalculation or different interaction timing can expose it differently. This audit does not establish the relative frequency on production devices.

`credits-service.js` combines credits and model retrieval with `Promise.all`, so even a successful credit response is treated as unavailable if model loading fails. Fetch has no request deadline/cancellation. A retry is scheduled ten seconds after retryable failure and periodic refresh occurs every minute. Those timers govern retry scheduling; they should not determine whether the status is visible. Changing UI language after an earlier successful balance can also call `renderBalance(lastCredits)` and mark stale data available after a later failure.

Proposal: own separate states for credits and models (`loading`, `ready`, `retrying`, `unavailable`), persist status through every quote/UI update, and clear the pending-credit indicator only when a validated current balance succeeds. Show a skeleton and `aria-busy` in the balance chip; use a neutral loading label initially and a cautious waking/reconnecting label on transient failure, not a claim that cold start has been proven. Add cancellable fetch deadlines and bounded backoff. Preserve last-known balance with an explicit stale marker, without enabling spending from it. Test slow pending responses, 503, malformed startup HTML, model-only failures, stale refresh, language changes, and responsive clipping.

## Block 1: preliminary routing and repeated-error findings

- Selected Gemini does not currently fall back to the same Gemini model on OpenRouter. `fallbackToFree` excludes the selected direct model and only uses approved free OpenRouter models. `FREE_MODELS` is empty in the current catalog, so selected Gemini can end at `PROVIDER_UNAVAILABLE` after retries. The OpenRouter paid allowlist also excludes Gemini, preventing a simple same-ID retry without catalog/spend changes.
- A failed Claude/GPT selection may silently switch to the configured direct Gemini model. Pro content/design stages call the base router without `selectedModel`, so they may use `gemini-2.5-flash-lite` even when another model was selected. Fixing only final HTML routing would leave the invariant broken.
- Fallback catches provider acceptance errors, not errors raised while consuming the returned async stream. Empty streams, safety finish reasons, and EOF without a valid finish marker are not comprehensively validated. Gemini's plain text reader only uses the first part in a candidate; parsers ignore malformed frames and structured provider error frames without raising a dedicated provider error.
- `fetchWithAcceptTimeout` really aborts acceptance timeouts; it is not merely a Promise race. Its timer is cleared when response headers arrive, leaving stream consumption unbounded. Client disconnect does not propagate its cancellation signal through the provider interface.
- In `skeleton-generation.js`, a server SSE `error` is thrown inside the same `try` as JSON parsing, then reported as `SSE JSON error`. Only messages matching a small case-sensitive text filter are rethrown. Consequently real stream errors can be logged as parsing errors while a partial outline is still accepted. This is a concrete explanation for errors alongside a visible response; a visible partial outline is not proof of complete successful delivery.
- Flash missing-CSS retries transmit an SSE object containing `error` alongside `pipeline: true` and `status: retrying`. The current final-generation client handles pipeline progress and continues before its fatal-error check, so this event alone does **not** prove a false error modal. Partial chunks are already forwarded and are not reliably reset across retries; that is a confirmed retry-contamination risk. Final SSE errors after partial chunks remain fatal, without a complete-result acceptance boundary.
- Telemetry logs provider/model, duration, usage/cost, and some route fields to stdout. It has no persistent per-request database table, no explicit Pro/Flash field or shared attempt correlation in the allowlist, and some rejected/skipped paths do not emit a call record. Gemini cost is null. This is insufficient to correlate the reported production symptom conclusively.

Proposed implementation: route all chat and generation stages through a same-model attempt policy; bounded backoff; direct Gemini then the exact cataloged Gemini ID through OpenRouter; same-model OpenRouter provider retries for Claude/GPT. Buffer/validate each attempt before committing visible content, or use a fully specified replace/reset protocol; never append failed partial content to a retry. Detect safety explicitly, allow one alternate-route attempt, then return a clear final message. Use one operation ID and separate attempt IDs; record every outcome, requested/effective model, mode, route/reason, latency, tokens, and estimated/actual USD in logs and persistent storage. Persist all attempts, including failures whose provider usage may still be billed, even when no user credits are charged.

The repository currently uses Redis and has no SQL persistence adapter/migration framework. A durable analytics table needs an explicit implementation/storage choice; propose managed PostgreSQL with a migration and indexed operation/attempt records. Do not place the only accounting table in an ephemeral local SQLite file on the deployed backend. Deployment credentials/schema remain a follow-up infrastructure requirement, not something verified in this audit.

## UI 4.1–4.4 proposal

Preserve the orbs and visual design. Inspect computed preview container coordinates/overflow and dynamic viewport height at mobile sizes before patching 4.1. Use theme variables for orb-adjacent text after identifying the responsible declaration in light/dark views. For header crowding, prefer a compact square icon-only language button with centered inline-flex contents and an accessible label: it preserves one-row controls and uses the existing language icon, while stacking increases composer height and moving language makes it harder to discover. Verify this choice at 320, 360, 390 pixels and desktop. These are implementation proposals, not claimed completed visual fixes; orb containment and contrast have not yet been validated in loading screenshots.

## Executed checks and next approval

| Check | Result |
| --- | --- |
| Generation billing, model selection, reasoning, normalizers, frontend credits, ledger suites | 33 passed, 0 failed |
| Provider network and acceptance-timeout suites, with dotenv disabled | 4 passed, 0 failed |
| Chromium final request tracing at 1440 and 390 pixels | Both reproduce 15→8 with mocked eight-slide outline |
| Chromium credit status at both widths | Both reproduce status disappearing while credits unavailable |
| Chromium controls after outline completion | Model, Pro, language all enabled at both widths |
| Initial browser attempts with external dependencies blocked | Incomplete: missing GSAP; fixed the harness dependency policy and reran successfully |
| New desired 429/5xx/empty/stream-cut same-model fallback acceptance cases | Not implemented or claimed passing; belong to Block 1 after approval |
| Live production Gemini error correlation / measured USD per slide | Not performed; requires production traces or separately instrumented live samples |

Existing passing tests characterize today's behavior; several explicitly expect no Pro surcharge and no paid same-Gemini fallback. They need deliberate updates with the approved behavior, not just additional assertions around unchanged routes.

Only audit documents/evidence and the temporary reproduction harness were created. Existing `docs/DEAD-CODE-CLEANUP.md` was already untracked and was left untouched. After approval, implement in the requested order: Block 1 → Block 4 → Block 2 → Block 3. For each block report changed files, behavior, reproduction steps, executed tests, and remaining limits. Approval should explicitly cover the proposed 4/3/3/2 Flash slide rates, 2× Pro multiplier, 1/2-credit chat follow-ups, conversation/output-language locks, and support for up to fifteen slides in Pro via bounded completion.
