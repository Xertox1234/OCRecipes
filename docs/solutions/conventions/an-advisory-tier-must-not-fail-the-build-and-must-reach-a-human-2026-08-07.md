---
title: An advisory tier added to a gate must not fail the build — and must be printed somewhere a human reads
track: knowledge
category: conventions
module: shared
tags: [scripts, gates, lint-staged, preflight, ci, developer-experience, harness, hook-scripts]
applies_to: [scripts/**/*.js, scripts/**/*.ts, scripts/preflight.sh, .husky/**, package.json]
created: '2026-08-07'
---

# An advisory tier added to a gate must not fail the build — and must be printed somewhere a human reads

## Rule

When a hard threshold produces a bad experience (you are under it for months, then one change puts
you over and you must stop and fix it right now), the fix is a **second, non-fatal tier** that warns
while there is still room to act. Two constraints, and a warning tier that misses either one is
worse than not adding it:

1. **It must exit 0.** A warning that fails the build is just a second wall, earlier. That
   recreates the exact problem it was added to solve.
2. **It must be printed where a human will actually see it.** Verify this by running the real
   venue, not by reasoning about it — most gate runners *swallow* the output of a passing task.

## Smell patterns

- A new `WARN_` threshold whose branch also increments a failure counter, or shares an exit path
  with the hard failure.
- A warning added to a script invoked by `lint-staged`, a quiet CI step, or a runner whose helper
  suppresses stdout on success — with no check that the text reaches the terminal.
- A warning message that repeats generic advice the reader has already followed.
- Two thresholds with no guard against them being edited into an inverted or overlapping state.

## Why

`scripts/check-rules-file-size.js` enforces a 6,500 B cap on `docs/rules/*.md`. The cap alone is a
wall: a file sits under it for months, then one codification lands on 6,501 B and the author has to
abandon their task and run a whole trim. That happened three times in three months.

`WARN_BYTES = 5700` warns with headroom to spare — but only if it reaches someone:

- **`lint-staged` swallows it.** `handleTaskOutput` forwards a task's captured output only when the
  task **fails** or when `verbose: true` is set. `.husky/pre-commit` passes neither, so an advisory
  from a *passing* task is captured and discarded. Confirmed by running a real `lint-staged`
  invocation against a staged over-warn fixture: only `[STARTED]`/`[COMPLETED]` appeared.
- **`preflight.sh`'s `run()` swallows it too** — the gate is deliberately quiet on success, dumping
  output only on failure.
- **CI prints it** — into a green job nobody opens, post-push, after the context is gone.

So the advisory existed in code and in none of the places its own rationale targeted. The fix was a
streamed step in the pre-push fast gate, gated on changed rules files:

```bash
# Run STREAMED (not via run(), which is quiet on success) — the sub-cap advisory is the
# whole point and only matters if a human reads it. Over-cap stays fatal.
RULES_CHANGED=()
while IFS= read -r f; do [ -n "$f" ] && RULES_CHANGED+=("$f"); done \
  < <(git diff --name-only --diff-filter=ACMRT "${DIFF_BASE_ARGS[@]}" -- 'docs/rules/*.md' 2>/dev/null)
if [ "${#RULES_CHANGED[@]}" -gt 0 ]; then
  node scripts/check-rules-file-size.js "${RULES_CHANGED[@]}" || exit 1
fi
```

## Examples

Keep the exit code governed **solely** by the hard failures, and make the misconfiguration loud:

```js
const MAX_BYTES = 6500;
const WARN_BYTES = 5700;

// An inverted pair makes the advisory branch unreachable dead code — every value big
// enough to enter it already failed the cap check — and nothing else would notice.
if (WARN_BYTES >= MAX_BYTES) {
  throw new Error("advisory window is empty");
}

if (bytes > cap) {
  failures++;            // only this gates process.exit
  ...
} else if (bytes > WARN_BYTES) {
  advisories++;          // reported, never fatal
  ...
}
```

Pin both constraints in tests — these are the two that matter:

```ts
it("ADVISES between the warn threshold and the cap — and must still exit 0", ...);
it("an advisory on one file does not mask a hard failure on another", ...);
```

Make the message say what to do *in this codebase*, and carry the caveat. The first draft told the
reader to "move rationale into a `docs/solutions/` file the bullet cites" — but the two files it
fired on already cite a solution on nearly every bullet, so the advice was already-done, and it
omitted the harder-won caveat that relocating a load-bearing detail into a citation is a
[reachability downgrade](rules-files-stay-terse-for-inline-injection-budget-2026-06-05.md).

## Exceptions

- If the warning genuinely must block (a security control, a data-loss risk), it is not an advisory
  tier — make it a hard failure with a clear message and skip this pattern entirely.
- A grandfathered/per-item cap must stay **≥** the warn threshold, or that item loses its advisory
  window and jumps from silent-pass straight to hard-fail.

## Related Files

- `scripts/check-rules-file-size.js` — the two-tier implementation and the inversion guard
- `scripts/preflight.sh` — the streamed fast-gate step that makes the advisory visible
- `scripts/__tests__/check-rules-file-size.test.ts` — exit-0 and no-masking tests

## See Also

- [docs/rules/*.md must stay terse](rules-files-stay-terse-for-inline-injection-budget-2026-06-05.md) — the invariant this gate protects, and why the files regrow
- [A verification that scans zero inputs is green and meaningless](../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md) — how the tests for this change first passed without testing anything
