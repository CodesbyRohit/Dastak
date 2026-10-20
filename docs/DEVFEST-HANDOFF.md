# DevFest Mumbai 2026: Dastak handoff

Status as verified on **2026-10-20**. Production `https://dastak-orpin.vercel.app` serves `main` at `5e01b1c`, with service-worker `BUILD_ID` `1d5beccc8c5b`. Every claim below is either backed by evidence listed in this file or is marked **[CONFIRM]**, meaning the presenter must verify it.

> One-line framing: *a deterministic, offline, one-question-at-a-time visit workflow for a 600×600 head-worn display. It's a research prototype: not clinically validated, not tested on the glasses.*

---

## 1. Verified architecture

```
protocols/*.json ─► npm run verify (Vercel build step) ─► public/generated/registry.js
                    schema + graph + lifecycle + drift          │
                                                                ▼
glasses.html: engine.js (pure interpreter) + glasses-app.js (one frame) + localStorage
              CSP connect-src 'none'  →  the page cannot open network connections

plan.html / review.html ─► /api/plan, /api/review ─► optional AI (currently resolves as "not configured")
```

| Claim | Evidence |
|---|---|
| One protocol source; the bundle is generated, and any drift fails the build | `npm run verify`. Vercel's production build log (2026-10-20 07:38 UTC) shows `node verify.js` → "Structural checks passed" |
| The interpreter is the same code in the browser, the validator and the tests | `public/js/engine.js`, loaded by `glasses.html`, `scripts/lib/validate-protocol.js` and `test/unit/engine.test.js` |
| The visit path can't open network connections | CSP in a `glasses.html` meta tag plus a response header. The browser test calls fetch, XHR and `sendBeacon`; all three are blocked, the browser records connect-src violations, and no request completes (local and production) |
| Production runs the intended build | Production `sw.js` has `BUILD_ID` `1d5beccc8c5b`; the registry ID `33ac0553f226` matches the local build |
| Offline reload works on the real hosting | `offline.spec.js`, 4/4 against production (see §7) |
| AI is optional and off in production | `POST /api/plan` and `/api/review` report `fallbackReason: "AI not configured"`. The variables exist in Vercel but resolve to empty at runtime |

## 2. What the prototype actually demonstrates

**Demonstrated (tested):**
- **Four structurally different protocols on one engine,** with no protocol-specific code. `verify` rejects protocol IDs hard-coded in engine or app code.
- **Every step and every transition** of every bundled protocol is exercised by the engine unit test. Numeric answers are sampled at the bounds, the default, and each side of a rule; not every value is tried.
- **Keyboard-only completion at 600×600:**
  - 3 protocols: every frame is rendered and checked by the browser suite.
  - `post_discharge`: the suite renders 5 of 11 frames. The other 6 were checked by hand in this review, not by the suite.
- **Referral flags** are counted once, removed by Back, and preserved across interruption and resume.
- **Protocol errors** show "visit NOT complete" and never a false completion.
- **Storage:** works when storage is blocked or full, with a "NOT SAVED" banner.
- **Offline reload** works after a single online load.

**Not demonstrated:**
- Clinical validity.
- Behaviour on Meta Ray-Ban Display hardware, or in Meta's Web App Simulator.
- Usability with health workers.
- Cross-device data, sync, or encryption.

## 3. Contributions

What git can show (`git shortlog -sne origin/main`, commit trailers):

| Evidence | Detail |
|---|---|
| `CodesbyRohit` | Author of 33 commits, including the original prototype (2026-08-22 onward) and the 10 upgrade commits (2026-10-20) |
| `Pratik-sanap` | 1 commit, `a324223`: "Optimize glasses app for 30Hz, fix QA contrast/history/viewport, add Vercel serverless API handlers". Merged via PR #1 |
| `copilot-swe-agent[bot]` | 1 merge commit (`f116ace`) resolving conflicts for PR #1 |
| AI tooling | 20 commit messages mention Codebuff (pre-upgrade work). The 10 upgrade commits carry `Co-Authored-By: Claude Opus 5.5` |

**[CONFIRM] before presenting:**
- Which of the above is your own work.
- Who designed the interaction model, the FRIDAY-layer concept and the original protocol content.
- Anyone who contributed outside git, such as research, field input, design or judging feedback.

Git can't attribute ideas or decisions. Present only what you can personally account for.

## 4. Three defensible engineering decisions

