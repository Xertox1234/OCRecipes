---
title: A corpus that varies one axis at a time cannot exercise a check that only fires when two things co-occur
track: knowledge
category: conventions
module: shared
tags: [harness, testing, agents, code-review, corpus, mutation-testing, differential]
applies_to: [.claude/hooks/*.sh, .claude/hooks/lib/*.sh, scripts/*.sh]
created: '2026-09-01'
---

# A corpus that varies one axis at a time cannot exercise a check that only fires when two things co-occur

## Rule

Generating a test corpus from dimensions is necessary but not sufficient. A cross product
of `{A1..An} × {B1..Bm}` still picks **one value per axis**, so it can never produce an
input carrying *two different values of the same axis at once*. Any guard whose whole
purpose is to reject that shape is invisible to it — and, worse, will look covered,
because every single-value case reaches the same verdict for an unrelated reason.

Two ways to close it, and you want both:

1. Add **co-occurrence** as its own dimension: for an axis whose values can legally repeat
   in one input (globals, flags, clauses, redirects), include pairs — at minimum one
   `good + bad` pair and one `bad + bad` pair.
2. **Mutation-test the check itself.** Delete the guard, run the suite. If it stays green,
   the corpus does not reach it, whatever its size.

## When this applies

Any corpus generated over a grammar where a construct can appear more than once in a
single input: shell globals, CLI flags, query params, header lists, clauses in a compound
command, repeated form fields.

## Smell patterns

- A generator shaped `for a in "${AS[@]}"; do for b in "${BS[@]}"; do emit "$a $b"` where
  `AS` are alternatives *of the same kind* rather than genuinely independent axes.
- A guard phrased as "reject when these two disagree" (count-vs-count, first-vs-last,
  any-vs-all) with no test naming both operands.
- A large corpus reported by its size ("2189 inputs, 0 regressions") with no statement of
  which code paths it reached.

## Why

Closing the `git -C <path>` blindness in `.claude/hooks/lib/cmd-detect.sh` needed a
resolver that answers "which repository does this command act on". It carries two guards
that only ever matter for co-occurrence:

| Guard | Only changes the answer when… |
| --- | --- |
| per-span `ntok != nval` (every redirecting token must be a clean `-C <value>`) | one span holds a **resolvable `-C` and an unresolvable redirect**, e.g. `git -C /tmp --git-dir=/x commit` |
| the `unresolved` flag (an unresolvable span poisons the whole answer) | **one span is unresolvable and another resolves**, e.g. `git -C /tmp --git-dir=/x commit; git -C /tmp commit` |

The corpus was generated from four dimensions — 11 globals × 4 redirect positions × 5 verbs
× 3 compound tails, 660 commands, replayed through the pre- and post-change hook for 1320
paired runs. It varied **one global at a time**, so it produced neither shape. Both guards
were deleted in mutation testing and the whole suite stayed green:

- Deleting `ntok != nval` changed nothing, because a single unresolvable redirect yields
  *no* extracted value, and zero values is already a skip. Same verdict, different reason —
  the tell that the assertion is passing for free.
- Deleting the `unresolved` flag changed nothing for the same reason, one level up.

Left in, both guards are load-bearing: without them the resolver hands back `/tmp` while
git actually reads its refs from `--git-dir=/x`, and a gate then judges the wrong
repository. The corpus's size was never the problem. Its *shape* was, and only mutation
testing said so.

Note the asymmetry that makes this hard to notice by reading: an under-covered guard does
not fail, it **agrees**. Every pin around it is green, so the suite's own report is
evidence of coverage it does not have.

## Examples

The two axes to cross are the values, not the positions:

```bash
# Reaches neither guard: one global per command.
for g in '-c k=v' '-C /abs' '--git-dir=/x' '--work-tree /x'; do emit "git $g commit"; done

# Reaches both: same axis, two values, within a span and across spans.
for a in '-C /abs'; do
  for b in '--git-dir=/x' '--work-tree /x' '-C/glued'; do
    emit "git $a $b commit"                 # co-occurrence WITHIN one invocation
    emit "git $a $b commit; git $a commit"  # ...and one bad span beside one good one
  done
done
```

Then prove the corpus reaches them, rather than assuming it:

```bash
# Delete the guard in a COPY of the tree, run the suite, require it to go red.
sed -i '' 's/if \[ "$ntok" != "$nval" \]; then unresolved=1; continue; fi/true/' \
  "$COPY/lib/cmd-detect.sh"
bash "$COPY/test-cmd-detect.sh" | tail -1   # must report failures; green = not covered
```

## Exceptions

None for a guard that compares two operands. For a genuinely single-operand check (a range
bound, a null test) a one-value-per-axis corpus does reach it, and adding pairs buys
nothing.

## Related Files

- `.claude/hooks/lib/cmd-detect.sh` — `cmd_git_repo_dir`, whose two co-occurrence guards
  are the worked example above.
- `.claude/hooks/test-cmd-detect.sh` — the "MIXED spans" pins, each carrying the mutation
  that found it.

## See Also

- [a reviewer's own probe is a test and inherits its rules](a-reviewers-own-probe-is-a-test-and-inherits-its-rules-2026-08-31.md) —
  the parent rule: verify by executing, and control the instrument. This is the corpus-shaped
  face of it.
- [mutation testing: suppress only equivalent mutants](mutation-testing-suppress-only-equivalent-mutants-2026-06-05.md) —
  a surviving mutant here was **not** equivalent; it was unreached.
- [gate test needs a two-sided negative control](gate-test-needs-two-sided-negative-control-2026-07-25.md) —
  two-sidedness is about the verdict axis; this is about the input axis, and a corpus can
  satisfy one while failing the other.
- [an uncontrolled ambient input makes the check agree with what it checks](../logic-errors/an-uncontrolled-ambient-input-makes-the-check-agree-with-what-it-checks-2026-08-31.md) —
  the same "the check agrees instead of failing" shape, sourced from the environment rather
  than the corpus.
