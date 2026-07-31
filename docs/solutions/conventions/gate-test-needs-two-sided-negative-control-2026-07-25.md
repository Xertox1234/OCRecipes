---
title: "A gate test must be two-sided: without a negative control, green cannot be distinguished from 'the payload never triggers the gate'"
track: knowledge
category: conventions
tags: [testing, hooks, safety-gate, negative-control, mutation-testing, bash, json, settings-json, security]
module: shared
applies_to: [".claude/hooks/test-*.sh", "scripts/**/*.sh"]
symptoms: ["A test asserts only that the fixed form passes, never that the broken form fails", "A guard test would still pass if the guard were deleted", "A config-string assertion greps raw file bytes but the value it expects is the JSON-decoded form (or vice versa)"]
created: 2026-07-25
last_updated: 2026-07-31
---

# A gate test must be two-sided: without a negative control, green cannot be distinguished from "the payload never triggers the gate"

## Rule

When testing that a **security gate fires**, assert both directions in the same test:

1. **Negative control** — the broken/old form must NOT fire.
2. **Positive** — the fixed/registered form MUST fire, asserted on the specific **reason**,
   not merely on "something denied."

A one-sided test that only checks the positive case cannot tell "the guard works" apart
from "my fixture never triggers a deny anywhere." Both produce a green run.

## Smell patterns

- The test would still pass if you deleted the guard's logic.
- The only assertion is `expected: pass` — nothing in the file establishes what failure
  looks like.
- The positive assertion matches a generic marker (`"permissionDecision": "deny"`) that
  several unrelated code paths in the guard also emit.

## Why

Fixing a gate's *reachability* is exactly when a one-sided test is most tempting and least
informative. In the incident behind this rule, hooks had been registered by a cwd-relative
path and were silently skipped from any subdirectory
([relative-locator-silently-disarms-non-blocking-hook](../logic-errors/relative-locator-silently-disarms-non-blocking-hook-2026-07-25.md)).
The obvious test — "run the fixed registration from a subdirectory, assert DENY" — proves
nothing on its own: if the fixture were malformed and could never provoke a deny, it would
report the same green.

Adding the negative control makes the test **self-validating**: it passes only when the
old form demonstrably fails from that same directory, which is the proof that the test
reproduces the original bug at all.

Assert the **reason** for the same reason. A guard usually has several deny branches
(here: "unresolvable repository" vs "outside every registered worktree"). Matching only
`"permissionDecision": "deny"` lets the test silently start passing via a branch that has
nothing to do with what it claims to cover.

**Mutation-check the guard test.** Reintroduce each bug class the test claims to catch and
confirm it goes red. A guard test that cannot fail is decoration. When the check is a
static scan of a config file, judge the value **generically** rather than pre-filtering on
the shape you happen to have today — a check written as "flag relative paths under
`.claude/hooks/`" silently blesses `bash scripts/foo.sh`, which has the identical defect.

## Examples

Two-sided, with a reason assertion (`.claude/hooks/test-settings-hook-paths.sh`):

```bash
# Negative control — the OLD relative form. Must NOT deny: bash cannot find the script.
# If this ever starts denying, the test has stopped reproducing the bug and the
# positive case below is meaningless.
OUT_REL=$( printf '%s' "$PAYLOAD" | ( cd "$SUBDIR" && bash ".claude/hooks/$GUARD" ) 2>&1 )
printf '%s' "$OUT_REL" | grep -q '"permissionDecision": "deny"' && fail

# Positive — the ACTUAL registered string, so the test tracks the real registration
# rather than a hand-copied duplicate that could drift from it.
OUT_ABS=$( printf '%s' "$PAYLOAD" | (
    cd "$SUBDIR"; export CLAUDE_PROJECT_DIR="$ROOT"; eval "$GS_CMD"
  ) 2>&1 )
printf '%s' "$OUT_ABS" | grep -q '"permissionDecision": "deny"' \
  && printf '%s' "$OUT_ABS" | grep -qF 'outside every registered worktree'   # pin the BRANCH
```