**1. No generative AI in the visit path: a deterministic interpreter over protocol data.**
- *Why:* the same answer must always lead to the same next question. Content must be reviewable line by line before use, and the device must work offline.
- *Trade-off:*
  - No free-text understanding or flexible questioning.
  - Every content change needs authoring, `verify` and human review.
  - Branching is limited to explicit rules (`eq/neq/gt/gte/lt/lte/in`).
  - Repeat groups were removed from the schema because the engine never implemented them.

**2. A generated, committed registry with a drift gate in the deploy build.**
- *Why:* the original repo had five hand-maintained copies of protocol data. A drift gate makes "what is tested equals what ships" a build failure instead of a review comment.
- *Trade-off:*
  - Authors must run `npm run build` and commit generated files.
  - Any edit to an app-shell file changes the service-worker `BUILD_ID`, so forgetting to rebuild fails `verify`.
  - The generated file adds diff noise.

**3. Device-only state, with flags derived from the path and resume validated by replay.**
- *Why:*
  - Flags computed from the path can't be double-counted, and Back removes them; both were real defects before the upgrade.
  - Replaying the saved path against the current protocol version rejects stale or tampered resume data.
- *Trade-off:*
  - No sync or backup; data is lost if the browser is cleared.
  - Data is not encrypted at rest.
  - Supervisor review runs on sample data only.
  - A protocol version bump discards in-progress visits.

## 5. Known limitations and open questions

- **Clinical content:**
  - `home_visit` is an unreviewed `clinical-draft` (audit R4). Its per-step `content_source` records authorship ("Rohit / original Dastak prototype"), not a citation. `verify` therefore reports it as "0 UNSOURCED". Don't present that as "sourced".
  - The other three protocols are `structural-test` placeholders, including the 38.5 °C and 140 mmHg thresholds.
- **Hardware:** untested. How the Back gesture reaches a web app isn't stated on Meta's page; see `docs/DEVICE-VALIDATION.md`.
- **Yes-first default:** yes/no frames highlight "Yes" first, carried over from the original prototype. Is a default safe? Unanswered.
- **API abuse (audit R1):** there is no rate limiting or authentication on `/api/plan` and `/api/review`. That's harmless while AI is unconfigured, but enabling AI publicly would expose provider cost to abuse. Decide before setting the AI variables.
- **Framing (audit R2):** no `frame-ancestors` policy, so any site can embed the app. Third-party iframes get partitioned storage in current Chrome, so the risk is low, but it's an undocumented decision. It was left open because it isn't known whether Meta's simulator embeds the app.
- **Lazy expiry (audit R3):**
  - Carry-forward flags older than 30 days are pruned whenever carry data is read, which in practice is every start-screen render.
  - An interrupted visit older than 24 hours is never offered, but it's deleted only when its household and protocol are next displayed.
- **Untested fixes:**
  - H4 (speech reads the on-screen referral text) has no automated test.
  - A service-worker *update* between two deployed builds is untested.
  - No screen-reader session has been run.
- **AI filter:** the review-page filter is a word list. It reduces risk; it doesn't guarantee anything.
- **AI configuration:** the production AI variables resolve to empty. Is that intentional? **[CONFIRM]**

## 6. Demo path and fallback

**Prepare (5 minutes before):**
1. Open Chrome, then DevTools → device toolbar → custom size 600×600. Load `https://dastak-orpin.vercel.app/` once while online; this installs the offline cache.
2. On the start frame, press ↑ (wraps to Settings) and Enter. Then press ↓ ↓ and Enter (*Delete data on this device*), then → and Enter (*Delete*). This gives a clean start.
3. In a second tab, open `/showcase.html`.

**Live path (about 4 minutes; expected on-screen text in quotes):**
1. Start frame shows "H-104 · Sector 3 · due today" and "2 overdue · start with H-087 (Sector 7)". Press **Enter** on Routine Home Visit.
2. Weight: ↑ ↑ → "3.0", **Enter**.
3. "Is the baby breastfeeding well?" → **←** (No) → **Enter** → red "Referral flag · Feeding difficulty recorded".
4. **Reload the page** mid-visit → Enter → "Interrupted visit · Resume H-104 at question 3?" → **Enter**.
5. Enter through the remaining frames → "Visit complete · … 2 referral flags". (The "Yes" default on "feels cold" adds the second flag.)
6. Enter → start frame now shows "⟩ flagged last visit: Feeding difficulty recorded".
7. ↓ to Danger Signs → Enter → Enter (fever: Yes) → the range opens at "36.5 °C" → ↓ ×5 → "39.0 °C" → Enter → referral frame.
8. Optional, while still **online**: in the console, `fetch('/api/protocol/home_visit')` is rejected, and the console shows a CSP `connect-src` violation. Offline, it fails anyway, which proves nothing.
9. Offline: DevTools → Network → Offline → reload → the start frame loads, with the carry-forward line still shown.

