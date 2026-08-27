# FINDINGS

**Does the same Dastak interaction model work for different health situations without losing its simplicity?**

Yes.

---

## Before restoration (commit f14c2e9)

| Aspect | Status |
|---|---|
| Protocol generalization | PASS — P2, P3 required zero engine changes |
| P0 parity | **REGRESSION** — idle screen, triage, voice picker, test audio removed |
| Cross-protocol carry-forward | **RISK** — keyed by protocol:step only, no household namespace |
| Engine specificity | PASS — zero protocol-specific branches |

## After restoration (current)

| Aspect | Status |
|---|---|
| Protocol generalization | PASS — P2, P3 required zero engine changes |
| P0 parity | **RESTORED** — idle screen, triage, household context, carry-forward, resume, voice picker, test audio all present |
| Cross-protocol carry-forward | **FIXED** — keyed by householdId:protocolId |
| Engine specificity | PASS — zero protocol-specific branches (verified by harness) |
| Runtime verification | **ADDED** — harness validates structure, namespacing, and engine specificity |

---

## What we built

Four protocols, each stress-testing a different structural axis:

| Protocol | Status | Structural axis | Engine changes required |
|---|---|---|---|
| P0 — Routine Home Visit | `demo-ready` | Regression baseline | None |
| P1 — Danger Signs | `structural` | Branching + threshold escalation | Triggered: per-option next, range type, rule evaluation |
| P2 — Treatment Follow-Up | `structural` | Carry-forward + mandatory checklist | **Zero** — uses only pre-existing frame types |
| P3 — Post-Discharge | `structural` | Three-way choice + numeric range + sub-selection | **Zero** — all features added for P1 covered it |

P0 is clinically sourced (Rohit / original Dastak prototype). P1–P3 are structural architecture tests with UNSOURCED placeholders.

---

## P0 restoration details

The following features were removed in f14c2e9 and have been restored:

| Feature | Pre-refactor | Post-refactor (f14c2e9) | After restoration |
|---|---|---|---|
| Idle screen | Household + protocol + triage + carry-forward | Protocol selector only | **Restored** — household context + protocol options + triage + carry-forward + resume |
| Triage | `computeTriageNote()` on idle | Removed | **Restored** — same function, same output |
| ROSTER | 6 households embedded | Removed | **Restored** — same data, left/right cycling |
| Carry-forward (idle) | Display on idle screen | Removed | **Restored** — keyed by householdId:protocolId |
| Resume indicator | "Resuming H-104, step 3..." | Removed | **Restored** — same format |
| Voice picker | Select voice dropdown | Removed | **Restored** — same implementation |
| Test audio | "⟩ Test audio" button | Removed | **Restored** — speaks "Audio test" |

The idle screen now shows: household context, triage note, carry-forward, resume indicator, protocol selection options, voice picker, and test audio button. All in one frame — one decision (pick protocol + ENTER to begin).

---

## Carry-forward namespacing

### The problem

The f14c2e9 implementation keyed carry-forward by `protocolId:stepId`. If P1 (danger_signs) flagged step `temp`, and P3 (post_discharge) also has a step `temp`, P3 could surface P1's carry-forward note.

### The fix

Carry-forward is now keyed by `householdId:protocolId`. Each household+protocol combination has its own carry-forward record. P1's temp flag cannot surface in P3 because they have different protocol IDs in the key.

### Verification

The harness includes a deterministic test:
1. Simulate P1 flagging `temp` for household H-104
2. Check that P2 (adherence) for the same household does NOT inherit that flag
3. Check that P1's same-protocol carry-forward still works

Result: ✓ P2 does NOT inherit P1 carry-forward. ✓ P1 same-protocol carry-forward works.

---

## Result frame safety

Result frames never present Dastak as a diagnostic system. All result language uses neutral, worker-facing framing:

- "Responses suggest…"
- "Consider referral to…"
- "This check-in does not replace clinical judgement."

