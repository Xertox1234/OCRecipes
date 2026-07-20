---
title: "A command-safety gate that models a repeatable tool option as 0-or-1 is bypassable — mirror the tool's real cumulative resolution AND anchor extraction to the subcommand boundary"
track: bug
category: logic-errors
tags: [bash, hooks, awk, safety-gate, false-negative, git, command-matcher, tokenizer, security]
module: shared
applies_to: [".claude/hooks/**/*.sh", "scripts/**/*.sh"]
symptoms: ["A command-safety gate ALLOWS a command whose EFFECTIVE target is dangerous because a repeated/chained option (git -C a -C b) is modeled as 0-or-1", "The gate's regex forces a fixed option order the real tool does not require (-C before -c), so a legal reordering slips the gate", "An option that belongs to the SUBCOMMAND (git commit -C HEAD) is mined as if it were the global option of the same name", "Relaxing the matcher regex alone makes the gate WORSE because the extractor still resolves only the first occurrence", "A tool resolves two related targets independently (git-dir vs work-tree) and the gate validates only one, so redirecting the checked target to a safe place masks a mutation of the unchecked one", "A safety gate is declared safe on the strength of an old-vs-new differential, which is blind to a new bug that is ALLOW-then-ALLOW"]
created: 2026-07-20
last_updated: 2026-07-20
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

## Extension (2026-07-20): the same gate, more redirect vectors, and the two-target lesson

Closing the chained-`-C` cardinality bug (above) was step one. Extending the SAME gate to the rest of
git's repo-redirect grammar surfaced a deeper, recurring shape — two review rounds each found a CRITICAL
that was the *mirror* of the bug just fixed.

**1. One family, many vectors.** `-C` is only one of several ways git redirects which repo a command
targets: `--git-dir`/`GIT_DIR` (the git-dir), `--work-tree`/`GIT_WORK_TREE` (the work-tree), and the `-C`
chdir. A gate that models one vector leaks the others. Enumerate the whole family from the tool's own
usage/grammar, and recognize each in BOTH the matcher (so the regex reaches the verb) and the extractor
(so the target is resolved) — a matcher change without the paired extractor change is false coverage.

**2. Two targets, resolved INDEPENDENTLY — validate both.** git resolves the **git-dir** (refs/objects)
and the **work-tree** (working files) independently:
- git-dir = `--git-dir`/`GIT_DIR`, else the `-C` fold, else cwd.
- work-tree = `--work-tree`/`GIT_WORK_TREE`, else the `-C` fold, else cwd.

A redirect of ONE does not move the OTHER. So `git --git-dir=<safe-worktree>/.git reset --hard` from a
main cwd still destroys MAIN's files (work-tree defaults to cwd=main) even though the git-dir is safe —
and the symmetric `GIT_WORK_TREE=<safe-worktree> git commit` from a main cwd writes MAIN's refs (git-dir
defaults to cwd=main). The gate must reconstruct BOTH targets and DENY if EITHER is dangerous; emitting a
single "effective repo" with any precedence is structurally unable to express this. (Implementation:
`git_c_target` emits the raw redirect COMPONENTS — `g`/`c`/`w` — and the caller reconstructs both targets.)

**3. The recurring mirror.** Each fix opened the mirror on the other vector: fixing "work-tree as a
replacement for the git-dir target" (round 1) still left "an explicit git-dir suppresses the work-tree/cwd
check" (round 2). When you close a redirect on target A, immediately ask whether the same class is now
open on target B.

**4. A differential proves NON-REGRESSION, not NO-BYPASS.** The old-vs-new differential (assert no
old-DENY→new-ALLOW) is a strong *strict-superset* check, but it is BLIND to a new bug that is ALLOW→ALLOW
— exactly what the taint-gated decoy-skip bug was (both old and new ALLOWed `git --no-adv'i'ce -C <main>
commit`). Do not cite the differential as proof the gate is safe. The real safety argument is: adversarial
review found the holes, and positive tests assert that inputs *empirically confirmed to mutate main* now
DENY — run the tool in a scratch repo, watch it destroy a marker file, then assert the gate blocks that
exact command.

**5. Crude-but-total beats clever-partial (again).** `commit` is the one mutating verb that does not write
the work-tree, so a verb-aware gate could ALLOW `--git-dir=<worktree> commit` from main. The conservative
choice — validate BOTH targets for EVERY verb — over-DENYs that one exotic safe pattern but has no
verb-classing special case to get wrong, and makes the whole change a provable strict superset (zero
DENY→ALLOW over 600+ differential cases). On a safety gate, prefer the total check —
[[partial-parse-regresses-crude-total-safety-scanner]].

Also verify what is NOT a vector: `-c core.worktree=<path>` / `-c core.bare` on the command line are
IGNORED by git (confirmed by scratch probe), so the gate correctly skipping `-c` values is safe.

## Related Files

- `.claude/hooks/git-safety.sh` — `MUTATING_GIT_SEG_RE` (the broadened `(-C…|-c…|--git-dir…|--work-tree…|-…)*` grammar), `git_c_target` (emits `g`/`c`/`w` redirect components), and the caller loop that reconstructs the two independent git-dir/work-tree targets and validates both.
- `.claude/hooks/test-git-safety.sh` — the chained/interleaved `-C` truth table, the stop-at-verb invariant guards, and the glued/empty-`-C` residual pins.
- `todos/archive/P3-2026-07-20-git-safety-unmodeled-global-options-repo-redirect.md` — the (now closed) todo this extension resolved: `--git-dir`/`--work-tree`/`GIT_DIR`/`GIT_WORK_TREE` redirects + the unmodeled-global-before-`-C` gap.

## See Also

- [partial-parse-regresses-crude-total-safety-scanner](partial-parse-regresses-crude-total-safety-scanner-2026-07-19.md) — the sibling "half-fix on a gate regresses where the model has a hole" lesson on the same hook.
- [quote-strip-escape-glue-hides-real-command](quote-strip-escape-glue-hides-real-command-2026-07-18.md) — same command-matcher family: tokenize when the extracted value can itself be quoted; a context-free regex cannot express context-sensitive shell grammar.
