# Dastak — Engineering, Security and Product Audit

**Audited revision:** `3278686` (main, 2026-08-27) and the live deployment at <https://dastak-orpin.vercel.app/>
**Audit date:** 2026-10-20
**Method:**
- Reading every source file.
- Scripted browser reproduction with Playwright and Chromium at a 600×600 viewport, against `node server.js` and against the live site.
- Probing the live HTTP endpoints with `curl`.

Every finding marked **Reproduced** was observed in a browser or over HTTP, not only inferred from the code. README claims were treated as claims to be checked.

This document records the state *before* the DevFest 2026 upgrade. Each finding names the fix, and the "Status after upgrade" column in the summary table is updated as fixes land.

---

## Severity scale

| Severity | Meaning |
|---|---|
| Critical | Can produce a wrong or misleading visit outcome, blocks the core workflow, or is an exploitable security flaw |
| High | Corrupts data, gives the user false information, or breaks a documented guarantee |
| Medium | Degrades usability, accessibility or maintainability; misleading documentation |
| Low | Hygiene |

---

## Critical

### C1 — The live root URL serves a stale, single-protocol engine
- **Evidence:**
  - `vercel.json` rewrites `/` to `/glasses.html`, but Vercel checks the filesystem before rewrites, so `/` serves `public/index.html` (39,842 B).
  - `public/index.html` contains a separate engine with a single embedded protocol, `var PROTOCOL = {"id":"hbnc_day7",…}` (L229), and its own roster (L220).
  - Locally, `express.static` also serves `index.html` at `/`.
  - Reproduced, live: `typeof PROTOCOL !== 'undefined'` and `typeof PROTOCOLS === 'undefined'` at `/`.
- **Impact:** The demo URL people will open runs neither the multi-protocol engine the README describes nor any of the fixes made to `glasses.html`. There are two engines to keep in step, and only one is ever tested.
- **Fix:** `/` serves the multi-protocol app. `index.html` becomes a redirect to `/glasses.html` and its engine is removed. Saved data under the old ID `hbnc_day7` is migrated to `home_visit`.

### C2 — Resuming an interrupted visit discards its earlier answers and referral flags
- **Evidence:** In `public/glasses.html`, `startProtocol()` (L516) calls `checkResume()`, which restores `answers`, `flags` and `stepHistory`. It then immediately resets `stepHistory = []`, `answers = {}` and `flags = []` (L524–526).
- **Reproduced:**
  1. Answer "No" to feeding, which raises the referral frame `flag_feeding`.
  2. Reload.
  3. Resume and finish the visit.
  4. The completion screen reads `4 steps · 0 flags`. The saved progress before the reload contained the flag.
- **Impact:** A referral raised before an interruption disappears from the visit record and from carry-forward. This is a patient-safety-relevant data loss.
- **Fix:** Resume restores all saved state, and the restored record is validated against the protocol, its version and the household before use.

### C3 — An unfinished visit can be shown as "COMPLETE · Visit recorded"
- **Evidence:** There are two routes to a false COMPLETE:
  - `resumeStep` is a global that a successful resume never clears. A later `startProtocol()` for a different protocol calls `renderStep(resumeStep)` (L529).
  - `renderStep()` treats any missing step ID as completion: `if (!step) { renderComplete(); return; }` (L683).
- **Reproduced:**
  1. Resume Routine Home Visit.
  2. Go back to idle.
  3. Start Treatment Follow-Up.
  4. The COMPLETE screen appears with `0 steps · 0 flags`, and a "last record" is written.
- **Impact:** A visit where no questions were asked is recorded as successfully completed. Any authoring error that targets a missing step does the same.
- **Fix:** A missing step leads to an explicit "Protocol error — visit NOT complete" frame. Resume state is scoped to one visit and cleared when that visit ends.

