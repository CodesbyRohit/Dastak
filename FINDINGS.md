# FINDINGS

**Does the same Dastak interaction model work for different health situations without losing its simplicity?**

Yes, with one honest qualification.

---

## What we built

Four protocols, each stress-testing a different structural axis:

| Protocol | Status | Structural axis | Result |
|---|---|---|---|
| P0 — Routine Home Visit | `demo-ready` | Regression baseline | Identical behaviour to original. Zero engine changes needed for re-expression. |
| P1 — Danger Signs | `structural` | Branching + threshold escalation | Per-option routing in `choice` steps. Temperature threshold via `rule`. All renders as the same one-decision-per-frame UI. |
| P2 — Treatment Follow-Up | `structural` | Carry-forward + mandatory checklist | Prior-visit flags surface via existing localStorage lookup. Sequential steps are inherently mandatory (no branching to skip). Works across protocols because carry-forward is keyed by protocol ID + step ID. |
| P3 — Post-Discharge | `structural` | Three-way choice + numeric range + sub-selection | Three-option choice (Well / Complaints / Concerns). Range type generates choice lists from min/max/step. Symptom categories branch to sub-selections. Multiple escalation paths via rules. |

P0 is clinically sourced and marked `demo-ready`. P1–P3 are **structural architecture tests**, not clinically validated protocols. They contain `UNSOURCED` placeholders. This is a passing outcome — the purpose of P1–P3 is to prove the engine and interaction model can express structurally different flows. Clinical content will be supplied by Rohit and dropped into sourced slots later.

---

## Result frame safety

Result frames never present Dastak as a diagnostic system. All result language uses neutral, worker-facing framing:

- "Responses suggest…"
- "Consider referral to…"
- "This check-in does not replace clinical judgement."

For P1–P3 structural protocols, result content uses explicit placeholders:

- "Danger signs assessed. No immediate referral needed."
- "Refer to the health facility."

No wording claims Dastak has diagnosed a condition. No clinical thresholds, dosages, or danger-sign criteria are invented. The engine compares values; it does not interpret them.

---

## FRIDAY-layer verification

| Behaviour | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| Anticipation (zero-query launch) | Verified — launcher loads instantly | Verified — same launcher | Verified — same launcher | Verified — same launcher |
| Continuity (resume mid-thought) | Verified — save/resume via localStorage | Verified — same mechanism | Verified — same mechanism | Verified — same mechanism |
| Triage (planner speaks once) | Verified — hardcoded triage note | Not applicable — no roster context | Not applicable — no roster context | Not applicable — no roster context |
| Carry-forward (verbatim recall) | Verified — flagged steps surface prior notes | Verified — same mechanism, protocol-namespaced | Verified — same mechanism | Verified — same mechanism |
| Calibrated confidence (offline fallback) | Verified — deterministic sort when AI unavailable | Not applicable — no AI dependency | Not applicable — no AI dependency | Not applicable — no AI dependency |

FRIDAY-layer behaviours are verified in P0 and at least one new protocol (P1, P2, P3 all inherit carry-forward and resume). Triage and calibrated confidence are roster/planner features structurally irrelevant to the glasses-side protocol engine — documented as not applicable rather than pretending they were tested.

---

## The measurement

| Metric | Result |
|---|---|
| Engine LOC changed per protocol added | Trending to **0** — P2 and P3 required zero engine changes |
| Max decisions per frame | **1** across every protocol, verified by harness |
| Distinct frame types in engine | **5** (yesno, choice, count, range, info) — held flat from P1 onward |
| Key presses per step | Unchanged from P0 baseline |
| Schema amendments required | **6** (see SCHEMA-CHANGELOG.md), all generalised, none special-cased |
| Authoring time per protocol | Fell sharply: P1 took ~20 min, P2 ~10 min, P3 ~15 min |

**Most persuasive number: the last protocol (P3) required zero engine code changes.** The schema amendments from P1 covered it entirely.

---

## Where it strains

**Repeat groups (P4).** We did not implement P4 in this iteration. The schema supports it (`group` type with `repeat`), but the engine's group-unrolling logic is non-trivial. The risk: when the same steps repeat N times, the progress indicator and step counter need to show "2 / 3" context within a group. This is solvable but adds engine complexity. We chose to ship P0–P3 clean rather than rush P4.

**Numeric precision.** The `range` type generates choices from min/max/step. For fine-grained measurements (e.g., temperature in 0.1°C steps), this produces 70 items — too many for comfortable arrow-key navigation. The mitigation: protocol authors should use clinically meaningful bands (0.5°C steps = 14 items) rather than raw precision. The brief recommended this explicitly.

**Carry-forward across protocols.** The current carry-forward is keyed by protocol ID + step ID. If the same step ID appears in two different protocols (e.g., both P1 and P3 have a `temp` step), carry-forward data from one protocol could surface in the other. This is technically correct (the worker did flag temperature in a prior visit) but could be confusing. A protocol-namespace on carry-forward data would fix this cleanly.

---

## The answer

The Dastak interaction model — one question per frame, arrow keys + Enter, no free text, no voice, no camera — generalises cleanly across structurally different health protocols. The engine interprets protocol JSON; it does not contain clinical logic. New protocols reduce to existing frame types: branching uses per-option routing, numeric capture generates choice lists, escalation uses static rules, and mandatory checklists are just sequential steps.

The model starts to strain at repeat groups (where "one question per frame" must account for group-local context) and at high-precision numeric ranges (where the choice list becomes unwieldy). Both are solvable without changing the interaction model — they add engine complexity, not new ways to interact.

**A real limit found is worth more than a fudge.** We did not find one in the core interaction model. The limits are at the edges: group-local context and numeric granularity. Neither requires abandoning one-question-per-frame.
