---
title: "A text-deletion neutralization pass for a shell substitution must prove the construct can evaluate to empty before deleting it"
track: bug
category: logic-errors
tags: [harness, security, shell-quoting, false-negative, regex, mutation-testing]
module: server
applies_to: [".claude/hooks/lib/cmd-detect.sh"]
symptoms: ["A word-boundary anchor correctly rejects a bare glued decoy (`x}checkout`) but, as a side effect, also rejects a genuinely LIVE construct that glues the same way (`${x}checkout`, a parameter expansion collapsing to empty)", "A `sed` pass added to 'neutralize' (delete) a shell substitution span before a boundary check makes a PREVIOUSLY-REJECTED decoy segment pass the check again, because the deleted span's closing character is now adjacent to the matched word with nothing between them", "The deleted construct could never actually evaluate to empty in real bash (e.g. `${#x}` — length expansion always yields a non-empty digit string), so the 'neutralization' manufactures a clean match for text that never executes anything", "A single-pass, non-recursive `sed -E` substitution intended to strip `${...}` leaves a dangling unmatched brace when the span is NESTED (`${a:-${b}}`), because the inner `${b}` is stripped first and the outer `${...}}` is never re-scanned"]
created: 2026-09-02
severity: high
---

# A text-deletion neutralization pass for a shell substitution must prove the construct can evaluate to empty before deleting it

## Problem

`cmd_git_branch_create_segment` (`.claude/hooks/lib/cmd-detect.sh`) extracts the `checkout`/
`switch` segment that carries a real branch-create flag from a compound bash command, feeding
`branch-preflight.sh`'s stale-upstream check. A word-boundary whitelist was added to its
extraction `grep` to stop a decoy word (`gcheckout`) from being mistaken for a real `checkout`
invocation. Closing that gap meant excluding a bare `}` from the boundary whitelist (glued, `}`
never separates a real word — `x}checkout` is one literal token in bash). But `}` also closes a
`${...}` parameter expansion, and unlike a bare glued `}`, a substitution/expansion's result
becomes part of the *same* word with no separator required: `${x}checkout` (with `x` unset or
empty) really does invoke `checkout`. Excluding bare `}` from the whitelist therefore also made
this genuinely live create invisible — a regression found by review the same day the fix landed.

The follow-up fix added a `sed` pass to delete `${...}` spans before the boundary `grep` ran,
mirroring how the function already deletes redirects. This is where the real lesson is: the pass
deleted **any** `${...}` unconditionally, on the unstated assumption that any parameter expansion
might resolve to empty. That assumption is false for several common forms, and being wrong in
that direction is dangerous, not merely incomplete — it manufactures a false, clean boundary
match for text that can never actually execute what the matcher now believes it does.

## Symptoms

- `${x}checkout` (bare, `x` unset/empty) — **correctly** collapses to a live `checkout`
  invocation; excluding `}` from the whitelist alone misses it (the motivating regression).
- `${a:-${b}}checkout` (nested expansion, confirmed live: `bash -c 'checkout(){ :; }; a=; b=;
  ${a:-${b}}checkout -b real'` really invokes `checkout`) — the deletion pass is a single,
  non-recursive `s/\$\{[^};&|)\`]*\}//g`. It strips the *inner* `${b}` first, leaving a dangling
  `}` from the outer expansion immediately before `checkout` — a boundary character the whitelist
  (correctly) does not include — so the real create is **missed entirely**, at every stage of the
  file that reads this text.
- `${#x}checkout` — length expansion. `${#x}` **always** yields a non-empty digit string in real
  bash (`bash -c 'checkout(){ :; }; x=; ${#x}checkout -b fake'` → `bash: 0checkout: command not
  found` — never live). The unconditional deletion pass strips `${#x}` anyway, producing a clean,
  falsely-boundary-anchored `checkout -b fake ...` segment. In a compound command carrying this
  decoy AND a real, later, start-point-less create (`git checkout main; git ${#x}checkout -b
  fake origin/other ; git checkout -b real`), the extraction returns the **decoy's** segment —
  traced end-to-end through `branch-preflight.sh`'s own arg-walk, this computes
  `HAS_START_POINT=1` for a create that has none, silently skipping the very check this whole
  function exists to protect. This is the *same class* of bug the boundary-whitelist fix was
  written to close, reintroduced by the mechanism meant to patch a different instance of it.

## Root Cause

A `sed`-based "neutralize this construct so it doesn't interfere with a downstream boundary
check" pass (the same pattern already used elsewhere in this file for redirects and comments) was
applied to `${...}` on the implicit belief that all `${...}` forms are structurally the same:
"might expand to empty, so remove it and let whatever's around it be re-evaluated as adjacent
text." Two properties of real bash parameter expansion break that belief:

