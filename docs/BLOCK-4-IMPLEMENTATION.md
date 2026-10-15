# Block 4 implementation

Date: October 14, 2026 (America/Tijuana). Block 4 follows the live-streaming
revision to Block 1. Nothing was deployed and no live provider or production
Redis credentials were used.

## Retry behavior and request diagnostics

- Chat and presentation content is shown as provider chunks arrive. If a stream
  cuts out, returns an SSE error, times out, or finishes empty/incompletely, the
  UI clears that attempt before retrying the same selected model on OpenRouter.
  The new request body starts from byte zero. Failed presentation HTML is
  removed with its iframe; failed chat text is not committed to conversation
  history. Only the successful terminal event commits user credits.
- During retry, only the existing status under the orbs changes to the
  output-language equivalent of “Reintentando…”. The regular status returns
  when new content arrives. Exhausted paths use the existing clear terminal
  error UI. Safety permits no more than one additional attempt.
- Provider request logging and the Redis attempt table already carry one HTTP
  request ID, unique attempt IDs, provider/model, fallback reason, outcome,
  duration, and estimated or reported cost. The failure reason is recorded
  before the next provider is attempted.
- `STAGE_TIMEOUT_MS` now bounds each provider stream attempt and aborts its
  upstream read. The stage runner no longer races a second timer against the
  provider reader, which could leave the failed request active during retry.

## UI and visual checks

The orb status now stays inside the unscaled preview wrapper, follows theme text
colors, and remains readable in light and dark mode. The chat language control
no longer overlaps the slide count on mobile; narrow controls wrap at 320/360px.
The Pro and language controls retain accessible labels. Credit loading now has a
visible pending state until a valid server balance arrives; model-list failures
do not invalidate a loaded balance, and a stalled credit response is aborted.

I manually inspected the presentation retry and chat retry captures at 390 and
1440 pixels in light and dark themes. All four presentation states show the
subtle status within the preview. The browser harness measured text contrast at
17.74:1 in light mode and 14.30:1 in dark mode. It also checked canvas/status
containment, mobile control overlap, streaming before completion, discard of
failed chat/slides, and status restoration on new content. Automated layout
assertions additionally passed at 320 and 360 pixels; those narrower captures
were not part of the manual visual review.

Presentation retry captures:

![390 px, light theme](evidence/block4/presentation-retry-390-light.png)

![390 px, dark theme](evidence/block4/presentation-retry-390-dark.png)

![1440 px, light theme](evidence/block4/presentation-retry-1440-light.png)

![1440 px, dark theme](evidence/block4/presentation-retry-1440-dark.png)

Chat retry captures:

- [390 px, light theme](evidence/block4/chat-retry-390-light.png)
- [390 px, dark theme](evidence/block4/chat-retry-390-dark.png)
- [1440 px, light theme](evidence/block4/chat-retry-1440-light.png)
- [1440 px, dark theme](evidence/block4/chat-retry-1440-dark.png)

The JSON measurements and additional 320/360 captures are under the generated
local evidence directory `test-evidence/block4/`.

## Validation

| Check | Result |
| --- | --- |
| `npm run test:provider-fallback` | 67 passed: 61 routing/telemetry/UI/spend, 5 HTTP midstream cases, and 1 timeout case |
| `npm run test:contract` | 63 passed, including the queued generation/disconnect check |
| `npm run test:safe` | 43 passed |
| `npm run test:frontend-http-sse` | 3 passed |
| `npm run test:prompts-modules` | 3 passed |
| `npm run test:streaming-ui` | Passed controlled browser scenarios at 390/1440 light/dark and layout assertions at 320/360 |
| `npm run verify:quality` | Passed existing lint/typecheck/format ratchets; warning/error baselines unchanged |
| `git diff --check` | Passed |
| `npm run check:editor-safety` | Known pending failure at the pre-editor landing checkpoint, reproduced on untouched HEAD |

The passing test commands in this document were a pre-Block-2 snapshot and
totaled 179 tests at that time. Provider, Redis, and credit services were
controlled or isolated for local tests. These results do not establish live
vendor behavior or production storage permissions.

## Known visual baseline issue and production checks

The full editor visual harness still fails at `flow-01-landing` before it reaches
the editor, with roughly a 4.8% pixel difference. Untouched HEAD fails the same
checkpoint at roughly 4.7%. The cause remains under investigation; no image
baseline or threshold was changed. Details and run logs are in
`KNOWN-VISUAL-BASELINE-ISSUE.md`.

Before deployment, follow
`PRODUCTION-VERIFICATION-BLOCK-1.md`: use a separate provider key/project and
Redis database, trigger a real Google 400/403 while OpenRouter stays valid, and
confirm request correlation, same-model live retry, reset isolation, single
credit commit, timeout abort, safety limit, and Redis EVAL/XADD/HSET/EXPIRE,
retention, and idempotent ledger behavior. The historical incident still needs
its affected production request ID for a confirmed diagnosis.

## Block 2 follow-through

The approved order remains Block 1 → 4 → 3 → 2. Block 2 now has its own
decision record, cost model, migration and deployment runbook in
[`DECISIONS-BLOQUE-2.md`](DECISIONS-BLOQUE-2.md) and
[`DEPLOY-PLAN.md`](DEPLOY-PLAN.md). Current provisional rates selected in the final decision record are
Gemini 1.6/3.2, Haiku/GPT 1.2/2.4, and Nemotron 0.8/1.6 credits per slide (Flash/Pro), with
50 credits per IP/day UTC and shared owner caps of $0.25/day and $1/month.
Every full-balance slider value now fits: Flash up to 8 and Pro up to 15;
Gemini Pro 15 uses 48 credits (96%). The earlier full-price scale is superseded.
No deployment has occurred; real provider and isolated Redis checks remain
predeployment items.
