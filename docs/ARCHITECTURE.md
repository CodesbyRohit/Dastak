# Architecture

## Design principle

**The critical workflow executes protocols deterministically, and every step's source is explicit. Optional AI appears only in separate, nonclinical supporting features.**

## Components

```
protocols/*.json ─┐   (canonical; edited by hand)
protocols/manifest.json ─┤
data/roster.json ─┘
        │  npm run build  → scripts/build-registry.js
        │  npm run verify → validate + rebuild in memory + diff (also the Vercel build command)
        ▼
public/generated/registry.js      (generated; committed so the app runs from static hosting)
public/sw.js  [generated section] (precache list + BUILD_ID content hash)

Wearable visit workflow (no outgoing          Support pages (network, nonclinical)
connections; loads its own files)
────────────────────────────────────          ─────────────────────────────────────
glasses.html                                  plan.html  → POST /api/plan
  js/engine.js      pure interpreter          review.html → POST /api/review
  js/store.js       device storage            record.html (device storage only)
  generated/registry.js                       api/_lib/*  shared by Vercel (api/*.js)
  js/glasses-app.js UI, keys, audio                       and Express (server.js)
                                              optional AI provider (OpenAI-compatible)
```

### Engine (`public/js/engine.js`)

A pure module: no DOM, storage or network access. The browser app, the validator and the tests all load this same file.

- **Frame types:**
  - `yesno`: `onYes`/`onNo`
  - `choice`: per-option `next`, falling back to the step's `next`
  - `count`: number stepper on a grid
  - `range`: the same grid shown as a list
  - `info`: acknowledgement; `danger: true` makes it a referral frame
- **Transitions:**
  1. A `rule` (`eq neq gt gte lt lte in`) is evaluated first.
  2. Then the frame-specific target.
  3. `null` ends the visit.
- **Visit state** is a plain object: `{ protocolId, protocolVersion, householdId, startedAt, path: [{stepId, answer}], current, status }`. `applyAnswer` and `goBack` return new objects.
- **Outcomes:**
  - A visit is `complete` only when a transition returns `null`.
  - A transition to a missing step produces `status: 'error'`, never completion.
  - An invalid answer leaves the visit unchanged.
- **Flags** are derived from the path (`visitFlags`), never accumulated. They can't be double-counted, and going back removes them.
- **Progress:** "Question N · up to M more", where M is the longest remaining path in the protocol graph.
- **`restoreVisit`** replays a saved path from the start, checking every answer against the current protocol and version. Anything inconsistent is rejected.

### Storage (`public/js/store.js`)

Wraps localStorage. Every access sits in try/catch and every read is validated.

| Key | Contents | Retention |
|---|---|---|
| `dastak.visits.v2` | Interrupted visits, one per household + protocol | Not offered after 24 hours; deleted when that household and protocol are next shown |
| `dastak.carry.v2` | Latest referral flags per household + protocol (step ID + description) | Not shown after 30 days; expired entries deleted on every carry-forward read (each start-frame render); cleared by a later visit with no flags |
| `dastak.record.v2` | The most recent completed visit record | Until replaced or deleted |
| `dastak.voice.v2` | Voice name or `off` | Until deleted |

- **Unavailable storage:** the store reports `unavailable` or `write-failed`, and the UI shows **NOT SAVED** on every frame.
- **Clearing data:** `clearAll()` (Settings → Delete data, or the button on `record.html`) removes all of these keys plus the v1 keys.
- **v1 migration:** data from before the upgrade is migrated only when it can be attributed to a protocol; see SCHEMA-CHANGELOG Amendment 7 and `migrateLegacy`. Everything else is deleted.

### Wearable UI (`public/js/glasses-app.js`, `glasses.html`)

- **Screens:**
  - start: household, protocol list, Settings
  - resume prompt
  - visit frame
  - complete
  - protocol error
  - settings
  - delete confirmation
