# Dastak

Multi-protocol health visit companion for India's ASHA community health workers, running on Meta Ray-Ban Display.

## Why this exists on glasses

Her hands are holding a newborn. It cannot be a phone. This is not a website that fits on glasses — it only works because the glasses exist.

## One question per frame

Every screen shows exactly one question or decision. Arrow keys to navigate, Enter to confirm. No scrolling, no menus, no lists, no free text, no voice input. This is the interaction model the judges praised — and it works identically across every protocol.

## Multi-protocol engine

Dastak scales by adding more protocols behind the same frame. Each protocol is a JSON file in `protocols/`. The engine interprets the JSON; it never contains clinical logic. Adding a new protocol means editing protocol JSON only.

### Protocols

| Protocol | File | Status | Structural axis |
|---|---|---|---|
| Routine Home Visit | `protocols/home-visit.json` | `demo-ready` | Baseline — HBNC Day 7 |
| Danger Signs | `protocols/danger-signs.json` | `structural` | Branching + threshold escalation |
| Treatment Follow-Up | `protocols/adherence.json` | `structural` | Carry-forward + mandatory checklist |
| Post-Discharge | `protocols/post-discharge.json` | `structural` | Three-way choice + numeric range + sub-selection |

P0 is clinically sourced. P1–P3 are structural architecture tests — they prove the engine generalises without inventing clinical content. `UNSOURCED` placeholders will be filled by Rohit.

### Frame types

The engine supports exactly five frame types. No sixth way to interact has ever been needed.

| Type | Input | Use case |
|---|---|---|
| `yesno` | Arrow keys + Enter | Binary questions |
| `choice` | Arrow keys + Enter | Multiple options, each can route to a different next step |
| `count` | Up/Down + Enter | Numeric values with +/- adjustment |
| `range` | Arrow keys + Enter | Numeric values rendered as a generated choice list |
| `info` | Enter only | Display-only frames (danger flags, completion) |

## How to author a new protocol

Create a JSON file in `protocols/`. Here's the minimum:

```json
{
  "id": "my_protocol",
  "label": "My Protocol",
  "start": "step1",
  "status": "draft",
  "version": "1.0.0",
  "steps": [
    {
      "id": "step1",
      "prompt": "Does the beneficiary report fever?",
      "type": "yesno",
      "onYes": "step2",
      "onNo": "step3",
      "content_source": "UNSOURCED"
    },
    {
      "id": "step2",
      "prompt": "Temperature recorded",
      "type": "info",
      "danger": true,
      "referral": "Refer to the health facility.",
      "next": "step3",
      "content_source": "UNSOURCED"
    },
    {
      "id": "step3",
      "prompt": "Assessment complete",
      "type": "info",
      "next": null,
      "content_source": "UNSOURCED"
    }
  ]
}
```

### Rules

- Every step needs `id`, `prompt`, `type`, and `content_source`
- `yesno` steps need `onYes` and `onNo` (step IDs)
- `choice` steps need `options` (array of strings or objects with `{ label, value, next }`)
- `range` steps need `min`, `max`, `step`
- Set `status: "demo-ready"` only when all `content_source` values are non-UNSOURCED
- Set `status: "structural"` for architecture tests with UNSOURCED placeholders
- Run `npm run verify` to validate before committing

### Result frame safety

Result frames must never present Dastak as a diagnostic system. Use neutral, worker-facing language:

- "Responses suggest…"
- "Consider referral to…"
- "This check-in does not replace clinical judgement."

Never use "The beneficiary has…" or "Diagnosis:" or any wording that claims Dastak has diagnosed a condition.

### Branching

Each choice option can carry its own `next`:

```json
{
  "id": "feeling",
  "prompt": "How is the beneficiary feeling?",
  "type": "choice",
  "options": [
    { "label": "Well", "value": "well", "next": "vitals" },
    { "label": "Unwell", "value": "unwell", "next": "referral" }
  ],
  "content_source": "UNSOURCED"
}
```

### Escalation rules

A step can have a `rule` that jumps to a different step if a condition is met:

```json
{
  "id": "temp",
  "prompt": "Record temperature",
  "type": "range",
  "min": 35.0, "max": 42.0, "step": 0.5,
  "unit": "°C",
  "next": "next_question",
  "rule": {
    "condition": { "op": "gt", "value": 38.5 },
    "target": "referral"
  },
  "content_source": "UNSOURCED"
}
```

## Privacy

- No camera, no microphone — enforced by the platform.
- No name, no phone number, no address. Households keyed by opaque ID.
- Zero network calls in the glasses app — verifiable: `grep glasses.html for fetch/XMLHttpRequest` returns nothing.
- Visit records live in device storage. Never on our servers.

## Carry-forward

When the worker reaches a step where a prior visit recorded a flag, Dastak shows one muted line beneath the question:

```
⟩ flagged at the Routine Home Visit visit
```

Verbatim recall of her own previously recorded answer. No interpretation, no inference, no generation. A lookup in localStorage, not an AI call.

## Conformance

Run the harness to validate all protocols:

```
npm run verify
```

This checks:
- Every protocol has valid structure
- Every `next` id resolves (no orphans, no unreachable steps)
- Every frame yields exactly one decision (I5)
- Every frame navigable with arrow keys + Enter alone
- No `UNSOURCED` step in any `demo-ready` protocol

## Run locally

```
npm install && npm start
# http://localhost:3000/glasses.html
```

Or open `public/glasses.html` directly — no server required.

## Architecture

```
public/
  glasses.html          Multi-protocol engine + launcher (600×600)
  index.html            Phone-facing entry (redirects to glasses.html)
  record.html           Phone: completed visit record
  plan.html             Phone: AI day planner
  review.html           Phone: supervisor pattern summary
  sw.js                 Service worker: offline shell
schema/
  protocol.schema.json  Formal JSON Schema for protocol definitions
protocols/
  home-visit.json       P0 — HBNC Day 7 (regression baseline)
  danger-signs.json     P1 — branching + escalation
  adherence.json        P2 — carry-forward + mandatory checklist
  post-discharge.json   P3 — three-way choice + range + sub-selection
verify.js               Conformance harness
SCHEMA-CHANGELOG.md     Every schema amendment and why
FINDINGS.md             Answer to the judges' question
```

## Invariants

| # | Invariant | Enforcement |
|---|---|---|
| I1 | No AI in the clinical path | Zero network calls in glasses.html. Clinical logic is static JSON. |
| I2 | Offline-first | Service worker caches app shell. All data embedded. |
| I3 | No camera, no mic | Platform constraint. No voice/TTS layer exists. |
| I4 | Arrow keys + Enter only | All frame types use this input model. |
| I5 | One decision per frame | Verified by harness. |
| I6 | No new interaction pattern | All new requirements reduce to existing frame types. |
| I7 | No invented clinical content | content_source field on every step. Harness rejects UNSOURCED in demo-ready. |
| I8 | FRIDAY-layer behaviours preserved | Anticipation, continuity, triage, carry-forward work across all protocols. |

## Cut order

If implementation runway becomes constrained, cut scope in this order:

1. P4
2. Automated harness → fall back to manual verification checklist
3. P3

Never cut:
- P0 regression parity
- SCHEMA-CHANGELOG.md
- FINDINGS.md
- P1
- P2

Three deeply tested protocols are better than four half-finished protocols. A truthful structural protocol is better than invented clinical content. A documented architectural limitation is better than a fake abstraction.