**Match the right layer when asserting on a config string.** `jq` returns the *decoded*
value; `grep` over the file sees the *raw* bytes. The same registration is:

| Layer | What you must match |
| --- | --- |
| `jq -r '.command'` | `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/x.sh" register` |
| `grep` on the file | `bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/x.sh\" register` |

A raw-bytes grep written against the decoded form fails confusingly. When grepping raw
JSON, span the escape with a character class instead of hard-coding a depth:

```bash
grep -qE "session-coord-hook\.sh[^ ]* register"   # not `\.sh register`, not `\.sh\" register`
```

### The source-scan variant: `toEqual([])` hides "the scan found nothing to search" (added 2026-07-31)

A guard that walks the source tree and asserts `expect(offenders).toEqual([])` is the same
one-sided shape wearing different clothes. It passes when the tree is clean **and** when the
scan searched nothing at all. A synthetic-repo check confirmed all of these produce an
identical observable — exit 1, empty stdout, no error:

| Cause | Looks like |
| --- | --- |
| The tree really is clean | `[]` ✅ |
| The matcher is broken (e.g. `-E` with `\b`, see the facade doc) | `[]` ❌ |
| A pathspec typo — `-- serverXYZ/` matches no path | `[]` ❌ |
| `execSync` cwd diverged from the repo root | `[]` ❌ |
| The offending file is untracked, so `git grep` cannot see it | `[]` ❌ |

Two additions make it self-validating, and they are different checks — you want both:

```ts
// 1. Non-vacuity: the scan found files to search at all.
expect(serverSourceFiles().length).toBeGreaterThan(0);

// 2. Positive control: the SAME matcher, run against a file known to contain a real
//    declaration. Not a hand-written fixture — a real file, so it cannot drift.
expect(offendersIn(["shared/constants/nutrition-bands.ts"]))
  .toEqual(["shared/constants/nutrition-bands.ts"]);
```

Factor the matcher into one `offendersIn(paths)` helper so the control exercises **identical**
logic. A positive control that runs a re-typed copy of the regex proves the copy works, not
the guard.

Note the direction of the trade this replaces: a guard written as "expect exactly these
allowed files" *is* self-proving (an empty result fails), but it fails confusingly whenever
anyone adds a comment mentioning the symbol. Prefer the declaration-scoped matcher plus an
explicit control over an allowlist of mention-permitted files.

**Beware of regressing this while fixing something else.** In the incident, the guard began
with a self-proving positive expectation; a later commit fixed an unrelated self-match bug and
switched the assertion to `toEqual([])` in the same edit, silently trading the non-vacuity
property away. When you change what a gate asserts, ask what property the old assertion was
carrying for free.

## Exceptions

- A **static** assertion (e.g. "no registration is cwd-relative") needs no negative
  control — it is already a direct predicate over the config. Mutation-check it instead.
- Pure unit tests of a pure function do not need this; the rule is specifically about
  tests whose subject is *whether an enforcement mechanism engages*.

## Related Files

- `.claude/hooks/test-settings-hook-paths.sh` — two-sided gate test
- `.claude/hooks/test-git-safety.sh` — registry fixture + `assert_deny`/`assert_allow` pairs
- `scripts/run-hook-tests.sh` — glob auto-discovery, fail-on-zero guard

## See Also

- [relative-locator-silently-disarms-non-blocking-hook](../logic-errors/relative-locator-silently-disarms-non-blocking-hook-2026-07-25.md) — the bug this rule was extracted from
- [glob-runner-loop-fails-open-count-and-fail-on-zero](../logic-errors/glob-runner-loop-fails-open-count-and-fail-on-zero-2026-07-03.md) — the sibling "a suite that runs nothing reports green" failure
- [chmod-000-regression-test-os-may-already-block-guarded-behavior](chmod-000-regression-test-os-may-already-block-guarded-behavior-2026-07-19.md) — confirming a new regression case actually goes RED
