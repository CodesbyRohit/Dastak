# Testing: what each suite proves

Every suite shows that the **software** behaves as specified. **None of them establishes clinical correctness.** A protocol can pass every check and still give poor clinical guidance; only qualified clinical review can address that.

## Commands

```
npm ci
npx playwright install chromium
npm run verify            # protocol validation + generated-file drift (also the Vercel build)
npm test                  # unit tests (node:test) with coverage
npm run test:e2e          # Chromium 600×600 against the local server (started automatically)
BASE_URL=https://<deployment> npm run test:deployed   # same browser specs against a deployment
npm run report            # runs the suites, writes docs/TEST-RESULTS.md and public/test-results.json
```

The most recent recorded results are in [TEST-RESULTS.md](TEST-RESULTS.md).

## `npm run verify`

**Proves:** every protocol file:
- validates against `schema/protocol.schema.json` (Ajv)
- passes the semantic rules:
  - unique IDs
  - start step and all transition targets exist
  - fields allowed for each frame type
  - unique option values
  - `min < max`, `max` on the grid, `default` on the grid and within bounds
  - rules that can fire for some answers and not all
  - every step reachable
  - no cycles
  - every step can reach the end
  - lifecycle requirements: `reviewed-demo` and `clinically-approved` need sources, review metadata, and no `UNSOURCED` steps

It also proves:
- the manifest and roster are consistent with the protocol files
- the committed `registry.js` and the service worker's generated section are identical to a fresh build
- no protocol ID is hard-coded in engine or app code

**Does not prove:** that the content is correct, that the thresholds are appropriate, or that the wording is understood by workers.

## Unit tests (`test/unit`, node:test)

| File | Proves |
|---|---|
| `engine.test.js` | See the breakdown below. |
| `validator.test.js` | Each of 46 deliberately broken protocols is rejected with its expected error code. A fully sourced and reviewed protocol is accepted. `verify.js` exits non-zero on an invalid file, malformed JSON, registry drift, a hand-edited generated file, a stale service-worker build ID, and a hard-coded protocol ID. |
| `store.test.js` | See the breakdown below. |
| `api.test.js` | See the breakdown below. |

**`engine.test.js`:**
- every frame type and every transition kind
- all seven rule operators at their boundaries (e.g. `gt 38.5` is false at 38.5 and true at 39.0)
- float grids without rounding noise
- invalid answers leave state unchanged
- a missing step gives an error, never completion
- flags are counted once and removed by back
- progress figures
- `restoreVisit` rejects 10 kinds of inconsistent saved state
- **path walk** of every bundled protocol: every step is reached, every transition is exercised, every walked path terminates, and on each walked path the flag count equals the number of referral frames on it
  - yes/no, choice and info answers are tried exhaustively
  - **numeric (count and range) answers are sampled, not exhaustive:** the minimum, the maximum, the protocol default, and the values either side of each rule threshold. Every rule outcome, and therefore every transition, is still covered.

**`store.test.js`:**
- resume restores answers and flags exactly
- isolation by household and by protocol, for both interrupted visits and carry-forward
- 24 h and 30 day expiry
- tampered, duplicated, version-mismatched and unparseable saved data is discarded
- malformed carry entries are dropped
- one record is kept
- records are validated and unknown fields stripped
- blocked storage and full storage fail safely and report it
- legacy migration, including the former HBNC ID
- `clearAll` removes every Dastak key and nothing else

**`api.test.js`:**
- 405, 415, 413 (declared and measured size) and 400 for malformed bodies, including the bodies that crashed the original live functions
- 500s without details
- planner fallbacks for **12** AI failure modes: HTTP error, network error, timeout, non-JSON, empty content, oversized response, free text, extra keys, missing, duplicated or invented IDs, objects instead of IDs
- only whitelisted fields are sent to the provider
- non-HTTPS endpoints are refused
- review accepts a clean AI description and rejects 8 kinds of unsafe ones
- AI is not called for sparse data
- the protocol endpoint, including legacy deprecation headers
- the Express server matches `vercel.json` routes and headers

**Coverage:** `npm test` reports Node's built-in line, branch and function coverage for `public/js`, `api` and `scripts`. `glasses-app.js` and the page scripts run only in the browser, so the Playwright suite exercises them. Playwright does not measure coverage.

## Browser tests (`test/e2e`, Playwright, Chromium)

