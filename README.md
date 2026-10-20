# Dastak

**A hands-free, one-question-at-a-time field visit workflow for a 600×600 head-worn display.**

Community health workers, such as India's ASHA workers on home-based newborn care visits, often work through a checklist with their hands full. Dastak shows exactly one question on a head-worn display such as Meta Ray-Ban Display. The worker answers with a four-way pad and a confirm gesture, and the app follows a fixed, reviewable protocol to the next question.

**Research prototype.**
- Not clinically validated, and not deployed in care.
- Not affiliated with or endorsed by Meta.
- Every bundled protocol is draft or placeholder content awaiting qualified clinical review.

| | |
|---|---|
| Wearable app | <https://dastak-orpin.vercel.app/> |
| Project showcase | <https://dastak-orpin.vercel.app/showcase.html> |
| Architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| What the tests prove | [docs/TESTING.md](docs/TESTING.md) · results: [docs/TEST-RESULTS.md](docs/TEST-RESULTS.md) |
| Audit (pre-upgrade) | [docs/AUDIT.md](docs/AUDIT.md) |
| Device validation status | [docs/DEVICE-VALIDATION.md](docs/DEVICE-VALIDATION.md) |

## Design principle

**The critical workflow executes protocols deterministically, and every step's source is explicit. Optional AI appears only in clearly separated, nonclinical supporting features.**

## How it works

```
protocols/*.json ──► npm run verify / build ──► public/generated/registry.js
                     (schema, graph, lifecycle,      │
                      drift; Vercel build step)      ▼
                                       glasses.html: engine.js (pure interpreter)
                                                     + glasses-app.js (one frame, D-pad + Enter)
                                                     + localStorage (resume, flags, last record)
                                       no outgoing connections: CSP connect-src 'none'
                                       (the page still loads its own files)

plan.html / review.html ──► /api/plan, /api/review ──► optional AI (constrained, replaceable)
```

- **Protocols are data.** Each JSON file defines steps of five frame types: `yesno`, `choice`, `count`, `range` and `info`. `info` steps marked `danger` are referral frames. Transitions are explicit step IDs, and thresholds are explicit comparisons.
- **One source of truth.** The app's bundled registry is generated from `protocols/*.json`. `npm run verify` fails on any invalid protocol or any drift between the source and the bundle. It is also the Vercel build command, so an invalid protocol can't deploy.
- **The engine is pure.** `public/js/engine.js` has no DOM, storage or network access. The app, the validator and the tests all run the same code.
- **Device-only state.** An interrupted visit can be resumed for 24 hours, after every answer is replayed and checked. Carry-forward shows the last visit's referral flags for the same household and protocol, for 30 days. Only the last completed record is kept. Settings → *Delete data on this device* removes all of it immediately. Expiry is enforced when data is read, not on a timer; see [Known limitations](#known-limitations).
- **Supporting pages.** The planner may use AI only to reorder household IDs, and every reason it shows comes from a fixed rule. The review page always shows a counted summary; any AI description is filtered and labelled. Both work without AI.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run locally

Node 20 or later.

```
npm ci
npm start                # http://localhost:3000  (wearable app at /, showcase at /showcase.html)
```

Use a 600×600 window and the keyboard:

| Key | Action |
|---|---|
| ↑ ↓ | Move selection or adjust a number |
| ← → | Choose; on the start frame, change household |
| Enter | Confirm |
| Esc / Backspace / browser Back | Back one question |

Optional AI for the planner and review pages: copy `.env.example` to `.env` and set `AI_API_KEY`, `AI_API_URL` (HTTPS) and `AI_MODEL`. Without them, both pages are fully deterministic. The wearable app never uses AI, and it opens no network connections during a visit. It does load its own HTML, scripts and icons from this site, or from the service-worker cache.

Local and deployed behaviour come from the same code. `server.js` mounts the same `api/_lib` handlers that Vercel runs, and applies the redirects, rewrites and headers from `vercel.json`.

## Tests

