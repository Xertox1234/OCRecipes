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
last_updated: 2026-09-02
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

**Dedup-extraction variant (2026-09-02):** the same failure mode arrives a
second way when you extract a shared `runFlow` helper from two call sites
that had *different* strictness before the extraction — e.g. one call site's
sequence was mandatory-by-default (a first-attempt flow) and the other's was
already `optional: true` throughout (a self-healing retry loop). Naively
adopting the more-permissive call site's shape for the shared helper — the
easy move, since it's usually the one that "already works everywhere" —
silently drops the stricter call site's fail-fast guarantee, with no diff
line calling that out (nothing looks removed; the mandatory steps just moved
into a file where they're now optional). The fix has two parts, and doing
only the first one re-triggers this same rule on the helper itself:

1. **Add the missing anchor(s) inside the shared helper**, not just back at
   the one call site that used to be strict — every caller of the helper
   needs to inherit the fail-fast guarantee, not only the one you remembered
   to patch (`e2e/helpers/enter-registration-passwords.yaml`: mandatory
   `assertVisible` on both password-field testIDs, so a stale selector fails
   fast whether the helper is called from a first attempt or a retry round).
2. **Don't make every step mandatory indiscriminately while you're in
   there.** Before hardening a given optional step, check whether it's
   optional for a *legitimate, state-dependent* reason — not just because
   the more-permissive caller happened to mark it that way. A step that taps
   a **stateful toggle with no reset** (not a text field, which is safely
   idempotent via erase-before-type) can be optional by necessity: in this
   case a "Show password" tap is only ever needed once per session, because
   the underlying `useState` flips to "Hide password" and stays there —
   making that tap mandatory would hard-fail every retry round after the
   first. Verify against the actual state management source before treating
   an optional step as a lost anchor; a second reviewer independently
   confirming the toggle's reset behavior (rather than pattern-matching
   "optional == suspect") is what caught this distinction in practice.

## Related Files

- `e2e/flows/home/chat.yaml` — the fixed flow (mandatory prompt asserts)
- `e2e/flows/scan/scan-barcode.yaml` — the same rule applied earlier: one
  mandatory SpeedDial assert so camera-optional flows stay non-vacuous
- `e2e/helpers/enter-registration-passwords.yaml` — the dedup-extraction
  variant: a shared helper built by merging a mandatory call site with an
  already-optional one, with mandatory anchors added back inside the helper
  and one deliberately-optional toggle-tap step left as-is
- `e2e/flows/onboarding/complete-onboarding.yaml` — the two call sites
  (main block, self-healing retry loop) that were unified into the helper
  above

## See Also

- [maestro-text-matching-is-full-string-regex](maestro-text-matching-is-full-string-regex-2026-08-30.md) — the selector mechanics (incl. the `?` metachar rule) that stayed hidden here
- [diagnose-e2e-from-debug-output-artifacts-first](../best-practices/diagnose-e2e-from-debug-output-artifacts-first-2026-08-30.md) — a hierarchy dump settles what a selector should be
- [verification-that-scans-zero-inputs-is-green-and-meaningless](../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md) — the same green-because-vacuous family
