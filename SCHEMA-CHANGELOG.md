# SCHEMA-CHANGELOG

Every amendment to the protocol schema, why it was needed, which invariant it touched, and what it cost.

---

## Amendment 1 — `content_source` on every step

**What:** Added a required `content_source` field to every step definition.

**Why:** The brief (§7) mandates that no clinical content be invented. Every step must declare whether its content is sourced or unsourced. The build must fail loudly if a `demo-ready` protocol still has `UNSOURCED` steps.

**Invariant under pressure:** I7 (No invented clinical content). This field makes the invariant machine-enforceable rather than relying on human review.

**Cost:** Zero. A string field on each step. No engine logic change.

---

## Amendment 2 — `choice` options accept objects with `next`

**What:** `options` in a `choice` step may now contain objects `{ "label", "value", "next" }` in addition to plain strings. When present, the `next` field overrides the step-level `next` for that specific option.

**Why:** P1 (danger signs) and P3 (post-discharge) require branching based on which option the worker selects. Without per-option `next`, every choice would route to the same next step, making branching impossible without adding a new interaction pattern.

**Invariant under pressure:** I6 (No new interaction pattern). Branching was reduced to the existing `choice` frame type — the worker still picks one option with arrow keys + Enter. Only the routing logic changed.

**Cost:** ~5 lines in `getNextStep()`. No renderer change. No new frame type.

---

## Amendment 3 — `range` step type

**What:** Added a new step type `range` with `min`, `max`, `step`, and optional `unit`. The engine generates a choice list from these parameters. Rendering is identical to `choice`.

**Why:** P1 and P3 require numeric measurement capture (temperature, blood pressure). The brief explicitly prohibits building a number-entry UI (§5). The reduction: generate a choice list from the range parameters, keeping rendering and input identical to the existing `choice` frame.

**Invariant under pressure:** I5 (One decision per frame) and I6 (No new interaction pattern). A `range` step renders as a choice list — the worker picks one value with arrow keys + Enter. One decision. Same frame type.

**Cost:** ~15 lines for `generateRangeChoices()` + `renderRange()`. The renderer delegates to `renderChoice()` with a synthetic step object. No new CSS. No new HTML.

---

## Amendment 4 — `rule` on steps (escalation)

**What:** Added an optional `rule` field on steps: `{ "condition": { "op", "value" }, "target": "stepId" }`. After the worker selects an answer, the engine evaluates the rule. If the condition is met, it jumps to the target step instead of the normal `next`.

**Why:** P1 requires threshold-based escalation: if temperature exceeds 38.5°C, route to the referral frame. P3 requires similar escalation for blood pressure. Without rules, the only way to express this would be to enumerate every value as a separate branching option — verbose, error-prone, and not how clinical protocols work.

**Invariant under pressure:** I1 (No AI in the clinical path). Rules are static JSON comparisons authored by protocol designers. The engine compares values; it does not interpret them. The rule does not know what a "danger sign" is — it compares numbers and jumps to an ID.

**Cost:** ~15 lines in `evaluateRule()` + ~5 lines in `getNextStep()`. No renderer change. Rules are evaluated before the normal next-step logic.

---

## Amendment 5 — `group` step type (schema only)

**What:** Added `group` step type with `steps` (child steps), `skippable` (boolean, default true), and `repeat` (object with `bind` step ID and `count`).

**Why:** P4 (household repeat groups) requires the same steps to run per household member, with the count bound to an earlier answer. The brief identifies repeat groups as "where one-question-per-frame is most likely to break."

**Invariant under pressure:** I5 (One decision per frame). A group with N repeats produces N×M individual frames — each still one decision. The group is a structural container, not a UI element.

**Cost:** Schema-only for the prototype. Engine support for unrolling groups is deferred to P4 implementation. The schema amendment costs nothing at runtime.

---

## Amendment 6 — `protocol.status` field

**What:** Added `status` field to the protocol root: `"draft"` or `"demo-ready"`.

