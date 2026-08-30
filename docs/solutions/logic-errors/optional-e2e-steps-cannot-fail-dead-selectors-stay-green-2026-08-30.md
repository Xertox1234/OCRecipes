---
title: An optional Maestro step can never fail — dead selectors stay green, so environmental optionals need a mandatory sibling anchor
track: bug
category: logic-errors
tags: [testing, maestro, e2e, react-native]
module: client
applies_to: ["e2e/**"]
symptoms: ["a flow passes while the feature it names is visibly broken or unreachable", "every step in an interaction block carries optional: true and several always log WARNED", "a selector fix changes nothing because the step was WARNED-skipping before AND after"]
created: 2026-08-30
severity: medium
---

# An optional Maestro step can never fail — dead selectors stay green, so environmental optionals need a mandatory sibling anchor

## Problem

`chat.yaml`'s entire suggested-prompt interaction was dead through THREE
independent bugs at once — and the flow stayed green the whole time,
including in the first-ever green CI run:

1. The selectors contained a literal `?`, a regex metacharacter under
   Maestro's full-string matching (provably matches nothing).
2. The real a11y label is `Suggested prompt: <text>` — the bare visible text
   is not a node.
3. The flow entered via the empty-state-only "New Chat" button, which
   disappears forever once the account has any chat history — so the flow
   never reached a ChatScreen at all.

Every step was `optional: true`, so all three defects surfaced only as
WARNED lines nobody reads.

## Symptoms

See frontmatter. The tell in run output: an interaction block whose steps
consistently WARN on every run, on every platform — environmental flake is
intermittent, dead selectors are deterministic.

## Root Cause

`optional: true` converts every failure mode — wrong selector, wrong screen,
wrong entry path — into a warning no-op. A block where *all* steps are
optional asserts nothing: it cannot distinguish "camera unavailable in CI"
(the intended tolerance) from "this feature has been untested for months".
Coverage decays invisibly because the signal channel (red) is disabled.

## Solution

- Enter surfaces through **always-present** affordances (here: the chat
  list's "Start new chat" + button, a11y-labeled and unconditional), never
  through empty-state-only UI.
- Make the assertions on the reached surface **mandatory** once the entry is
  deterministic; keep `optional` only for the genuinely environmental tail
  (tapping the prompt sends a message against a stubbed AI key).
- When validating a flow fix locally, check the step logs for `COMPLETED` on
  the specific changed steps — flow-level green proves nothing about
  optional steps.

## Prevention

Any block where every step is `optional: true` is a review flag: either at
least one step in it becomes mandatory (anchoring the same surface), or the
block should be deleted as vacuous. Optionality is for environments, not for
uncertainty about what is on screen — settle the latter with a hierarchy
dump.

## Related Files

- `e2e/flows/home/chat.yaml` — the fixed flow (mandatory prompt asserts)
- `e2e/flows/scan/scan-barcode.yaml` — the same rule applied earlier: one
  mandatory SpeedDial assert so camera-optional flows stay non-vacuous

## See Also

- [maestro-text-matching-is-full-string-regex](maestro-text-matching-is-full-string-regex-2026-08-30.md) — the selector mechanics (incl. the `?` metachar rule) that stayed hidden here
- [diagnose-e2e-from-debug-output-artifacts-first](../best-practices/diagnose-e2e-from-debug-output-artifacts-first-2026-08-30.md) — a hierarchy dump settles what a selector should be
- [verification-that-scans-zero-inputs-is-green-and-meaningless](../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md) — the same green-because-vacuous family