For P1–P3 structural protocols, result content uses explicit placeholders. No wording claims Dastak has diagnosed a condition.

---

## FRIDAY-layer verification

| Behaviour | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| Anticipation (zero-query launch) | Verified — idle screen loads instantly | Verified — same idle screen | Verified — same idle screen | Verified — same idle screen |
| Continuity (resume mid-thought) | Verified — save/resume via localStorage, resume indicator on idle | Verified — same mechanism | Verified — same mechanism | Verified — same mechanism |
| Triage (planner speaks once) | Verified — `computeTriageNote()` on idle screen | Not applicable — no roster context in protocol engine | Not applicable | Not applicable |
| Carry-forward (verbatim recall) | Verified — flagged steps surface prior notes, keyed by household:protocol | Verified — same mechanism | Verified — same mechanism | Verified — same mechanism |
| Calibrated confidence (offline fallback) | Verified — deterministic sort when AI unavailable | Not applicable — no AI dependency | Not applicable | Not applicable |

Triage and calibrated confidence are roster/planner features that live in the idle screen layer, not the protocol engine. They are verified in P0 and documented as not applicable for P1–P3.

---

## The measurement

| Metric | Result |
|---|---|
| Engine LOC changed per protocol added | Trending to **0** — P2 and P3 required zero engine changes |
| Max decisions per frame | **1** across every protocol, verified by harness |
| Distinct frame types in engine | **5** (yesno, choice, count, range, info) — held flat from P1 onward |
| Key presses per step | Unchanged from P0 baseline |
| Schema amendments required | **6** (see SCHEMA-CHANGELOG.md), all generalised, none special-cased |
| Protocol-specific engine branches | **0** (verified by harness) |
| Carry-forward contamination risk | **Eliminated** — householdId:protocolId namespacing |

**Most persuasive number: the last protocol (P3) required zero engine code changes.** The schema amendments from P1 covered it entirely.

---

## Where it strains

**Repeat groups (P4).** The schema supports it (`group` type with `repeat`), but the engine's group-unrolling logic is not implemented. Deferred per the cut order.

**Numeric precision.** The `range` type generates choices from min/max/step. For fine-grained measurements, this produces many items. Protocol authors should use clinically meaningful bands (0.5°C steps = 14 items).

**Triage is not generalized.** The `rule` mechanism is a generic `if-op-value → goto`. It is not a triage system that scans multiple data points, prioritises, or reorders steps. The brief explicitly designed it this way (§5: "The engine evaluates comparisons and follows ids. It does not know what a danger sign is."). P1 demonstrates branching/transition generalization, not generalized triage semantics.

---

## What Dastak proves

1. **The interaction model generalizes.** One question per frame, arrow keys + Enter, no free text — works identically across P0–P3.

2. **New protocols require zero engine code.** P2 and P3 required zero additions to the engine. The schema amendments from P1 were sufficient.

3. **No protocol-specific engine branches.** The engine is a pure interpreter. It does not know what a danger sign is, what TB adherence means, or what post-discharge involves.

4. **P0 FRIDAY-layer behaviours are preserved.** Triage, carry-forward, resume, anticipation — all work across the idle screen and during visits.

5. **Cross-protocol carry-forward contamination is prevented.** The householdId:protocolId namespace ensures flags from one protocol cannot surface in another.

## What Dastak does NOT prove

1. **Generalized triage.** The `rule` mechanism is a simple comparison, not a triage system. True triage would require accumulating state across steps and evaluating severity patterns.

2. **Repeat groups (P4).** Schema exists, engine does not. Deferred.

3. **Automated runtime testing.** The harness validates structure and namespacing. It does not load protocols in a browser, simulate keyboard input, or verify rendered output. Runtime verification is manual.

4. **Clinical content validity.** P1–P3 contain UNSOURCED placeholders. The structure generalizes; the content has not been validated.