| File | Proves |
|---|---|
| `wearable.spec.js` | See the breakdown below. |
| `offline.spec.js` | After one online load, the shell is precached under a build-specific cache and nothing from `/api` is cached. With the network off: reloading `/` and `/glasses.html` still completes visits; record and planner pages work, the planner falling back to the on-device rule; an interrupted visit survives. |
| `pages.spec.js` | `record.html` renders hostile strings as text; fragment payloads are ignored and stripped; malformed records are deleted; delete-all works. The planner lists every household with rule-based reasons and rejects a server plan that drops one. `review.html` renders server strings as text and labels its data as sample. |
| `api-contract.spec.js` | Each public route responds; `/` is the multi-protocol app; `/index.html` redirects; source and data files are not served. CSP and `Permissions-Policy` headers are **present**; whether the browser then refuses camera or microphone access is not tested. Protocol, plan and review endpoints behave correctly for valid, malformed, oversized and wrong-method requests. The plan and review assertions accept either an AI or a deterministic response, but only the deterministic case has been observed on any deployment. |

**`wearable.spec.js`** (all keyboard only, at 600×600):
- **Every protocol × two answer strategies** (accept every default; choose the alternative everywhere):
  - every frame **rendered on those paths** fits 600×600 and has a visible focus ring on the highlighted option
  - this renders every frame of `home_visit`, `danger_signs` and `adherence`, but only 5 of the 11 frames of `post_discharge`
  - the other six (`symptom_category`, `pain_detail`, `bleeding_detail`, `fever_temp`, `wound_detail`, `flag_bp`) are not rendered by any automated test; a one-off manual script on 2026-10-20 found they fit
  - the stored record matches an engine simulation of the same answers
- **Regression tests for these audit findings** (the others are covered by other suites, or not at all; see the table below):
  - C2: resume keeps flags
  - C3: a protocol error is never COMPLETE and writes no record
  - C4: count frames confirm with Enter
  - C5: ↓ then Enter starts the chosen protocol
  - H1: a referral is counted once
  - H2: Back removes branch flags; a completed visit can't be reopened
  - H3: the triage line
  - H5: blocked storage
  - H6: range window and default
- **Other checks:**
  - full storage
  - carry-forward scoping
  - the settings and deletion flow
- **Network boundary:**
  - a full visit makes **zero** requests. This is measured after the page has loaded, with the service worker disabled for the test. When the service worker is active, page loads also trigger background revalidation GETs for the app's own files; those carry no visit data.
  - deliberate `fetch`, XHR and `sendBeacon` calls from the page are blocked by CSP, with violations recorded and no request completed

**Running against a deployment:** `npm run test:deployed` runs the same specs against `BASE_URL`, so routes, headers, API behaviour and offline behaviour are checked on the real hosting, not only on the local server.

**Protected Vercel previews:**
- Run the suite as `npx vercel env run -- npm run test:deployed` (after `vercel login` and `vercel link`). The short-lived development OIDC token is then sent as the `x-vercel-trusted-oidc-idp-token` header. It is never printed.
- The browser fetches the service-worker script without test headers. Deployment Protection then redirects that request to a login page, and browsers refuse redirected worker scripts.
- So on a protected preview the four offline tests are **skipped** with that reason. Skipped is never counted as passed.
- Run them against the public production URL instead.

## Audit findings: tested versus fixed-only

The code fixes for every finding in [AUDIT.md](AUDIT.md) are in place. Not all of them have an automated regression test:

| Finding | Automated evidence |
|---|---|
| C1 (root route) | `api-contract.spec.js` |
| C2, C3, C4, C5, H1, H2, H3, H5, H6 | `wearable.spec.js` (named tests) |
| C6 (record XSS) | `pages.spec.js`; `store.test.js` |
| H7 (duplicate sources), H8 (hollow harness) | `validator.test.js` (drift and CLI tests) |
| H9 (API validation and AI output) | `api.test.js`; `api-contract.spec.js` |
| H10 (service worker) | **Partial.** `offline.spec.js` covers precaching, offline reload and `/api` never being cached. An update from one deployed build to the next is **not tested**. |
| H4 (speech reads the on-screen referral text) | **None.** Fixed in code (`announce()` in `glasses-app.js`), not tested. |
| M1 (path-based progress) | Partial: the H2 Back test asserts "Q2" and the start-over test asserts "Q1" in the progress line; the "up to N more" figures are unit-tested in `engine.test.js` |
| M4 (assistive-technology semantics) | **None.** ARIA roles are used as test selectors but not asserted, and no screen-reader session was run. |
| M2, M3, M5–M10 | Covered indirectly by the suites above (settings/deletion flow, headers, schema tests), or by `npm audit` (M10) |

## Not tested

- Clinical correctness of any protocol.
- Meta Ray-Ban Display hardware, its browser, and the gesture-to-key and Back mapping. See [DEVICE-VALIDATION.md](DEVICE-VALIDATION.md).
- Firefox and WebKit.
- Screen-reader sessions. ARIA roles are set, but no assistive-technology run was performed.
- Real AI provider output; all provider behaviour is mocked.
- A service-worker update from one deployed build to the next.
- Speech output, including whether the referral announcement matches the on-screen text (H4).
- Browser enforcement of `Permissions-Policy`; only the header's presence is checked.
- API abuse: no rate limiting exists, so none is tested.
- Usability with health workers.