```
npm run verify           # protocol validation + generated-file drift
npm test                 # 100 unit tests (node:test) with coverage
npx playwright install chromium
npm run test:e2e         # browser tests, Chromium 600×600, local server
BASE_URL=https://… npm run test:deployed   # same browser tests against a deployment
npm run report           # record results in docs/TEST-RESULTS.md and on the showcase
```

What each suite proves, and what it does not, is in [docs/TESTING.md](docs/TESTING.md). The latest recorded run is in [docs/TEST-RESULTS.md](docs/TEST-RESULTS.md).

**Structural testing is not clinical validation.** The tests check how the software behaves:
- **Termination:** every path through every bundled protocol terminates. The validator proves this from the protocol graph, and the engine test walks every step and transition.
- **Numeric inputs are sampled, not exhaustive.** Weight, temperature and similar inputs are tested at selected values: the bounds, the default, and either side of each rule threshold. Not every value is tried.
- **Referral flags** are counted correctly on the tested paths.
- **During a tested visit, the page makes no requests.** Deliberate fetch, XHR and beacon calls are blocked by CSP. This was tested in Chromium with the service worker disabled during the visit; the app's own files load before the visit starts.
- **Malformed input** to the validator, storage layer and API is rejected.

Some fixed defects have **no** automated regression test. They are listed in [docs/AUDIT.md](docs/AUDIT.md) and [docs/TESTING.md](docs/TESTING.md).

They cannot tell whether a question, a threshold or a referral instruction is clinically right. Only qualified clinical review can.

## Authoring a protocol

1. Create `protocols/<id-with-hyphens>.json`. The file name must match the `id`, with underscores written as hyphens.
2. Add the id to `protocols/manifest.json` (this sets launcher order).
3. Run `npm run build`, then `npm run verify`, and commit the JSON *and* the regenerated `public/generated/registry.js` and `public/sw.js`.

```json
{
  "id": "my_protocol",
  "label": "My Protocol",
  "start": "fever",
  "status": "structural-test",
  "version": "1.0.0",
  "provenance": {
    "authoredBy": "Your name",
    "sources": [],
    "review": { "state": "unreviewed" }
  },
  "steps": [
    { "id": "fever", "prompt": "Does the beneficiary report fever?", "type": "yesno",
      "onYes": "temp", "onNo": "done", "content_source": "UNSOURCED" },
    { "id": "temp", "prompt": "Record the beneficiary's temperature", "type": "range",
      "min": 35, "max": 42, "step": 0.5, "default": 36.5, "unit": "°C", "next": "done",
      "rule": { "condition": { "op": "gt", "value": 38.5 }, "target": "refer" },
      "content_source": "UNSOURCED" },
    { "id": "refer", "prompt": "Refer to the health facility.", "type": "info", "danger": true,
      "referral": "This check-in does not replace clinical judgement.", "next": null,
      "content_source": "UNSOURCED" },
    { "id": "done", "prompt": "Check complete.", "type": "info", "next": null,
      "content_source": "UNSOURCED" }
  ]
}
```

**Content lifecycle (`status`):**

| Status | Meaning | Required |
|---|---|---|
| `structural-test` | Exercises engine structure; placeholder content | — |
| `clinical-draft` | Intended clinical content, not yet reviewed | — |
| `reviewed-demo` | Reviewed by a named qualified person, for demonstration only | Cited `sources`, no `UNSOURCED` steps, review `{reviewer, role, date, scope}` |
| `clinically-approved` | Approved for use by an accountable body | All of the above, plus `state: "approved"` and `approvalReference` |

**Rules:**
- **Frame types:**
  - `yesno` needs `onYes` and `onNo`.
  - `choice` needs at least two options: all strings, or all `{label, value, next?}` objects.
  - `count` and `range` need `min`, `max`, `step` and `default`, with the default on the step grid.
  - `danger` is only allowed on `info` steps, and requires `referral`.
- **Rules (`rule`):** a rule must be able to fire for some answers but not all. Cycles are rejected.
- **Wording:** use worker-facing language that never implies a diagnosis. Never write "The beneficiary has…" or "Diagnosis:".
- **IDs:** never change a shipped ID. Add the old one to `legacyIds`.
- Schema history: [SCHEMA-CHANGELOG.md](SCHEMA-CHANGELOG.md).