### C4 — Count frames cannot be confirmed with D-pad + Enter
- **Evidence:** `renderCount()` focuses the "+" button (L797). Enter clicks whatever is focused (L992–995), so Enter increments the value. In the `count` state all four arrow keys adjust the value and never move focus, so the ✓ button can't be reached without a pointer.
- **Reproduced:** On "Record the baby's weight", pressing Enter three times changes the value 2.8 → 3.1. Arrow keys don't leave the frame either. This also happens on the live site.
- **Impact:** The first question of the Routine Home Visit (P0) is a count frame, so the core workflow can't be finished with the declared input model ("arrow keys + Enter only", README invariant I4).
- **Fix:** Enter always confirms on count frames, and ↑/↓ adjusts the value.

### C5 — After choosing a protocol, Enter does not start the visit
- **Evidence:** `cycleLaunch()` moves focus to a protocol button (L509–514). That button's click handler only selects the protocol (L488–494). The visit starts only from the hidden `#idle-start-focus` button.
- **Reproduced:** Press ↓ to pick "Danger Signs", then Enter. No question appears, and focus stays on "DANGER SIGNS" (also on the live site).
- **Impact:** Only the first protocol can be started with the keyboard, unless the worker first presses ← or →, which happens to refocus the hidden start button.
- **Fix:** Enter on the idle frame starts the selected protocol.

### C6 — Stored DOM XSS in `record.html` via the URL fragment
- **Evidence:** `public/record.html` decodes the fragment with `JSON.parse(atob(location.hash))` (L41) and saves the result to localStorage (L44). It then concatenates record fields into HTML and assigns it to `innerHTML` (L69–100): `householdId`, `area`, `protocol`, `completedAt`, flag `type` and `referral`, and answer keys and values.
- **Reproduced:** A link with `{"protocol":"<img src=x onerror=…>"}` runs script, both locally and live. Because the payload is persisted, it runs again on every later visit to `/record.html` with no fragment.
- **Also wrong:**
  - The page says "Record transmitted via URL fragment. Never stored on server." Base64 is encoding, not protection.
  - Nothing in the app produces such a link; the glasses only write to their own localStorage.
  - A fragment still lands in browser history, sync and screenshots.
- **Fix:** Remove URL-fragment import, validate the structure of stored records, and render everything with `textContent`.

---

## High

### H1 — Referral flags are double-counted, and abandoned branches keep their flags
- **Evidence:** `advance()` (L876) pushes a flag when it *enters* a danger step (L895–902) and again when it *leaves* one (L886–893). `goBack()` and the popstate handler never remove flags.
- **Reproduced:** One referral frame on the path gives `7 steps · 2 flags`, and the record has `flagCount: 2`. The pre-reload save from C2 holds two identical `flag_feeding` entries.
- **Fix:** Derive flags from the path actually taken, the ordered list of steps answered. Then counts are exact, and going back removes the flags from that branch.

### H2 — Back navigation corrupts the step history and can reopen a recorded visit
- **Evidence:** `goBack()` pops one history entry, then calls `history.back()`. The popstate handler (L1149) pops until it finds the target step, which removes one entry too many. From the COMPLETE screen, the browser's Back reopens the last step of a visit already recorded, and completing it again writes a second record.
- **Fix:** The engine owns an explicit path stack. Completion replaces the history entry, so Back can't return into a recorded visit.

### H3 — The idle-screen triage line is hardcoded and false
- **Evidence:** `computeTriageNote()` (L461) returns the literal "Three overdue in Sector 3. Start there." whenever anything is overdue.
- **Reproduced:** The roster has two overdue households, H-087 in Sector 7 and H-098 in Sector 3.
- **Fix:** Compute the triage line deterministically from the roster.

### H4 — Referral audio contradicts the on-screen referral
- **Evidence:** `playReferralTone()` (L1060) always speaks "Refer to the health facility". The screen may say something else, for example "Report side effects to the supervisor" (adherence) or "Monitor blood pressure closely" (post-discharge).
- **Fix:** Speak exactly the text shown on the frame.

### H5 — Blocked storage leaves a blank app
- **Evidence:** `populateVoices()` reads `localStorage` without a try/catch (L1081) and runs before `renderIdle()` (L1141).
- **Reproduced:** When `localStorage` throws (private mode, blocked site data or a policy), the page throws `blocked` and the idle screen never renders.
- **Fix:** Route all storage through a safe wrapper. Keep working when storage is unavailable, and show a persistent "NOT SAVED" warning.

