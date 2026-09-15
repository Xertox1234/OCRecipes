---
title: "Confirming a named member EXISTS is a positive check and says nothing about whether the list is EXHAUSTIVE"
track: bug
category: code-quality
tags: [harness, testing, hooks, bash, code-review]
module: shared
applies_to: [".claude/hooks/*.sh", "scripts/**/*.sh", "docs/solutions/**/*.md", "todos/**/*.md"]
symptoms: ["A list says 'the X/Y/Z controls' and the enumeration finds more than three", "A member was added to a list and the list was then described as complete", "A decomposition sentence reconciles a TOTAL correctly while naming only part of the set", "Review asks 'is this list complete?' and the answer cites one member that is present", "A prose list and the run output that produced it were never diffed against each other"]
created: 2026-09-15
severity: medium
---

# Confirming a member EXISTS is not confirming the list is EXHAUSTIVE

## Problem

A comment decomposed a corpus's non-denying remainder as:

```
# 628 of the 721 rows deny on the precise path; the other 93 are ALLOW there
# (the fp-*/c1g-*/sitefp-*/fautogrant-*/fautocutsp-*/vft-*/ghrootfp-*/siterailfp-*
# controls, plus the 24 precise-path gaps).
```

While resolving a merge I noticed one side's copy named seven families and the
other named eight, the extra being `siterailfp-*`. I verified `siterailfp-*` really
existed in the merged tree (2 rows), restored it, and wrote that the sentence was
now "load-bearing precisely because it is how a reader reconciles 721 - 628 = 93".

Enumerated, the eight named families covered **42 of 69** rows. Five more families
(`c2-*`, `fautodigfp-*`, `flagadjfp-*`, `decoyfp-*`, `c9-*`) and three singletons
were missing. The real answer was sixteen families.

## Symptoms

- A list is described as complete right after a member was added to it.
- The arithmetic reconciles at the TOTAL level (`69 + 24 = 93 = 721 - 628`) while
  the named breakdown does not sum to that total.
- The justification for completeness names a member rather than a count.
- Nobody ever ran the enumeration, because the list "looked" right.

## Root Cause

Two different claims, needing two different kinds of evidence:

| claim | shape | evidence needed |
| --- | --- | --- |
| `siterailfp-*` is in the set | positive, existential | find one instance |
| these eight are ALL of the set | negative, universal | enumerate the whole set |

Finding the instance is cheap and feels like verification, so it gets substituted
for the universal. But no number of confirmed members bounds the number of
unconfirmed ones. The total reconciling made it worse, not better: `69 + 24 = 93`
is true and says nothing about whether the *names* are complete, because the 69 was
counted from the run and the names were recalled from prose.

The merge context supplied the motive. Comparing two copies of a sentence and
noticing one has an extra item frames the question as "which of these two lists is
right?" — when the real question is "what is the actual set?", and neither copy is
evidence about that.

## Solution

Enumerate. For a set the harness already prints, this is a few lines:

```bash
# every row whose EXPECTED and PRECISE verdicts are both ALLOW, grouped by id family
awk -F'|' '$1 ~ /^[a-z0-9]/ {
    gsub(/ /,"",$2); gsub(/ /,"",$3);
    if ($2=="ALLOW" && $3=="ALLOW") { gsub(/ /,"",$1); print $1 }
  }' corpus.out | sed 's/-.*//' | sort | uniq -c | sort -rn
```

Then write the measured result, with the method named so the next reader can redo it:

```
# Those 69 span SIXTEEN id families, not the eight this sentence named until
# 2026-09-15 -- fp-* (16), c2-* (9), c1g-* (7), fautodigfp-* (6), sitefp-* (5),
# vft-* (5), flagadjfp-* (4), decoyfp-* (3), ghrootfp-* (3), c9-* (2),
# fautogrant-* (2), fautocutsp-* (2), siterailfp-* (2), plus the singletons
# co-nested-brace, fautobrace-pre and fautodigctrl-bb. COUNTED, not recalled:
# select every row whose EXPECTED and PRECISE verdicts are both ALLOW, group on
# the id prefix. 69 + 24 = 93 and 721 - 628 = 93, so the decomposition closes.
```

If enumeration is genuinely expensive, the honest alternative is to **mark the list
non-exhaustive** ("families include ...") rather than to leave a completeness claim
standing on existential evidence.

## Prevention

- Grep your own prose for completeness words — *all*, *every*, *only*, *complete*,
  *exhaustive*, *the N controls* — and for each, ask what enumeration produced it.
  If the answer is "I checked one member", it is not supported.
- A sentence that a reader is told to RECONCILE a total from must itself be
  generated from the data, not maintained by hand beside it.
- Reviewing a list change, do not compare the two versions of the list. Compare the
  new version against the SET. Two wrong lists differ from each other too.
- The cheapest tell: if the named parts have counts, sum them. Here 16+7+5+2+2+5+3+2
  = 42 against a stated 69, visible without running anything.

## Related Files

- `.claude/hooks/repro-outward-cli-corpus.sh` — the decomposition sentence and its correction

## See Also

- [[a-sampled-corpus-described-as-generated-2026-09-13]] — the same substitution in
  the other direction: a count reported without the set it was counted over
- [[a-measurement-belongs-to-the-tree-it-was-taken-on-2026-09-13]] — figures that were
  true of a different tree
- [[a-merge-invalidates-positional-references-into-a-file-it-did-not-change-2026-09-15]]
  — the sibling defect found in the same review round
