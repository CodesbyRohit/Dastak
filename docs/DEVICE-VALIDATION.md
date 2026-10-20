# Device validation

**Status: no device or simulator validation has been performed.** Everything below is either a constraint taken from Meta's public developer page or a check still to be run.

## What Meta documents (checked 2026-10-20)

Source: <https://developers.meta.com/wearables/web-apps/>

- **Display:** 600×600, additive. Dark backgrounds fall away, so high-contrast content stands out. Dastak uses a black background with white and cyan text.
- **Input:** gestures arrive as standard arrow-key and Enter events. Dastak's whole workflow uses only these keys.
- **Neural Band:** optional, recommended for gestures. Pinch-and-drag is opt-in, and Dastak doesn't use it.
- **Offline:** service workers and the Cache API are the suggested approach. Dastak uses both.
- **Simulator:** the "Meta Ray-Ban Display Web App Simulator" Chrome extension recreates the display and D-pad input.
- **Not stated on that page:**
  - how the Back gesture is delivered (Escape key, `history.back()`, or something else)
  - storage limits
  - whether the `mrbd-web-app-capable` meta tag is still used

## What Dastak assumes, and how to confirm it

| Assumption | Why it matters | How to confirm | Status |
|---|---|---|---|
| Arrow keys and Enter reach the page as `keydown` events | The whole workflow depends on it | Simulator, then hardware: complete every protocol | Not checked |
| Back arrives as Escape, Backspace, `BrowserBack`/`GoBack`, or a history back | Going back one question | Hardware: trigger the back gesture mid-visit | Not checked |
| 34 px prompts, 26 px options and 18 px meta text are legible | Readability in daylight | Hardware: read every frame type outdoors | Not checked |
| Cyan focus ring and the red referral colour stay distinct on an additive display | Referral frames must stand out | Hardware: compare a normal frame with a referral frame | Not checked |
| localStorage persists across app relaunches | Resume and carry-forward | Hardware: interrupt a visit, relaunch, resume | Not checked |
| Service worker installs; the app reloads offline | Offline operation | Hardware: load once, disable Wi-Fi and tether, relaunch | Not checked |
| Speech synthesis is available, or degrades to tones | Referral audio | Hardware: Settings → Test audio | Not checked |
| The page can be framed or embedded by the simulator | Simulator testing | Simulator | Not checked |

## Running the simulator check

1. Install the Meta Ray-Ban Display Web App Simulator extension (linked from Meta's page above) in desktop Chrome.
2. Open the deployed app URL (`/`) in the simulator.
3. For each protocol, complete a visit two ways:
   - accept every default
   - choose the alternative at every frame
4. Check each frame for:
   - no clipped text
   - the focus ring visible
   - the progress line updating
5. Mid-visit, use the simulator's back control. Record which key or event it sends.
6. Reload mid-visit and confirm the "Interrupted visit" frame.
7. Record the results in this file: date, extension version, browser version, and pass/fail per row above.

## Browser tests are not a substitute

`npm run test:e2e` drives Chromium at 600×600 with keyboard events, as described in [TESTING.md](TESTING.md). It shows that the app's own behaviour is right for those events. It can't show:
- that the glasses send those events
- how the additive display renders the colours
- how the app behaves under the glasses' browser and power management