This path was run against production on 2026-10-20, and every step showed the expected text.

**Fallbacks:**
- **No internet:** `npm ci && npm start` on the laptop, then open `http://localhost:3000/` with the same steps. Run `npx playwright install chromium` beforehand if you plan to show tests.
- **Laptop or browser failure:** the showcase page embeds the real app (it needs internet). **[CONFIRM]** whether you want a pre-recorded screen capture; none exists in the repo.
- **Showing evidence:** `npm run verify`, then `npm test`. Both finish in seconds, offline.

## 7. Evidence from this review (commands actually run, 2026-10-20)

| Command | Result |
|---|---|
| `npm ci` | clean install |
| `npm run verify` | passed; 4 protocols, statuses as listed |
| `npm test` | 100/100; coverage 98.05% lines, 90.48% branches, 98.59% functions |
| `npm run test:e2e` | 60/60 (local, Chromium 141) |
| `BASE_URL=https://dastak-orpin.vercel.app npx playwright test --project=deployed` | **60/60, including the 4 offline tests** that were skipped on the protected preview |

The production run was also recorded with `BASE_URL=https://dastak-orpin.vercel.app npm run report`. `docs/TEST-RESULTS.md` now shows verify 1/1, unit 100/100, local browser 60/60 and production 60/60, with 0 skipped.

## 8. Likely technical questions

1. **"Why not use an LLM? Wouldn't it be more flexible?"**
   - The visit path needs repeatable, reviewable behaviour, offline.
   - AI exists only in the planner, where it may only reorder IDs (rejected unless it returns exactly the input IDs), and in review, where its text is labelled and filtered.
   - *Evidence:* `api/_lib/plan.js`, and 12 mocked failure modes in `test/unit/api.test.js`.
2. **"Has this run on the actual glasses?"**
   - **No.** It has been tested in Chromium at 600×600 with keyboard events, which Meta documents as the input model.
   - The simulator and hardware checks are listed with exact steps in `docs/DEVICE-VALIDATION.md`.
3. **"Is the medical content validated?"**
   - **No.** The lifecycle statuses make that explicit: one unreviewed draft and three placeholders.
   - `verify` blocks `reviewed-demo` or `clinically-approved` without cited sources and named review metadata.
   - Passing tests prove behaviour, not correctness.
4. **"What happens when a protocol author makes a mistake?"**
   - At build time, 46 classes of defect are rejected with specific error codes (`test/unit/validator.test.js`).
   - At runtime, a missing target shows "visit NOT complete" and writes no record (`wearable.spec.js`, C3).
5. **"Where does patient data go, and is it secure?"**
   - Only into one browser's localStorage. It is unencrypted, and there are no names; households are opaque IDs.
   - The page can't open network connections (CSP, tested). The API rejects unknown fields, so names can't be forwarded.
   - Limits: no encryption, no auth, no rate limiting, and the camera and microphone are blocked by site policy, not by a platform guarantee.

## 9. 15-minute talk outline

| Time | Section | Content |
|---|---|---|
| 0:00–1:30 | Problem | Hands-busy home visits. Why a head-worn display, and why one question per frame |
| 1:30–3:00 | Principle | Deterministic, explicitly sourced execution; AI only off the critical path |
| 3:00–7:00 | Live demo | §6 steps 1–9: referral flag, interruption and resume, range rule, offline |
| 7:00–9:30 | Architecture | Protocol data → verify gate → registry → pure engine; device-only state; CSP boundary |
| 9:30–11:30 | Engineering honesty | The audit: real defects found (false COMPLETE, lost flags, XSS) and how tests now guard them; "tests prove behaviour, not clinical correctness" |
| 11:30–13:00 | Decisions and trade-offs | The three decisions in §4 |
| 13:00–14:00 | Limits and next steps | Clinical review, simulator and hardware validation, rate limiting before enabling AI, worker studies |
| 14:00–15:00 | Q&A buffer | Use §8 |