1. **Not every expansion operator can produce an empty result.** `${name}` and `${name:-default}`
   can (an unset/empty variable, or a default that is itself empty). `${#name}` (length) cannot —
   it is always a decimal digit string, minimum length 1 (`"0"` for an empty variable). A
   deletion pass that does not distinguish these treats "opens with `${`" as sufficient grounds to
   delete, when the real test is "can this specific operator ever yield zero characters."
2. **`${...}` nests**, and a single ERE substitution is not recursive. `[^}]*`-shaped content
   classes (even narrowed, as here, to exclude segment-delimiter characters) stop at the *first*
   `}`, so a nested span leaves an unmatched outer `}` that the pass never revisits.

Both properties were knowable by reasoning about bash's expansion grammar, but the pass was
written and shipped without checking either — the same failure mode the file's own established
convention (`_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX`'s character-class history, see the sibling
solution below) already names for *character classes*: audit against the full real grammar, not
the specific shape a symptom happened to arrive in.

## Solution

The pass was **reverted entirely**, not repaired. Given the choice between (a) missing a real
create that relies on an exotic, unlikely-by-accident glue mechanism — the safe-fail direction
this specific check already accepts in several other documented ways (it fails open on
`SKIP_BRANCH_PREFLIGHT=1`, on no-upstream, on fetch failure; it "only ever prevents redundant
work, never data loss") — and (b) a neutralization pass sophisticated enough to be provably
correct (balanced-brace matching plus an explicit allow-list of which expansion operators can
truly be empty), which is a materially larger change than the character-class fix this task's
scope allowed, (a) was kept and (b) was abandoned. `${...}`-glued creates (bare or nested) are
now a documented residual: missed, never falsely matched.

If a future task needs to close that residual, the pass must, at minimum:
- Recurse (or loop the substitution to a fixed point) so a nested `${...}` is fully unwound, not
  just its innermost span.
- Restrict deletion to expansion forms provably capable of yielding empty (`${name}`,
  `${name:-...}`, `${name:+...}`, `${!name}`) via an explicit allow-list on the operator, rather
  than a catch-all `${...}` pattern — and treat every other operator (`${#name}` foremost) as
  ineligible for deletion.

## Prevention

Before writing a pass that DELETES a construct to keep it from interfering with a downstream
matcher, ask two questions the construct's real grammar must answer, not assume:

1. **Can this construct ever be empty?** If some forms can and others structurally cannot
   (length/count/arithmetic-shaped operators are a common "always non-empty" family across
   shells), the pass needs a per-form allow-list, not a blanket pattern keyed on the opening
   delimiter alone.
2. **Can this construct nest, and does my pattern handle that?** A `[^closer]*`-shaped content
   class is inherently non-recursive; if the real grammar allows the same delimiter pair inside
   itself, a single substitution pass is provably insufficient and either needs a loop-to-fixed-
   point or must be scoped narrower than "the whole construct."

When neither can be answered with a provably correct, narrowly-scoped fix inside the task's
budget, prefer reverting to the simpler, already-verified-safe state and documenting the gap as a
residual over shipping a heuristic that trades a safe miss for an unsafe false match — especially
when, as here, the consumer is a security-relevant guard whose whole point is to stop a false
match from shadowing a real one. Mutation-test both directions before trusting either: a scratch
copy WITH the pass reverted must turn the `${#x}`-shadowing regression pin green, and a scratch
copy with the pass RE-ADDED must turn it red, or the pin isn't actually anchored to the mechanism
it claims to guard.

## Related Files

- `.claude/hooks/lib/cmd-detect.sh` — `cmd_git_branch_create_segment`, the reverted pass and its
  KNOWN RESIDUALS comment (items 3-4 at the function's definition).
- `.claude/hooks/test-cmd-detect.sh` — the round-3 regression-guard pins (`${#x}checkout`,
  `${a:-${b}}checkout`) that lock in the safe-miss behavior and would catch a naive re-attempt.
- `.claude/hooks/branch-preflight.sh` — the sole consumer whose `HAS_START_POINT` computation was
  traced end-to-end to confirm the false-decoy shadowing was live, not merely a wrong return value.

## See Also

- [cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md](cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md) — the sibling lesson for CHARACTER CLASSES on the same file: audit against the full real grammar, not the symptom's specific shape. This entry is the same discipline applied to a DELETION pass instead of a boundary class.
- [../conventions/one-axis-at-a-time-corpus-misses-co-occurrence-checks-2026-09-01.md](../conventions/one-axis-at-a-time-corpus-misses-co-occurrence-checks-2026-09-01.md) — mutation-testing a guard by deleting it is how this defect's own regression pins were verified load-bearing.
