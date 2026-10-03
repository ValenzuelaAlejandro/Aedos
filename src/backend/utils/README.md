# Backend utilities

- `rate-limiter.js` owns environment configuration, IP resolution/audit, Redis
  lifecycle, Express middleware, and public exports.
- `rate-limit-evaluators.js` owns the counter decisions for memory and Redis.
  The factory receives the same state maps and limits from the facade; TTLs,
  response fields, decision order, and fail-open behavior stay in the facade's
  existing contract tests.
- `logger.js` and `export-warnings.js` provide shared diagnostics.
- `pptx-export.js` contains XML and ZIP primitives shared by the editable PPTX
  renderer. It remains monolithic until a smaller extraction can preserve the
  package baseline without changing serialization order.

Keep provider and Redis calls stubbed in tests. Never add a live service call to
the verification suite.