**Why:** The harness must distinguish between protocols with complete content and those still using placeholders. A `demo-ready` protocol with `UNSOURCED` steps must fail the build.

**Invariant under pressure:** I7 (No invented clinical content). This field drives the conformance check.

**Cost:** One string field. No engine logic.

---

## Amendment 7 — Content lifecycle, provenance, strict validation (DevFest 2026 upgrade)

**What:**
- **`status`** is now one of four values:
  - `structural-test`: placeholder content that exercises the engine.
  - `clinical-draft`: intended clinical content, not yet reviewed by a qualified person.
  - `reviewed-demo`: reviewed by a named qualified person for demonstration only.
  - `clinically-approved`: approved by an accountable body; requires an approval reference.
  The old values `draft`, `demo-ready` and `structural` are gone.
- **New required `version`** (semver).
- **New required `provenance`:** `{ authoredBy, sources[], review: { state, reviewer?, role?, date?, scope?, approvalReference? }, notes? }`.
- **New optional `legacyIds[]`:** earlier IDs that still resolve.
- **Count and range steps** now require `default`. The default must be on the step grid, within `[min, max]`.
- **`options`** must be all strings or all objects, never mixed. Option values must be unique.
- **`rule.condition.value`** must be a number for `gt/gte/lt/lte`, an array for `in`, and a string or number for `eq/neq`.
- **Unknown fields are rejected.** Each frame type has a defined set of allowed fields; for example, `onYes` on a choice step fails.
- **`danger`** is allowed on `info` steps only, and requires `referral`.
- **Removed the `group` step type** (Amendment 5). The engine never implemented it, so a protocol using it would have passed the schema and then failed at runtime. Repeat groups remain deferred; they'll be re-added with an engine implementation and tests.

**Migration (no clinical text changed):**

| Protocol | Before | After |
|---|---|---|
| `home_visit` | `demo-ready` | `clinical-draft`, `legacyIds: ["hbnc_day7"]` |
| `danger_signs`, `adherence`, `post_discharge` | `structural` | `structural-test` |

`home_visit` was called "clinically sourced", but its only `content_source` is the prototype author. That is authorship, not a citation, and no qualified review is on record. **It needs clinical review before it can move to `reviewed-demo`.**

**Why:**
- The previous schema was never applied by the harness. If it had been, its `status` enum would have rejected three of the four protocols.
- The lifecycle has to distinguish "tests the software" from "reviewed content" from "approved for care". A passing schema check must never read as clinical validation.

**Enforcement:** `scripts/lib/validate-protocol.js`, run by `npm run verify` and by the Vercel build, applies:
- the schema, via Ajv
- semantic checks: transition targets, reachability, cycles, termination, numeric grids, rules that can never or always fire
- lifecycle rules: `reviewed-demo` and `clinically-approved` need cited sources, complete review metadata and no `UNSOURCED` steps; `clinically-approved` also needs an approval reference

**Invariant under pressure:** I7 (No invented clinical content). Provenance is now explicit and machine-checked. Clinical *correctness* still needs human review.

**Cost:** No engine change for existing protocols. The engine rendering of `range` changed separately (a windowed list starting at `default`; see docs/ARCHITECTURE.md).

---

## Summary

| # | Amendment | Engine LOC | Renderer changes | New frame type |
|---|---|---|---|---|
| 1 | content_source | 0 | 0 | No |
| 2 | Per-option next | ~5 | 0 | No |
| 3 | range type | ~15 | Delegates to choice | No |
| 4 | Rule/escalation | ~20 | 0 | No |
| 5 | group type | 0 (schema only) | 0 | No |
| 6 | protocol.status | 0 | 0 | No |
| 7 | Lifecycle, provenance, strict validation; `group` removed | 0 | Range rendered as windowed list | No |

**Total engine additions:** ~40 lines. **New frame types added:** 0. **Renderer changes:** 0 (range delegates to existing choice renderer).

Every new requirement reduced to an existing frame type or a minimal engine-side evaluation. The interaction pattern did not change.
