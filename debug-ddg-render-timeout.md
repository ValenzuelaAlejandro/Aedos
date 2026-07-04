[OPEN] DDG Render Timeout

## Session
- session_id: ddg-render-timeout
- scope: `src/backend/server.js`
- symptom: DuckDuckGo image fetching times out on Render but works in local dev.

## Runtime Evidence
- `DuckDuckGo API flow failed | error="REQUEST_TIMEOUT_12000" cause=null`
- `DuckDuckGo browser fallback failed | error="Navigation timeout of 25000 ms exceeded" cause=null`

## Falsifiable Hypotheses
1. Node reaches DNS for `duckduckgo.com` but the TCP/TLS connection from Render times out before any HTTP response arrives.
2. Chromium in Render can open outbound HTTPS generally, but DDG specifically stalls during main-document navigation.
3. Redirect or compression handling in the DDG path is masking the exact failing phase.
4. The browser fallback is loading too many subresources and timing out before useful image DOM is available.
5. The failure happens before HTTP response headers, so current logs only expose the synthetic timeout error.

## Current Instrumentation Goal
- Capture exact failing DDG phase for server HTTP requests.
- Capture Chromium request failures for DDG navigation and subresources.
- Keep business logic unchanged aside from diagnostics and timeout handling detail.
