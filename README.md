# Dastak

**Hands-free field health worker companion for Meta Ray-Ban Display.**

An ASHA worker conducting a home health visit has both hands occupied — holding an infant, checking temperature, balancing a register. Dastak navigates the visit protocol on the glasses, one step at a time, so she never puts the baby down. The visit record is written during the visit instead of being re-typed that evening from memory.

## The FRIDAY Layer

The voice was never the intelligence. FRIDAY's actual behaviour is that she already knows what you need before you ask. Dastak implements six behavioral properties inspired by the Stark assistants:

| Property | Implementation |
|---|---|
| **Anticipation** | Zero-query launch — opens on the right household, right protocol, right day |
| **Continuity** | Resume mid-thought — relaunch picks up at the exact step with prior answers intact |
| **Triage** | Planner speaks once — one line about the day's shape, then gets out of the way |
| **Carry-forward** | Prior visit flags appear verbatim when they become relevant — no AI, no inference |
| **Calibrated confidence** | Says when it doesn't know — offline vs. AI planned, sparse roster handled |
| **Zero friction** | Under three seconds to a usable question, one keypress, no login |

**None of these require AI.** Properties 1, 2, 4, and 6 are lookups over her own recorded data. Only the planner (property 3) and its confidence display (property 5) call a model, and neither sees a health field.

## Architecture

```
dastak/
  server.js            Express: static hosting + protocol JSON + AI proxy (plan/review only)
  data/
    hbnc.json          Visit protocol: ordered steps, types, branches
    roster.json        Demo households: id, area, protocol day, last visit
  public/
    glasses.html       Single-file MRBD app (600x600) — NO network calls post-startup
    record.html        Phone: completed visit record (reads URL fragment or localStorage)
    plan.html          Phone: AI day planner with confidence display (P2)
    review.html        Phone: supervisor pattern summary (P3)
    icon.png           52x52 PNG favicon
  .env.example         AI_API_KEY, AI_API_URL, PORT
```

## Quick start

```bash
npm install
npm start
# Open http://localhost:3000/glasses.html
```

Runs on `localhost:3000` with no `.env` and no network.

## Design boundary

**Dastak navigates a protocol. It does not practise medicine.**

- No diagnosis. No dosage. No treatment recommendation. No risk scoring.
- Danger-sign steps render the protocol's own referral instruction verbatim and set a flag. They never generate advice.
- **No AI call in the glasses app.** The protocol is static JSON. The software decides only which question comes next.
- Protocol content is modelled on the published home-based newborn care structure.

AI exists in this product in exactly two places, both deliberately far from the point of care:

| Surface | Where | When | Touches clinical decisions? |
|---|---|---|---|
| Day planner (plan.html) | Phone, before leaving | Start of day | No — ordering and routing only |
| Pattern summary (review.html) | Supervisor's phone, after sync | End of week | No — aggregate description only, human reads it |

## Privacy

- **No camera, no microphone** — enforced by the platform, stated here.
- No name, no phone number, no address anywhere in the system. Households keyed by opaque ID.
- **No identifying data ever reaches an AI call.** Fields stripped server-side in `server.js`, not in the prompt.
- GPS off by default.
- Nothing leaves the glasses until the worker explicitly syncs.
- **Visit records never reach our infrastructure.** Completed records live in the URL fragment and in device storage.

## Key constraints

- Fixed 600x600. No scrolling anywhere.
- Black background (#000) — renders as transparent on waveguide.
- Arrow keys + Enter only. Mouse unplugged.
- One monospace stack. 36px questions, 28px options, 14px labels minimum.
- Thin cyan progress rule — the only motion in the product.
- `glasses.html` contains zero fetch calls post-startup. Verifiable by grep.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/protocol/:id` | Returns the step graph |
| `POST` | `/api/plan` | P2 — roster in, ordered day out |
| `POST` | `/api/review` | P3 — visit records in, aggregate summary out |

Note: `POST /api/visit` has been removed. Visit records are encoded in the URL fragment (`record.html#<base64>`) and never transmitted to the server.

## FRIDAY Properties — Implementation Notes

### Property 4 — Carry-forward (the FRIDAY moment)

When the worker reaches a step where the previous visit to this household recorded a flag, Dastak shows one muted line beneath the question:

```
⟩ flagged at the Day 3 visit
```

**Why this is safe:**
- Verbatim recall of her own previously recorded answer
- No interpretation, no inference, no generation
- A lookup in `localStorage`, not an AI call

**Forbidden variants:**
- ❌ `may indicate a feeding problem` — interpretation
- ❌ `check more carefully this time` — instruction
- ❌ `2 of 3 recent visits flagged this` — risk score
- ✅ `flagged at the Day 3 visit` — a fact she wrote down herself

### Property 2 — Continuity (resume mid-thought)

If a visit was interrupted more than 30 minutes ago, Dastak says so plainly:

```
Resuming H-104, step 3. Interrupted 40m ago.
```

She is never confused about which family she is standing in front of.

### Property 5 — Calibrated confidence

- AI planned, full roster → `Planned for today.`
- Deterministic fallback ran → `Planned offline. Sorted by due date.`
- Roster too sparse → `Not enough scheduled visits to plan. Showing all.`

**Never present a degraded result as a confident one.**

## What is deliberately absent

- **No voice.** The platform has no microphone, and in a family's home a device that listens is a device that doesn't get invited in.
- **No vision.** No camera, and near a newborn that is a feature.
- **No interruptions.** No notifications. Nothing ever pulls her attention from a mother mid-sentence.
- **No model in the clinical path.** Properties 1, 2, 4, and 6 involve no AI at all — they are lookups over her own recorded data.
- **No visit record on our servers.** The completed record lives in the URL fragment and in her device storage. Nowhere else.

## Demo

1. Open `glasses.html` in the Meta Ray-Ban Display Web App Simulator (Chrome extension).
2. The idle frame already shows the next household (zero-query launch).
3. Press `→` to cycle households. Press `ENTER` to begin.
4. Use arrow keys and Enter to navigate the protocol.
5. If a step was flagged on a prior visit, a muted carry-forward line appears.
6. Finish to see the completion frame with duration and sync info.
7. Open `record.html` on phone to see the structured record (reads URL fragment).
8. Kill the network — nothing changes on the glasses.
9. Open `plan.html` to see the day planner with confidence display.