**Bundled protocols:**

| Protocol | Status | Notes |
|---|---|---|
| Routine Home Visit (`home_visit`, formerly `hbnc_day7`) | `clinical-draft` | Prototype-authored newborn-care content; no cited source; **needs clinical review**. Its `content_source` names the prototype author, so `npm run verify` reports "0 UNSOURCED". That count means "not marked UNSOURCED", **not** "clinically sourced". |
| Danger Signs (`danger_signs`) | `structural-test` | Placeholder; tests branching and threshold escalation |
| Treatment Follow-Up (`adherence`) | `structural-test` | Placeholder; tests per-option branching and carry-forward |
| Post-Discharge (`post_discharge`) | `structural-test` | Placeholder; tests nested choices, ranges and rules |

## Privacy boundaries

- **The wearable page can't open network connections.** It is served with CSP `connect-src 'none'` (meta tag and header), which blocks fetch, XHR, WebSocket, EventSource and beacons. A Chromium test confirms that fetch, XHR and beacon are blocked. The page still loads its own same-origin HTML, scripts and icons.
- **The service worker downloads only the app's own static files.** These are plain GET requests with no visit data.
- **Camera, microphone and geolocation are disabled** by `Permissions-Policy`, in browsers that honour it. This is a site policy, not a platform guarantee.
- **Nothing in the data identifies a person by name.** Households are opaque IDs, and the API rejects any additional fields.
- **Visit data stays in one browser's localStorage.**
  - It is **not encrypted**.
  - It isn't synced or backed up.
  - It is never accepted from or written to a URL.

## Known limitations

- **No clinical validation of any content.** The thresholds (38.5 °C, 140 mmHg) are unsourced placeholders. All referral wording is unsourced or unreviewed. No protocol is clinically approved.
- **No health-worker usability testing** has been done.
- **No device testing.** Nothing has been tested on Meta Ray-Ban Display hardware or with Meta's Web App Simulator. In particular, the mapping of the Back gesture is unverified; see [docs/DEVICE-VALIDATION.md](docs/DEVICE-VALIDATION.md).
- **Missing features:** no cross-device record transfer, sync, encryption at rest, sign-in or localisation, and no repeat groups.
- **Yes/no default:** the yes/no frame highlights "Yes" first, as in the original prototype. Whether any default is safe needs testing with workers.
- **AI filter:** the review page's AI filter is a word list; it reduces risk but is not a guarantee.
- **No API rate limiting or authentication.** Anyone can call `/api/plan` and `/api/review`. This is harmless while AI is unconfigured (as in production at the time of writing), because the responses are computed locally. If AI credentials are set, each call can trigger a paid provider request. Add rate limiting, for example a Vercel Firewall rule, or authentication before enabling AI publicly.
- **No framing policy.** No `frame-ancestors` or `X-Frame-Options` header is set, so any site can embed the app. The showcase relies on this to embed the app from the same origin, and whether Meta's simulator embeds web apps is unknown. Current Chrome gives third-party iframes separate storage, so an embedding site can't read first-party visit data; other browsers weren't checked.
- **Expiry is enforced on read, not on a timer.** An expired interrupted visit is never offered, but it stays in storage until its own household and protocol are next shown on the start frame. Expired carry-forward flags are deleted whenever carry-forward data is read, which happens on every start-frame render. Settings → *Delete data on this device* removes everything immediately.

## Repository layout

```
protocols/         canonical protocol JSON + manifest.json
schema/            protocol JSON Schema
data/roster.json   demo households (opaque IDs)
scripts/           build-registry.js, report.js, lib/validate-protocol.js
public/            static site (Vercel output directory)
  glasses.html     wearable app (also served at /)
  showcase.html    project presentation
  record.html, plan.html, review.html   phone-facing support pages
  js/ css/ generated/ sw.js
api/               Vercel functions (thin) + api/_lib shared handlers
server.js          local server mirroring vercel.json
verify.js          protocol conformance + drift check
test/unit, test/e2e
docs/              architecture, testing, results, audit, device validation
FINDINGS.md        original generalisation findings (with corrections)
```

MIT licensed.
