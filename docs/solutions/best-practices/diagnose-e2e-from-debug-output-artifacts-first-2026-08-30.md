---
title: Diagnose E2E failures from the run's own hierarchy artifacts and a local sim loop BEFORE spending a dispatch
track: knowledge
category: best-practices
tags: [testing, harness, maestro, e2e, ci]
module: client
applies_to: ["e2e/**", ".github/workflows/e2e-regression.yml"]
created: 2026-08-30
---

# Diagnose E2E failures from the run's own hierarchy artifacts and a local sim loop BEFORE spending a dispatch

## When this applies

Any red E2E run, and any planned change to `e2e/**` — before dispatching CI.

## Rule

1. **Mine the failed run first.** The workflow's `--debug-output` artifact
   contains, per flow per attempt: `commands.json` (per-command
   status/error), `screenshots/`, and `screen-hierarchy/*.json` — the exact
   tree Maestro matched against. `gh run download <id> -n logs-<platform>`
   costs nothing. The hierarchy dump outranks the screenshot (a screenshot
   shows the splash overlay; the dump shows whether the form behind it is
   mounted and what every field VALUE is), and both outrank any theory.
   Example: one dump (`input-password = TestPass123!`,
   `input-confirm-password =` empty) replaced an entire class of AutoFill
   theories with "the keyboard covers the confirm field".
2. **Iterate locally, not by dispatch.** Reproduce against a local
   simulator/emulator with the CI-mirror env (seed curls, `adb reverse`,
   relaxed rate limits) and single-flow `maestro test` runs —
   minutes per cycle vs 60-90 per dispatch. `maestro check-syntax` after
   every YAML edit. The commissioning history is the case study: 9
   dispatch-driven sessions vs one artifact-driven session that closed every
   remaining failure with 4 dispatches, each validating an already
   locally-proven fix.
3. **Budget dispatches and treat local green as the entry ticket** — dispatch
   to confirm CI-only deltas (timing, screen size, fresh-install state), not
   to discover basics.

## Smell patterns

- A fix rationale citing a screenshot but no hierarchy dump.
- Two consecutive dispatches testing variants of the same theory.
- A flow edit dispatched without a local single-flow run.
- A dev-build console error dismissed as cosmetic: its LogBox toast is a
  tap-blocking UI element at the screen bottom (it hid the register toggle on
  Android) — fix the error at its source.

## Exceptions

Genuinely CI-only phenomena (runner image contents, fresh-install first-run
prompts, cold-start contention) can only be settled by a dispatch — but even
then, the diagnosis still starts from that run's artifacts.

## Related Files

- `.github/workflows/e2e-regression.yml` — artifact upload steps
- `package.json` `e2e:*` scripts — `--debug-output`/`--flatten-debug-output`

## See Also

- [maestro-text-matching-is-full-string-regex](../logic-errors/maestro-text-matching-is-full-string-regex-2026-08-30.md) — found this way
- [ios-sim-secure-fields-swallow-synthetic-input](../logic-errors/ios-sim-secure-fields-swallow-synthetic-input-2026-08-30.md) — found this way
- [verification-that-scans-zero-inputs-is-green-and-meaningless](../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md) — the same evidence-first family
