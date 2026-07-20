---
title: "A command-safety gate that models a repeatable tool option as 0-or-1 is bypassable — mirror the tool's real cumulative resolution AND anchor extraction to the subcommand boundary"
track: bug
category: logic-errors
tags: [bash, hooks, awk, safety-gate, false-negative, git, command-matcher, tokenizer, security]
module: shared
applies_to: [".claude/hooks/**/*.sh", "scripts/**/*.sh"]
symptoms: ["A command-safety gate ALLOWS a command whose EFFECTIVE target is dangerous because a repeated/chained option (git -C a -C b) is modeled as 0-or-1", "The gate's regex forces a fixed option order the real tool does not require (-C before -c), so a legal reordering slips the gate", "An option that belongs to the SUBCOMMAND (git commit -C HEAD) is mined as if it were the global option of the same name", "Relaxing the matcher regex alone makes the gate WORSE because the extractor still resolves only the first occurrence"]
created: 2026-07-20
severity: medium
---

# A command-safety gate that models a repeatable tool option as 0-or-1 is bypassable — mirror the tool's real cumulative resolution AND anchor extraction to the subcommand boundary

## Problem

`git-safety.sh`'s worktree-contract gate decides whether a mutating `git` command
targets the main checkout by extracting its effective repository from `git -C <path>`.
The matcher regex modeled the global `-C` as **0-or-1** (`(-C…)?`) and the extractor
(`git_c_target`) emitted only the **first** `-C`. But real git honors **cumulative**
`-C` — `git -C /tmp -C <main> commit` runs in `<main>` (last absolute wins) — so a
chained `-C` either failed the regex entirely (skipped → ALLOW) or resolved to the
wrong (first, often allowlisted) target. The regex also forced `-C` **before** `-c`,
so a legal `git -c x=y -C <main> commit` reordering slipped the gate. All were
pre-existing **false-negatives**: a real main-checkout mutation laundered past the gate.

## Symptoms

- `git -C /tmp -C <main> commit` (cwd = a registered worktree) → **ALLOW**, should DENY.
- `git -c core.pager=x -C <main> commit` → **ALLOW** (regex rejected `-c`-before-`-C`).
- Relaxing only the regex (`?`→`*`) makes it WORSE: the matcher now enters the loop but
  the extractor still emits the first `-C` (`/tmp`, allowlisted) → still ALLOW, now with
  a false sense of coverage.

## Root Cause

Two independent under-models of the tool's real option grammar, coupled through one gate:

1. **Cardinality/precedence.** A repeatable option modeled as at-most-one, with a fixed
   order the tool does not impose. The matcher and the extractor disagreed with the
   tool about which occurrence "wins."
2. **Scope boundary.** The option namespace **changes at the subcommand verb**. `-C` before
   the verb is git's *global* "change directory"; `-C` *after* the verb (`git commit -C HEAD`)
   is `commit`'s own "reuse message" flag. An extractor that keeps scanning past the verb
   would mine `HEAD` as a directory and flip a correct verdict.

Because the matcher (does this command qualify?) and the extractor (what is its effective
target?) are separate, fixing one without the other is a partial fix that regresses or
gives false confidence — the same "half-fix on a gate" trap as
[[partial-parse-regresses-crude-total-safety-scanner]].

## Solution

Change the matcher and the extractor **together**, and validate against the real tool:

- **Matcher:** model the option as it really is — `(-C…|-c…)*` (≥1, any order). This is a
  strict **superset** of the old grammar, so it can only *add* DENYs (never silently drop a
  previously-caught command). The superset property is the safety argument, not "tests pass."
- **Extractor:** fold **every** occurrence with the tool's real precedence
  (git `-C`: cumulative, last-absolute-wins, relatives append — it mirrors `chdir`), and
  **stop at the verb** so a subcommand's own same-named option is never mined:

  ```awk
  # phase 1: scan git global options, folding EVERY -C until the first non-option word (the verb)
  if (pend == "C") { fold(w); pend = ""; return }   # -C arg (value may be quoted): accumulate
  if (pend == "c") { pend = ""; return }            # -c value: skip
  if (!tnt && w == "-C") { pend = "C"; return }
  if (!tnt && w == "-c") { pend = "c"; return }
  if (gotc) print eff                               # first non-option word = the verb: emit & STOP
  done = 1                                          # (git commit -C HEAD: the subcommand's -C is never mined)
  ```

- **Empty option value is a tool no-op** — `git -C ""` runs in cwd — so the fold skips an
  empty target (no cumulative effect, no stray trailing slash on the emitted path).

## Prevention

- **Verify the option model against the real tool, not intuition.** A five-line scratch
  probe settled every question here: `git -C /a -C /b` → `/b`; `git -C /a -C rel` → `/a/rel`;
  glued `-C/path` and `-c name=value` are **rejected** (`unknown option`, EXIT 129) — so those
  glued forms are non-bypasses, not residuals. Run the tool; do not guess its grammar.
- **When you harden a matcher, ask what its paired extractor now gets wrong.** A more-permissive
  matcher that feeds a still-narrow extractor is a false sense of coverage.
- **Prove direction, not just green tests.** On a gate, the discriminating check is a
  differential over the old and new artifact: every transition must be `ALLOW→DENY`, never
  the reverse. The pre-fix red test (the bypass reproduced against the live gate) is the
  proof the hole was real; the old-vs-new differential is the proof nothing regressed.
- **Enumerate what stays open.** Options the gate still does not model (`--git-dir`,
  `--work-tree`, an unmodeled global before the `-C` that stops the regex reaching the verb)
  are the same "a global redirects/hides the repo" family — document them as accepted
  residuals with the escape hatch named, and track a follow-up rather than pretend "complete."

## Related Files

- `.claude/hooks/git-safety.sh` — `MUTATING_GIT_SEG_RE` (the `(-C…|-c…)*` grammar) and `git_c_target` (the cumulative fold + stop-at-verb).
- `.claude/hooks/test-git-safety.sh` — the chained/interleaved `-C` truth table, the stop-at-verb invariant guards, and the glued/empty-`-C` residual pins.
- `todos/P3-2026-07-20-git-safety-unmodeled-global-options-repo-redirect.md` — the tracked follow-up for `--git-dir`/`--work-tree` and the unmodeled-global-before-`-C` residual.

## See Also

- [partial-parse-regresses-crude-total-safety-scanner](partial-parse-regresses-crude-total-safety-scanner-2026-07-19.md) — the sibling "half-fix on a gate regresses where the model has a hole" lesson on the same hook.
- [quote-strip-escape-glue-hides-real-command](quote-strip-escape-glue-hides-real-command-2026-07-18.md) — same command-matcher family: tokenize when the extracted value can itself be quoted; a context-free regex cannot express context-sensitive shell grammar.
