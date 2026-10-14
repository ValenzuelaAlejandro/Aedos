# Production deployment checklist

This checklist documents deployment and verification steps. It does not authorize or perform a deployment.

## Production environment

Configure these names in the production environment. Put credentials in the secret manager; never commit their values.

| Variable | Configuration |
| --- | --- |
| `NODE_ENV` | `production` |
| `GEMINI_API_KEY` | Secret for the direct Gemini provider |
| `OPENROUTER_API_KEY` | Secret with a credit limit configured in the OpenRouter dashboard |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL (secret/config value) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token (secret) |
| `PAID_SPEND_DAILY_USD` | `0.25` (daily paid-provider ceiling) |
| `PAID_SPEND_MONTHLY_USD` | Set the approved monthly ceiling |
| `PAID_BALANCE_FLOOR_USD` | Set the approved minimum balance floor |
| `GEMINI_DAILY_APP_CAP` | Set the application request cap within the Google project quota |
| `OPENROUTER_REASONING_EFFORT_SCHEMA` | Set the approved schema-stage effort |
| `OPENROUTER_REASONING_EFFORT_DESIGN` | Set the approved design-stage effort |
| `OPENROUTER_REASONING_EFFORT_HTML` | Set the approved HTML-stage effort; Haiku was locally verified with reasoning disabled |
| `LIMITS_FLASH_COOLDOWN_SEC` | Set the Flash cooldown |
| `LIMITS_PRO_COOLDOWN_SEC` | Set the Pro cooldown |
| `LIMITS_OUTLINE_COOLDOWN_SEC` | Set the outline cooldown |
| `LIMITS_CHAT_COOLDOWN_SEC` | Set the chat cooldown |

The application credit balance resets at midnight UTC. The OpenRouter paid-spend counters use UTC day and month buckets.

## Post-deployment verification

- [ ] `GET /health` returns HTTP 200.
- [ ] `GET /api/credits` returns `daily`, `remaining`, `resetsAt`, `geminiAvailable`, and `paidPaused` for the caller IP.
- [ ] `GET /api/models` returns the supported catalog: Gemini, Nemotron 3.5 Lightning, GPT-6 Luna, and Claude Haiku 5.5. Confirm Nemotron remains capped at 8 slides.
- [ ] Generate one presentation with Gemini. Confirm the server balance decreases by 10 credits for the presentation.
- [ ] Submit an unknown `modelId`. Confirm HTTP 422 with `MODEL_NOT_ALLOWED` and no provider call.
- [ ] Exhaust a test IP's credits and submit a generation. Confirm HTTP 402 with `INSUFFICIENT_CREDITS` and no provider call.
- [ ] Inspect Redis TTL for the caller's hashed-IP balance key for the current UTC date. Confirm it spans the remaining time to midnight UTC plus the configured retention period.
- [ ] Confirm the daily and monthly paid-spend counters use the current UTC date/month buckets and remain within their configured ceilings.
- [ ] Review structured provider logs for token usage, reasoning-token counts, cost, finish reason, effective model, and duration. Do not log prompts or credentials.

## Rollback

1. Revert the merge commit with `git revert -m 1 <merge-hash>` and push the revert through the normal review process.
2. Restore the previous production environment values for the paid-spend daily ceiling and any other variables changed for rollout.
3. Verify `GET /health` returns HTTP 200 and inspect server logs for startup or Redis errors.

## Known pending items

- No free-provider fallback route has been validated end to end for production.
- Credit identity is based on IP address.
- Redis failure blocks credit-backed operations and paid routing.
- Haiku's zero-reasoning HTML behavior has been verified locally; confirm it again in production logs after rollout.