- **Keys:**
  - ↑↓ move or adjust
  - ←→ move, or change household on the start frame
  - Enter confirms
  - Esc, Backspace or a history back goes back one question
  - Pointer clicks also work, for the desktop demo
- **Header:** every frame shows the protocol, its content status (e.g. "DRAFT · not reviewed"), progress, and whether progress is being saved.
- **Range frames** show a 5-row window starting at the protocol's `default`, so a 15–25 value range never scrolls the 600×600 page.
- **Speech:** referral frames speak exactly the on-screen prompt and referral text. If speech is off or unsupported, a tone plays instead.
- **No outgoing connections:** no inline script, and the page's CSP includes `connect-src 'none'` (meta tag and HTTP header). That blocks fetch, XHR, WebSocket, EventSource and beacons. The page still loads its own same-origin HTML, scripts and icons, from the network or the service-worker cache.

### Service worker (`public/sw.js`)

- **Precache:** the app shell, under a cache named by `BUILD_ID`. `BUILD_ID` is a hash of every precached file, so any change to a shell file produces a new cache and an update.
- **HTML:** network first, falling back to the cache.
- **Static files:** served from the cache and revalidated in the background.
- **`/api/*`:** never intercepted or cached.

### API (`api/_lib`)

| Endpoint | Purpose | AI role | Without AI |
|---|---|---|---|
| `GET /api/protocol/:id` | Serve a bundled protocol (from the registry). Legacy IDs resolve with `Deprecation` and `Link` headers. | none | n/a |
| `POST /api/plan` | Suggest a visit order for the roster | Reorders IDs only; the result must be a permutation of the input | Fixed rule (`public/js/planner.js`) |
| `POST /api/review` | Summarise aggregate visit counts | Optional ≤60-word description, denylist-filtered and labelled | Counted summary, always present |

Common guards:
- 405 with an `Allow` header for the wrong method
- 415 for a non-JSON content type
- 16 KB body limit (413)
- strict field validation (400); unknown fields are rejected, so a name can't be forwarded
- 8 s provider timeout, plus checks on the HTTP status and response size

Every failure returns the deterministic result with `fallbackReason`.

**Local and deployed are one implementation.**
- Vercel runs `api/*.js`, which re-exports `api/_lib/*`.
- `server.js` mounts the same handlers and applies the routes, redirects and headers by reading `vercel.json`.
- A unit test checks the two stay in step.

## Privacy boundaries, precisely

- **Enforced by the browser** (in browsers that implement these headers):
  - CSP `connect-src 'none'` on the wearable page
  - `Permissions-Policy` disabling camera, microphone and geolocation
  - `Referrer-Policy: no-referrer`
- **Design choices, not platform guarantees:**
  - no names in the data model; households are opaque IDs
  - device-only storage
  - no record transfer by URL
- **Not provided:**
  - encryption at rest
  - user authentication
  - sync or backup
  - protection from someone with access to the device's browser profile

## Known limitations

- The yes/no frame highlights "Yes" first. This behaviour comes from the original prototype; its safety is an open UX question.
- There are no repeat groups (removed from the schema until implemented), no localisation, and no cross-device transfer.
- The AI output filter is a word list. It lowers risk; it can't guarantee nonclinical output.
- **Expiry is enforced on read, not on a timer** (see the storage table). Nothing runs in the background to delete data at the deadline. *Delete data on this device* is immediate.
- **No API rate limiting or authentication.** This is harmless while AI is unconfigured, because responses are computed locally. Each call could trigger a paid provider request once credentials are set. Add rate limiting or auth first (audit finding R1).
- **No framing policy** (`frame-ancestors` / `X-Frame-Options`). This is deliberate: the showcase embeds the app from the same origin, and it's unknown whether Meta's simulator embeds web apps. Current Chrome partitions third-party iframe storage (audit finding R2).
- `verify`'s "UNSOURCED" count only checks the literal marker. `home_visit` names its prototype author as `content_source`, so it counts as 0 UNSOURCED while being unreviewed `clinical-draft` content (audit finding R4).
