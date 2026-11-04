# ADR-0010: Same-origin nginx, no CORS, localhost binding and secret scanning

- Status: accepted
- Date: 2026-11-04

## Context
- The app has no login. Anyone who can reach the API can use the Anthropic key it holds.
- The first backend build allowed CORS from any origin. An independent review found that any web page open in the reviewer's browser could call the API and spend their key.
- The key must never reach the browser or the repository.

## Options considered
1. Same origin: nginx serves the web app and proxies `/api` to the API. No CORS headers at all. Ports bound to `127.0.0.1`.
2. CORS with an allow-list of origins.
3. Publish the ports on all interfaces and rely on the reviewer's network.

For secrets: a scan on every commit and every push, or trust reviewing.

## Decision
Option 1.
- The API sends no CORS headers. In dev the Vite proxy forwards `/api`. In compose, nginx does.
- In `docker-compose.yml`, the db (5432), api (3001) and web (5173) are published on `127.0.0.1` only.
- The nginx config turns proxy buffering off for `/api/` (server-sent events would otherwise arrive all at once), and sets a Content-Security-Policy with `default-src 'self'`, `frame-ancestors 'none'`, plus `nosniff`, `no-referrer` and `X-Frame-Options: DENY`.
- `ANTHROPIC_API_KEY` is read only by the API process. CI fails the web build if the bundle contains `sk-ant`.
- The pre-commit hook in `.githooks` runs gitleaks on staged changes. The `secret-scan` workflow runs gitleaks on every push and pull request. `.env` is ignored by git and only `.env.example` is committed.

## Consequences
- A web page on another origin cannot read the API's responses, so it cannot use the key through the reviewer's browser.
- Another machine on the network cannot reach the app. A reviewer who wants that has to change the port bindings on purpose.
- The pre-commit hook skips itself with a warning if gitleaks is not installed. The CI scan is the one that cannot be skipped.
- Loopback binding is a stop-gap, not authentication. Anything beyond local use needs auth and rate limiting, which are in the productionising section.
- Rejected option 2: an allow-list is one wrong entry away from the original hole, and a same-origin setup needs none.
- Rejected option 3: it puts a keyed, unauthenticated API on whatever network the reviewer is on.
- Detail that matters: nginx re-resolves the `api` hostname every 10 seconds, so an API container that restarts does not leave nginx pointing at an old address.
