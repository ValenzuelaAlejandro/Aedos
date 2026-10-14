# Remove direct test provider

## Summary

- Remove the direct provider adapter, local catalog entries, environment hooks,
  telemetry route, evaluation script, and related tests.
- Keep `nvidia/nemotron-3.5-lightning` as an OpenRouter model routed through
  DeepInfra, in the Light tier at 2 credits per slide and capped at 8 slides.
- Keep the existing model groups, credit behavior, attachment rules, and CORS
  policy unchanged.

## Verification

- `npm test`
- `npm run test:contract`
- Spend guard, model-selection, and credits tests
- `npm run format:check`
- ESLint on changed JavaScript files
- Local catalog and rejected-ID smoke checks; no provider generation calls

The existing `check:dom`, CSS order, and lint ratchet checks also fail on
`main`; renderer tests pass on this branch.
