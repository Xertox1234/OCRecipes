---
title: "A warn()/deny() helper with an embedded exit makes fall-through reasoning from case/if shape alone unsound"
track: knowledge
category: conventions
tags: [bash, hooks, safety-gate, control-flow, exit, warn, deny, code-review, mutation-testing]
module: shared
applies_to: [".claude/hooks/**/*.sh"]
created: 2026-07-26
---

# A warn()/deny() helper with an embedded exit makes fall-through reasoning from case/if shape alone unsound

## Rule

Before claiming a `case`/`if` branch in a hook "falls through" to the code after it, check
whether the helper it calls (`warn`, `deny`, or similar) itself contains an `exit`. If it
does, a branch that calls that helper terminates the script there — it cannot fall through,
no matter how the surrounding `case`/`if` is shaped. Reasoning about control flow from the
visible `case`/`if` structure alone, without opening the helper definition, is unsound.

## When this applies

Any bash hook (`.claude/hooks/*.sh`) that defines a `warn()` or `deny()` helper as a
one-line-body-plus-`exit` convenience — the common pattern in this project's PreToolUse
hooks, e.g.:

```sh
warn() {
  jq -n --arg c "$1" '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":$c}}'
  exit 0
}
```

A reader who sees `case "$REF" in -*) warn "…skipped…" ;; esac` followed by more code after
`esac` will naturally assume that code still runs for the `-*` branch — `case`/`esac` does
not exit by itself, so the assumption feels safe. It is wrong exactly because `warn` was
defined to exit.

## Why

In `.claude/hooks/git-safety.sh`'s delete-branch advisor, a todo's Background section
asserted: "the existing flag-like guard … warns 'Fresh PR check skipped' and then falls
through to run `gh pr view` anyway, so that message is false whenever it fires." This claim
was repeated and reinforced across two independent reviews — the todo's own creation, and a
later code review of PR #721 that says it "verified" the fall-through against the exact line
numbers. Both readings inspected the `case … esac` / `if … fi` shape and concluded fall-through
without checking that `warn()` itself ends in `exit 0`.

It does. A direct empirical test — invoke the hook with a flag-like ref and a fake `gh` that
would print a second, contradictory message if reached — showed only ONE message, proving the
branch already terminated. A later mutation check (revert the fix under test, keep the new
regression test, confirm it goes RED) caught the discrepancy: the "flag-like" test stayed
GREEN even against the reverted code, because there was nothing to break — that sub-case was
never actually broken.

**The generalizable trap:** a helper function that "returns" via a side effect (`exit`,
`return` from a different stack frame, a `trap`-installed handler) breaks the usual heuristic
of reading control flow top-to-bottom from the call site. The call site looks like an
ordinary statement; the exit lives one level of indirection away, in the callee's body.

## Examples

Wrong (assumed from the call site alone):

```sh
case "$REF" in -*)
  warn "⚠ Fresh PR check skipped: …" ;;
esac
if PR_JSON=$(gh pr view "$REF" …); then   # "this still runs even for -* refs"
  ...
```

Correct (verified against the callee):

```sh
warn() { jq -n …; exit 0; }   # <-- check this before reasoning about callers
```

Given that, the snippet above is already correct as written — the `-*` branch does NOT fall
through. No code change was needed for that specific sub-case; only the documentation
(a todo's Background section, and a prior review's sign-off) needed correcting.

## Exceptions

- If the helper is a `return`-only function (no `exit`), the usual fall-through reasoning
  applies normally — this rule is specific to `exit`-embedded helpers.
- A helper that exits *conditionally* (only on some internal branch) still needs the same
  check, but the safe assumption flips: do not assume it always terminates either — read
  the callee fully.

## Related Files

- `.claude/hooks/git-safety.sh` — the `warn()`/`deny()` helper definitions near the top of
  the file, both exit-embedded; the delete-advisor's flag-like `case "$REF" in -*)` branch
  (ADVISOR section, `KIND = "delete"` block) that this rule was extracted from
- `todos/archive/P3-2026-07-25-git-safety-delete-advisor-quoted-ref.md` — the todo whose
  Background section carried the incorrect fall-through claim, corrected in its Updates
  section rather than silently rewritten

## See Also

- [gate-test-needs-two-sided-negative-control](gate-test-needs-two-sided-negative-control-2026-07-25.md) — the mutation check that surfaced this: a test that stays green against reverted code is proof the code path was never broken, not proof the test is wrong
- [spec-acceptance-criteria-from-source-not-symptom](spec-acceptance-criteria-from-source-not-symptom-2026-07-26.md) — the sibling lesson from the same PR #721 incident, one layer up: the spec's own diagnosis (not just a later review's) misread this control flow
- [quote-strip-escape-glue-hides-real-command](../logic-errors/quote-strip-escape-glue-hides-real-command-2026-07-18.md) — the actual bug fixed alongside this documentation correction, in the same file
