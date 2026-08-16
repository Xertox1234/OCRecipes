---
title: Pin a silence claim to the stream the claim is about — a combined-stream assertion inherits runtime diagnostics
track: bug
category: code-quality
tags: [testing, harness, node, spawnsync, stderr, ci-only-failure]
module: shared
applies_to: ["scripts/__tests__/**", "server/scripts/__tests__/**", ".claude/hooks/**"]
symptoms: ["A spawned-process 'no output' test is green locally and red on CI with an unrelated Node warning in the assertion diff", "expect(out.trim()).toBe('') fails with MODULE_TYPELESS_PACKAGE_JSON or an experimental-feature warning", "The assertion concatenates stdout + stderr before asserting emptiness"]
created: 2026-08-16
severity: medium
last_updated: 2026-08-16
---

# Pin a silence claim to the stream the claim is about — a combined-stream assertion inherits runtime diagnostics

## Problem

A pin test asserted "the checker silently drops out-of-scope args (exit 0, no
output)" as `expect(out.trim()).toBe("")` where `out` was stdout + stderr
concatenated. CI's newer Node prints a `MODULE_TYPELESS_PACKAGE_JSON` warning
to stderr when spawning an ESM-syntax `.js` file from a `"type"`-less package —
so the test was green locally and red on CI (PR #822, two failed checks from
one assertion), for a reason unrelated to the script's behavior.

## Symptoms

- Green locally, red on CI, with a Node/tooling diagnostic — not script output —
  in the assertion diff.
- The failure appears or disappears with a Node version change, not a code
  change.
- The test's claim names the SUBJECT ("the script stays silent") but the
  assertion observes a surface the subject doesn't own (stderr belongs partly
  to the runtime).

## Root Cause

stdout is the script's voice; stderr is shared with the runtime (deprecation
warnings, module-type diagnostics, experimental-feature notices — all version-
dependent). An exact-emptiness assertion over the combined stream therefore
asserts a property of the Node version, not of the script. Same family as the
enabling-precondition pin: a silence assertion silently depends on something
outside the test — there the harness default, here the runtime's diagnostic
chatter.

## Solution

Return the streams separately from the spawn helper and assert emptiness on
stdout only, with a comment naming the precondition:

```ts
const { status, stdout } = run(realScript, [outOfScope]);
expect(status).toBe(0);
// Pin the SCRIPT's silence on stdout only — newer Node prints a
// MODULE_TYPELESS_PACKAGE_JSON warning to stderr for ESM-parsed bare .js
// files, which is harness noise, not script output.
expect(stdout.trim()).toBe("");
```

Keep the combined stream for CONTENT assertions (`toContain(...)` is immune to
extra noise); reserve stream-exact emptiness for the stream the claim owns. If
stderr cleanliness genuinely matters, assert targeted negatives
(`not.toContain("Error")`), never exact-empty.

## Prevention

- When writing any emptiness/silence assertion over process output, name the
  stream in the claim and assert only that stream.
- Audit shortcut: `expect(...stderr...).toBe("")` and helpers returning only
  `stdout + stderr` are the smells. The leaf-pin "importable without
  DATABASE_URL" tests (`barcode-policy.test.ts` and its five copies) follow
  this convention: assert `status` first, then a targeted stderr negative
  (`expect(r.stderr).not.toMatch(/error|DATABASE_URL/i)`), never exact-empty
  — apply the same shape to any new copy of this pin test.

## Related Files

- `scripts/__tests__/check-jsdom-pragma.test.ts` — the fixed pin (PR #822).
- `scripts/ci-failed-logs.sh` — how the CI-only failure was isolated.

## See Also

- [A silence assertion is only as strong as its unstated preconditions](silence-assertion-must-pin-its-enabling-harness-default-2026-08-09.md) — the sibling facet: pin the enabling condition; this doc pins the observed surface.
- [A test comment must claim only what its own harness can observe](a-test-comment-must-claim-only-what-its-own-harness-can-observe-2026-08-06.md) — the claim/observation alignment rule this specializes to streams.