### H6 — Range frames overflow the 600×600 display and ignore `default`
- **Evidence:** `renderRange()` renders every value as a button at least 88 px tall.
- **Reproduced:** On the temperature frame, 15 buttons take 1,512 px inside an `overflow:hidden` 600 px body. The selected value is 35 °C, not the protocol's `default` of 36.5. Blood pressure would have 25 buttons.
- **Fix:** Show a windowed list of 5 values, starting on the protocol's `default`. Rendering changes only; the protocol data does not.

### H7 — Several unsynchronised sources of truth for protocol and roster data
| Copy | Location | Notes |
|---|---|---|
| Canonical (intended) | `protocols/*.json` | The only copy `verify.js` checks |
| Wearable registry | `public/glasses.html` L164–238 | Copied by hand |
| Legacy engine | `public/index.html` L229 | ID `hbnc_day7`, no provenance |
| Legacy data | `data/hbnc.json` | Used by `server.js` |
| API | `api/protocol/[id].js` | Inline object; serves only `hbnc_day7` |
| Roster ×4 | `data/roster.json`, `glasses.html` L151, `index.html` L220, `plan.html` | Labels disagree with the protocol run (e.g. "ANC month 6" launches Treatment Follow-Up; "HBNC Day 21" launches Danger Signs) |

`GET /api/protocol/home_visit` returns 404 on the live site, so the API can't serve any canonical protocol.

**Fix:** Generate one bundled registry from `protocols/*.json` and `data/roster.json` at build time, and have `verify` fail if the committed copy has drifted. The API serves that registry, and `hbnc_day7` is kept as a documented legacy alias.

### H8 — The conformance harness reports passes for checks it does not perform
- **Evidence (`verify.js`):**
  - "Keyboard: all frame types navigable" (L835) is printed unconditionally.
  - "Terminal paths reach defined end states" (L840–845) loops and does nothing, then prints a pass.
  - "I5" (L814–830) checks only that the type is known.
  - The header promises "No cycles" (L627); there is no cycle detection.
  - The JSON Schema is loaded only to count its definitions (L673). It is never applied to any protocol.
  - If it were applied, it would reject three of the four protocols: the schema's `status` enum is `draft | demo-ready` and they use `structural`. Mixed string and object `options` would fail the `option` definition too.
  - The carry-forward "test" (L908–942) builds a JavaScript object and checks that object. It never runs engine code.
- **Fix:**
  - Validate against the schema with Ajv, then run semantic graph checks and drift detection.
  - Run real engine and browser tests.
  - Print only what was actually checked.

### H9 — API handlers crash on malformed input and return model output unchecked
- **Reproduced (live):**
  - `POST /api/plan {"roster":5}` → **500 FUNCTION_INVOCATION_FAILED**
  - `POST /api/review {"visits":[{"flags":7}]}` → **500 FUNCTION_INVOCATION_FAILED**
  - `POST /api/plan {"roster":"ab"}` → `200 {"order":[{"reason":"due in undefined day"},…]}`
- **Evidence:**
  - There's no validation of the request body's structure or size.
  - `aiRes.ok` is never checked, and there's no timeout on the provider call.
  - The planner returns whatever JSON the model produces, with no check that it contains exactly the input households. Free-text `reason` and `note` reach users.
  - The review summary is returned verbatim.
  - `server.js` and `api/*.js` duplicate the logic and differ: when the roster is missing, the server uses the demo roster and the API uses `[]`.
- **Live configuration observed:** every live response had `offline: true`, so no AI credentials are configured in production at this revision.
- **Fix:**
  - One set of shared handlers, used by both Vercel and Express.
  - Method checks (405 with an `Allow` header), JSON content-type checks (415), size limits, structure checks (400), and an 8 s provider timeout.
  - Planner: the AI may only permute the input IDs, and all reasons are deterministic.
  - Review: a deterministic summary is always included. The AI paragraph is labelled, length-limited and filtered with a denylist, and the deterministic text is used if any check fails.

