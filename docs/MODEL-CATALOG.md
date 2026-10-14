# Model catalog

The production model allowlist is defined by the backend catalog in
`src/backend/config/model-catalog.js`; display and credit values live in
`src/frontend/config/model-catalog.js`. The browser obtains allowed IDs from
`GET /api/models`, and generation requests are validated again on the server.

| Model ID | Provider | Tier / billing | Maximum slides | Availability |
|---|---|---|---:|---|
| `google/gemini-3-flash-preview` | Google direct | Free / 10 credits per presentation | 15 Flash, 8 Pro | Production selector |
| `nvidia/nemotron-3.5-lightning` | OpenRouter, DeepInfra only | Light / 2 credits per slide | 8 | Production selector |
| `openai/gpt-6-luna` | OpenRouter | Standard / 3 credits per slide | 15 Flash, 8 Pro | Production selector |
| `anthropic/claude-haiku-5.5` | OpenRouter | Standard / 3 credits per slide | 15 Flash, 8 Pro | Production selector |

The model caps are Aedos request limits. The catalog is the only source of
model IDs, provider routing, slide limits, and billing values.

## Environment variables

| Variable | Purpose | Default / safe setting |
|---|---|---|
| `OPENROUTER_REASONING_EFFORT_SCHEMA` | Schema reasoning | `low` |
| `OPENROUTER_REASONING_EFFORT_DESIGN` | Design reasoning | `low` |
| `OPENROUTER_REASONING_EFFORT_HTML` | HTML reasoning | `none` |

For Claude Haiku 5.5, OpenRouter documents `reasoning.enabled=false` as the
disable control. Aedos bounds Haiku schema output to 4,096 tokens and HTML
output to 32,768 tokens; the HTML cap covers observed 8-slide output while
limiting unexpected reasoning spend. See the current [OpenRouter reasoning
documentation](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens),
checked 2026-10-13.

## Error behavior

- `MODEL_NOT_ALLOWED` (422): an ID is outside the server allowlist.
- `MODEL_SLIDE_LIMIT` (422): the model cannot produce the requested slide count.
- `ATTACHMENTS_NOT_ALLOWED` (422): files require Gemini and available Gemini
  quota. Validation runs before the daily generation limiter.
- `PAID_PAUSED` (503): paid routing is paused by the spend guard or a provider
  credit-limit response. The UI can continue with an available free model.
- `PROVIDER_UNAVAILABLE` (503): the selected provider is unavailable or timed
  out.
- `INSUFFICIENT_CREDITS` (402): the IP's server-side daily balance cannot cover
  the server-calculated cost.

## Credits and Redis failure

The server owns the model cost catalog and the per-IP credit balance. Credits
reset at midnight UTC: Gemini costs 10 per presentation, Light models 2 per
slide, and Standard models 3 per slide. Initial schema requests cost 0 credits
and have a separate limit of 10 per IP per UTC day. Chat updates and added
outline items cost 1 credit. The frontend reads `/api/models` and `/api/credits`;
client-supplied costs are ignored.

All generation, schema-quota, and credit-spend operations fail closed with a
recoverable `CREDITS_UNAVAILABLE` response when Redis is unavailable. There is
no in-memory credit fallback. Existing global generation limits and cooldowns
remain separate from the credit balance.

Generation credits are reserved atomically before work, committed on success,
and refunded on failure before a result is delivered. The OpenRouter spend guard
reserves and settles provider-dollar usage independently.
