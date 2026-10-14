# Model catalog and NVIDIA evaluation

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

NVIDIA Build entries use namespaced Aedos IDs. They are available only when
`NVIDIA_API_KEY` is configured, the server runs in development, and the request
comes from loopback. They never enter provider fallback. NVIDIA's
model pages state the hosted endpoint is governed by NVIDIA API Trial Terms;
confirm the account's terms permit the intended deployment before enabling the
key in a public service.

| Aedos ID | NVIDIA Build model ID | Aedos output ceiling | Slide cap | Test status |
|---|---|---:|---:|---|
| `nvidia-build/nemotron-3.5-lightning` | `nvidia/nemotron-3.5-lightning-30b-a3b` | 16,384 tokens | 5 | Pass: Flash 47 s; Pro 86 s |
| `nvidia-build/nemotron-3-super` | `nvidia/nemotron-3-super-120b-a12b` | 32,000 tokens | 5 | Pass: Flash 103 s; Pro 79 s |

Ultra and GLM 5.3 were evaluated but are excluded: Ultra took 201 s in Flash
and 217 s in Pro. GLM Flash took 161 s; Pro exceeded the 190 s client timeout
and its one retry returned an invalid schema. Results and generated HTML are
saved under the ignored `test-evidence/` directory.

These are Aedos request caps, not claims about absolute provider limits.
NVIDIA's current API examples show 16,384 output tokens for Nemotron 3.5
Lightning and Nemotron 3 Ultra; the Super model card's deployment settings
show 32,000. The GLM 5.3 Build API example uses 1,024 and its model card does
not publish a maximum completion size, so 16,384 is an Aedos evaluation cap
only. Sources checked 2026-10-13: [Lightning API/model card](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b),
[Super API/model card](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b),
[Ultra API/model card](https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b),
[GLM 5.3 API/model card](https://build.nvidia.com/z-ai/glm-5-3).

Nemotron requests disable thinking with
`chat_template_kwargs.enable_thinking=false`. GLM 5.3 lists reasoning effort
values `low`, `high`, and `max`, with `max` as its default; Aedos requests
`low` and `chat_template_kwargs.clear_thinking=true`. Source: [GLM 5.3 model
card](https://build.nvidia.com/z-ai/glm-5-3/modelcard), checked 2026-10-13.
The NVIDIA streaming adapter has a 180-second total request timeout and logs
stage, provider, model, usage, reasoning tokens, finish reason, and duration.

## Environment variables

| Variable | Purpose | Default / safe setting |
|---|---|---|
| `NVIDIA_API_KEY` | NVIDIA Build service credential | Required for local NVIDIA Build tests |
| `OPENROUTER_REASONING_EFFORT_SCHEMA` | Schema reasoning | `low` |
| `OPENROUTER_REASONING_EFFORT_DESIGN` | Design reasoning | `low` |
| `OPENROUTER_REASONING_EFFORT_HTML` | HTML reasoning | `none` |

For Claude Haiku 5.5, OpenRouter documents `reasoning.enabled=false` as the
disable control. Aedos bounds Haiku schema output to 4,096 tokens and HTML
output to 32,768 tokens; the HTML cap covers the observed 8-slide output while
limiting unexpected reasoning spend. See the current [OpenRouter reasoning
documentation](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens),
checked 2026-10-13.

## Error behavior

- `MODEL_NOT_ALLOWED` (422): an ID is outside the server allowlist, or NVIDIA
  Build is unavailable because the service has no NVIDIA API key.
- `MODEL_SLIDE_LIMIT` (422): the model cannot produce the requested slide count.
- `ATTACHMENTS_NOT_ALLOWED` (422): files require Gemini and available Gemini
  quota. Validation runs before the daily generation limiter.
- `PAID_PAUSED` (503): paid routing is paused by the spend guard or a provider
  credit-limit response. The UI can continue with an available free model.
- `PROVIDER_UNAVAILABLE` (503): the selected provider is unavailable or timed
  out; NVIDIA selections do not silently fall back.

The browser credit balance remains simulated. Server-side per-IP credits,
`/api/credits`, and success settlement/refunds remain pending the separate
credits backend work; existing rate limits and the spend guard remain active.
