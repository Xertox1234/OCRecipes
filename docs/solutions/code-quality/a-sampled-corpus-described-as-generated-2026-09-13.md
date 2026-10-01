---
title: "A corpus piped through `head` is SAMPLED, not generated — the command line looks the same, and the missing rows are the ones that would have failed"
track: bug
category: code-quality
tags: [harness, testing, corpus, bash, hooks, code-review]
module: shared
applies_to: [".claude/hooks/*.sh", "scripts/**/*.sh", "todos/**/*.md", "docs/solutions/**/*.md"]
symptoms: ["A verification reports zero unintended changes and a reviewer running the full population finds many", "A corpus is described as generated from a file listing but the command contains head, cut, or a narrowing glob", "A count is quoted without the population size it was taken over", "The rows that would have falsified the claim are precisely the ones the sample omitted"]
created: 2026-09-13
severity: medium
---

# A corpus piped through `head` is sampled, not generated

## Problem

"Generate the corpus rather than listing it" is a rule this repo already has, and it works.
It has a failure mode that survives the rule entirely: you *do* enumerate from a real source,
then narrow the result for speed — `head -2`, `| head -20`, a glob that matches a subdirectory
— and describe the outcome as generated. It was generated. It is also a **sample**, and the
two are indistinguishable at the call site because both start with the same command.

The consequence is not a smaller corpus. It is a corpus whose omissions are correlated with
whatever you were not thinking about, which is exactly the population the check exists to
find.

Measured, on a change to `todo-automerge-guard.sh`'s path classifier:

| corpus | rows | unintended classification changes found |
| --- | --- | --- |
| `git ls-files` filtered to the interesting dirs, high-volume classes through `head -2` | ~30 | **0** |
| `git ls-files`, all of it | 3567 | **33** |

The 33 were ordinary documentation and todo files — `premium-gate-parity-…md`,
`005-p1-login-lacks-zod-validation.md` — caught by free-text keyword alternatives
(`[Pp]remium` alone matched 15) in a regex the change had started applying to prose. The
two sampled rows happened to contain none of those words. The verification reported
**"zero unintended changes across the generated set"** and shipped a fix that would have
gated every future `/codify` and `/todo` archive whose slug used an everyday word.

## Symptoms

- A verification reports a clean zero and a reviewer running the full population reports a
  large number.
- The word "generated" appears next to a command containing `head`, `cut -n`, `| tail`, or a
  glob narrower than the claim.
- A count is quoted without the size of the population it was measured over.
- The sample was taken from the *high-volume* classes — the ones most tedious to enumerate,
  and therefore the ones most likely to contain the unusual row.

## Root Cause

Sampling is applied for a reason that feels unrelated to correctness — runtime, output
length, readability of the table — so it is not re-examined when the result is written up.
And the word "generated" is true of the first half of the pipeline, so writing it does not
feel like a claim that needs checking.

The deeper version: a corpus's value is not that it was produced mechanically, it is that
**nobody chose which rows are in it**. `head` re-introduces a choice — an arbitrary one,
which is worse than a considered one, because it correlates with file ordering rather than
with anything about the check.

## Solution

**Run the full population, and print its size next to the result.**

```bash
total=0; changed=0
while IFS= read -r f; do
  total=$((total+1))
  [ "$(old "$f")" != "$(new "$f")" ] && changed=$((changed+1))
done < <(git ls-files)          # no head, no filter
echo "examined $total; changed $changed"
```

`examined 3567; changed 58` is a claim someone can check. `changed 0` is not.

If the full run is genuinely too slow, **say what you sampled and how**, in the same sentence
as the number — "25 of 3567, sampling the docs/ classes at 1-in-50" — so the reader can
weigh it. A stated sample is honest; a silent one reads as a census.

And when the result is a **zero**, treat it as suspect by default: a clean zero and a harness
that never reached the interesting rows produce identical output. Before believing it,
confirm the corpus contains at least one row you expect to be positive.

## Prevention

- Grep your own verification command for `head`, `tail`, `cut`, and narrowing globs before
  writing the word "generated" anywhere near it.
- Quote every count with its denominator — the population size, not just the hits.
- Prefer a row-by-row diff of two classifiers over a summary count: it forces the loop to
  visit every member, and the per-row output makes an unexpectedly small population obvious.
- When you write an acceptance criterion demanding a generated corpus, apply it to your own
  candidate fix first. In the instance above, the same document demanded one and its author's
  verification was sampled.

## Related Files

- `scripts/todo-automerge-guard.sh` — the path classifier whose reorder this defect nearly shipped
- `todos/archive/P1-2026-09-13-agent-and-skill-markdown-skips-the-review-gate-entirely.md` — carries the full-corpus table and records the sampling failure rather than only its corrected number

## See Also

- [a measurement belongs to the tree it was taken on](a-measurement-belongs-to-the-tree-it-was-taken-on-2026-09-13.md) — the sibling failure, where the corpus was right and the tree moved
- [a two-sided control can still agree with a broken predicate](a-two-sided-control-can-still-agree-with-a-broken-predicate-2026-09-12.md) — where "generate rather than list" was first recorded
- [a clean zero needs its denominator](a-control-that-runs-before-the-work-cannot-validate-it-2026-09-07.md) — the zero that is true of a population of nothing
- [a corpus that varies one axis at a time misses co-occurrence](../conventions/one-axis-at-a-time-corpus-misses-co-occurrence-checks-2026-09-01.md) — the other way a generated corpus is incomplete: right population, wrong dimensions
