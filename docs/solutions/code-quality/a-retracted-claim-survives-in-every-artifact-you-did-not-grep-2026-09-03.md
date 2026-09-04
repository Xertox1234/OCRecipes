---
title: "A retracted claim survives in every artifact you did not grep — correcting the PR body leaves the same false sentence in tracked code"
track: bug
category: code-quality
tags: [code-review, verification, testing, ci, harness]
module: shared
applies_to: ["e2e/**", "todos/**", "docs/**", ".github/**"]
symptoms: ["A claim was investigated, found wrong, and retracted in the place it was discovered — but the same sentence still ships in a source comment, a todo, or a second PR body", "The surviving copy carries a stronger confidence marker than the original, e.g. a header labelled \"Measured, not argued\"", "Two CI runs on the SAME commit disagree about which items failed, so an outcome attributed to a code change is not reproducible", "A grep for the concept finds nothing but a grep for the literal numbers finds several copies"]
created: 2026-09-03
last_updated: '2026-09-03'
severity: high
---

# A retracted claim survives in every artifact you did not grep

## Problem

A claim was made from a bad comparison: "iOS was green 3/3 before this commit and red
2/2 after." It was job-level CI verdicts on a suite that re-runs failed flows, so it
scored retry luck as much as code (see
`two-prs-rewriting-one-line-on-different-axes-2026-09-03.md` for the sibling failure of
comparing the wrong variable).

The error was found and retracted — in the PR body where it had just been written, and
in a comment on the tracking issue. That felt like closing it out.

It was not. The same sentence had already been **copied as supporting evidence** into
every artifact that needed justifying, and four of five copies survived the retraction:

| artifact | status after the "retraction" |
|---|---|
| PR #917 body | corrected ✅ |
| tracking issue comment | corrected ✅ |
| `e2e/helpers/enter-registration-passwords.yaml` header | **still asserted it** |
| `e2e/helpers/enter-registration-passwords-retry.yaml` header | **still asserted it** |
| `todos/P3-…-cache-pods-and-deriveddata.md` | **still asserted it** |
| PR #918 body | **still asserted it** |

Three of the four survivors were in **git-tracked files inside open, CI-green,
mergeable PRs**. Merging them would have committed a known-false claim into the
codebase, where it reads as established fact with no trace that it was ever withdrawn.

## Why it happens

Retraction is naturally scoped to where the error was **discovered**. Propagation is
scoped to where the claim was **useful**. Those are different sets, and the second is
always larger, because a claim that justifies a change gets pasted into every surface
that has to argue for that change: the PR body, the file header explaining why the code
looks this way, the todo tracking the follow-up, the next PR that depends on it.

Worse, the copies drift **toward** confidence. The original was hedged. By the time it
reached a YAML header it read:

```yaml
# Measured, not argued: iOS was green 3/3 on the pre-union commits
# (33baffea, 24028f1c twice) and red 2/2 on the union commit (5b3b88ef),
# under matched warm-cache conditions.
```

`Measured, not argued` was attached to the single least-measured sentence in the file.
A phrase asserting its own rigour is written by someone anticipating doubt — which is
exactly where the doubt belonged.

## Solution

**1. Grep the literal fingerprint, not the concept.** Numbers and run IDs are copied
verbatim while the surrounding prose gets reworded, so they are the reliable handle:

```bash
grep -rniE "3/3|2/2|green .*(before|after)" e2e/ todos/ docs/
gh pr view <n> --json body --jq .body | grep -niE "3/3|2/2|measured"
```

Searching for "regression" or "the claim" finds nothing. Searching for `3/3` found all
four survivors.

**2. Sweep every open PR, not just the one you were editing.** A claim written during a
batch propagates across the batch. `gh pr list --state open` then grep each body.

**3. Retract in place; do not silently rewrite.** Leave the withdrawn wording quoted
where a reader would have seen it:

```yaml
# What the CI runs do NOT show is a regression at the union commit. An earlier
# version of this comment claimed "green 3/3 before, red 2/2 after" and called
# it measured. It was not: those are job-level verdicts, and this workflow
# re-runs failed flows, so they scored retry luck as much as code.
```

A silent edit leaves anyone who read the earlier version still believing it, with
nothing in the file to correct them.

**4. Treat confidence markers as search targets.** `Measured, not argued`,
`verified`, `proven`, `definitively` — grep for them during review. Prose that asserts
its own rigour is where unsupported claims concentrate.

## Detection: the same-input control

The claim died to a control that costs one command. Two CI runs on the **same SHA**
(`5b3b88ef`), each `3/9` on attempt 1, disagreed about *which* flows failed:

| flow, attempt 1 | run `33796820565` | run `33802822765` |
|---|---|---|
| `Onboarding - Register and complete onboarding` | FAILED | passed |
| `Home - View item detail from history` | passed | FAILED |

Identical code, different failures. Any outcome attributed to a code change must first
survive the question: **does the unchanged condition reproduce its own result?** If the
same input gives two answers, no difference across that boundary is attributable to
anything.

This also killed the *replacement* claim. After retracting the regression, a "measured
improvement — Onboarding failed before and passes now" was substituted. The second
same-SHA run shows Onboarding passing on the supposedly-broken code, so the replacement
was the original error wearing different numbers.

## Prevention

- A justification that cites run outcomes gets the same-SHA control **before** it is
  written into a file header, not after review.
- When a claim is retracted, grep its numeric fingerprint across `e2e/`, `todos/`,
  `docs/`, and every open PR body in the same batch — retraction is a sweep, not an edit.
- Prefer justifications that need no run at all. The surviving argument here — an
  `optional:` step *cannot fail*, so a permissive first-attempt path submits empty
  credentials and still reports green — is readable off the semantics and cannot rot
  when a flaky suite changes its mind.

## Related

- `docs/solutions/logic-errors/two-prs-rewriting-one-line-on-different-axes-2026-09-03.md`
  — the sibling case: verified work silently lost at merge, also invisible to CI.
- `docs/solutions/logic-errors/optional-e2e-steps-cannot-fail-dead-selectors-stay-green-2026-08-30.md`
  — the semantic argument that replaced the retracted numbers.