### H10 — The service worker never picks up updates and caches API responses
- **Evidence (`public/sw.js`):**
  - It is cache-first for every same-origin GET, with a fixed cache name, `dastak-v8`. Deploys reach installed clients only if someone remembers to bump that name.
  - It caches `GET /api/*` responses, although its comment says "network-first for API".
  - `/` isn't in the precache list. Offline it works only because navigations fall back to `/glasses.html`.
- **Fix:**
  - Precache the app shell, with a version derived from the build's content hash.
  - Network-first for HTML, falling back to the cache.
  - Never cache `/api/*`.

---

## Medium

| ID | Finding | Evidence | Fix |
|---|---|---|---|
| M1 | Progress is not path-based. "Step X of N" uses the step's array index and the array length, so it jumps and never matches the path taken. | `getStepDisplayIndex` L392, `updateProgress` L691 | "Question N · up to M more", computed from the protocol graph |
| M2 | Completion text claims a transfer that doesn't exist: "Visit recorded. Open on phone to view record". | L949 | Truthful text: "Saved on this device only" |
| M3 | Setup controls sit on the visit-start frame. The voice `<select>` can't be used with a D-pad. | L84–86 | Separate Settings frame |
| M4 | Assistive-tech semantics: no `aria-live` region for prompt changes; `role="radio"` without a `radiogroup`. | L484, L744, L810 | Live region and radiogroup |
| M5 | No data-deletion control, and no retention lifecycle. Carry-forward flags and the last record persist forever. | `saveCarryData` L577 | Settings → "Delete local data" with a list of what is deleted; documented expiry |
| M6 | No security headers: no CSP, `Permissions-Policy`, `X-Content-Type-Options` or `Referrer-Policy` on any route. | `curl -I` of the live site | Per-route headers in `vercel.json` and `server.js` |
| M7 | The JSON Schema advertises a `group` step type the engine cannot run. | `schema/protocol.schema.json` | Remove it from the schema and document it as deferred |
| M8 | `deterministicSort` is duplicated three times (`server.js`, `api/plan.js`, `plan.html`). | — | One shared module |
| M9 | Count frames fall back to a default of 2.8 kg for *any* protocol that omits `default`. | `renderCount` L766 | Require `default` in the schema |
| M10 | The production dependency tree has known advisories: `express@4.22.2` → `qs` (moderate) and `proxy-addr` (critical). Express is used only by the local dev server, not on Vercel. | `npm audit --omit=dev` | `npm audit fix` (non-breaking) |

## Documentation claims checked

| Claim | Source | Finding |
|---|---|---|
| "index.html — Phone-facing entry (redirects to glasses.html)" | README | False. It is a second engine (C1). |
| "No voice/TTS layer exists" (I3) | README | False. `speechSynthesis` is used for referral and carry-forward prompts. |
| "P0 is clinically sourced" | README, FINDINGS | Unsupported. Every `content_source` is "Rohit / original Dastak prototype", which records authorship, not a clinical citation, and no qualified review is on record. |
| "Treatment Follow-Up: carry-forward + mandatory checklist" | README, commit f14c2e9 | No checklist exists in the protocol or the engine. |
| "No camera, no microphone — enforced by the platform" | README | Not verified anywhere in the repo. The app simply never requests them. |
| "Zero network calls in the glasses app" | README | The page script makes no fetch/XHR calls. It does register a service worker, which fetches and caches assets. This is now enforced with CSP `connect-src 'none'` and a browser test. |
| "Every frame navigable with arrow keys + Enter alone — verified by harness" | README, FINDINGS | False (C4, C5). The harness prints the line unconditionally (H8). |
| "Verified" in the FRIDAY-layer table | FINDINGS | Resume (C2) and carry-forward (H1) were broken. Nothing tested them at runtime. |
| "Or open public/glasses.html directly — no server required" | README | Works only partly from `file://`: the service worker can't register, and ES-module-style loading would fail. |

## Artifacts

- `dastak.zip` is a committed 26 KB archive of an older build (2026-08-22). It is unused, and it is a sixth stale copy of the app. Remove it; git history keeps it.

## Not in scope of this audit

- **Clinical correctness of any protocol content.** That needs qualified clinical review. Software tests can't establish it, and this audit does not.
- **Behaviour on physical Meta Ray-Ban Display hardware.** Not tested.

## Summary

"Fixed" means the code change is in place. The **Test evidence** column says whether an automated test guards it. The full mapping is in [TESTING.md](TESTING.md#audit-findings-tested-versus-fixed-only).

| ID | Severity | Status after upgrade | Test evidence |
|---|---|---|---|
| C1 | Critical | Fixed. `/` serves the multi-protocol app; legacy engine removed | Tested (`api-contract.spec.js`; also against production) |
| C2 | Critical | Fixed. Resume replays and validates the saved path | Tested (`wearable.spec.js`, `store.test.js`) |
| C3 | Critical | Fixed. Error frame, never COMPLETE; per-visit resume state | Tested (`wearable.spec.js`, `engine.test.js`) |
| C4 | Critical | Fixed. Enter always confirms | Tested (`wearable.spec.js`) |
| C5 | Critical | Fixed. Enter starts the selected protocol | Tested (`wearable.spec.js`) |
| C6 | Critical | Fixed. No fragment import; validated records; textContent only | Tested (`pages.spec.js`, `store.test.js`) |
| H1, H2, H3, H5, H6 | High | Fixed | Tested (`wearable.spec.js`) |
| H4 | High | Fixed in code: speech reads the on-screen prompt and referral text | **Not tested.** No automated test covers speech output |
| H7, H8 | High | Fixed | Tested (`validator.test.js` drift and CLI tests) |
| H9 | High | Fixed | Tested (`api.test.js`, `api-contract.spec.js`) |
| H10 | High | Fixed in code | **Partially tested.** Precaching, offline reload and never caching `/api` are tested, also against production. An update between two deployed builds is **not tested** |
| M1 | Medium | Fixed | Partially tested (progress text in `wearable.spec.js`; figures in `engine.test.js`) |
| M4 | Medium | Fixed in code: `aria-live` region, radiogroup semantics | **Not tested.** No assertions and no screen-reader session |
| M2, M3, M5–M9 | Medium | Fixed | Covered indirectly (settings and deletion flow, header and schema tests) |
| M10 | Medium | Fixed by `npm audit fix` (Express 4.22.3) | `npm audit`: 0 vulnerabilities at the time of the fix |

## Found during the release-readiness review (2026-10-20)

These are recorded here, not fixed. None changes application behaviour.

| ID | Severity | Finding | Status |
|---|---|---|---|
| R1 | Medium (cost and abuse, only if AI is enabled) | `/api/plan` and `/api/review` have no rate limiting or authentication. In production the AI variables currently resolve to empty, so responses are computed locally and cost nothing. If credentials are set, each anonymous call can trigger a paid provider request. | Open. Add rate limiting (e.g. a Vercel Firewall rule) or auth **before** enabling AI |
| R2 | Low | No `frame-ancestors` or `X-Frame-Options`, so any site can embed the app. This is intentional for the same-origin showcase embed and the possibility that Meta's simulator embeds web apps. Current Chrome partitions third-party iframe storage, so embedders can't read first-party visit data; other browsers weren't checked. | Open; documented decision |
| R3 | Low (documentation) | Expiry is enforced on read. An expired interrupted visit is never offered, but it stays stored until its household and protocol are next shown. Expired carry-forward flags are pruned on every carry read. | Documented in README and ARCHITECTURE |
| R4 | Low (communication) | `home_visit`'s `content_source` names the prototype author, so `npm run verify` reports "0 UNSOURCED" for it. That count means "not marked UNSOURCED", not "clinically sourced". The protocol is `clinical-draft` with review state `unreviewed`. | Documented; clinical review outstanding |
| R5 | Low (hygiene) | An empty stray file named `{console.log(b.version())` was committed at the repository root by an earlier `scripts/report.js` (a Windows shell-quoting mistake, since fixed in the script). It was never served. | Removed in this change |
