---
title: "label-serving's UNIT/UNIT_CAP claim an anchor they don't carry — bake the \\b in, as barcode-lookup now does"
status: backlog
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, api, nutrition, parsing]
github_issue:
---

# `shared/lib/label-serving.ts`'s unit constants assert an anchor they don't have

## Summary

`UNIT` (`shared/lib/label-serving.ts:34`) and `UNIT_CAP` (`:88`) carry a docblock
claiming they are "longest-first so the alternation cannot settle on a prefix … and then
fail the `\b`" — but neither constant contains a `\b`. Every call site appends one. This
is the exact shape PR #833 just fixed in the sibling `server/services/barcode-lookup.ts`.

## Background

Verified on `main` 2026-08-16:

```ts
// :34 — no \b
const UNIT = String.raw`(?:grams?|g|millilit(?:re|er)s?|ml)`;
// :88 — no \b
const UNIT_CAP = String.raw`(grams?|g|millilit(?:re|er)s?|ml)`;
// call sites supply it: :44, :57, :90, :93
const PAREN = new RegExp(String.raw`\(\s*(\d+(?:\.\d+)?)\s*${UNIT}\b`);
```

Today's four call sites all append `\b` correctly, so **there is no live parsing bug** —
this is a latent one. A fifth regex built from `UNIT` inherits the docblock's promise and
none of the anchoring behaviour, and would accept `"1 gallon"` as 1 gram exactly as
`barcode-lookup.ts` did before #833.

Two further inaccuracies in the same docblock, both established empirically during #833's
fix and both present here verbatim:

- **"longest-first" is not load-bearing.** Reordering the alternatives changes no parse
  result; the trailing `\b` alone prevents settling on a prefix. Ordering affects
  backtracking cost only. A future editor who adds an alternative "in the right position"
  believing that is sufficient will be wrong.
- **The `gr` exclusion rationale.** `barcode-lookup.ts`'s docblock attributed excluding
  `gr` (collides with the apothecary "grain") to _this_ module's `UNIT` constant — which
  never mentions `gr` or `grain` at all. #833 corrected that attribution on its side; this
  side should say what it actually does and does not exclude.

This is instance 5 of
`docs/solutions/conventions/a-stated-invariant-is-not-an-enforced-one-2026-08-06.md`,
applied to the sibling module the codified instance explicitly names.

## Acceptance Criteria

- [ ] `\b` is baked into `UNIT` and `UNIT_CAP` themselves, and removed from the four call
      sites (`:44`, `:57`, `:90`, `:93`), so the property travels with the value
- [ ] A test pins that the constants alone reject a prefix match — e.g. a regex built from
      `UNIT` with no added `\b` does not accept `"1 gallon"`. Verified RED first
- [ ] The "longest-first" sentence is reworded so it does not imply ordering is load-bearing
- [ ] The docblock states plainly which spellings are and are not accepted, owning the
      judgment rather than citing a sibling module
- [ ] Existing `label-serving` tests still pass unchanged (no parse behaviour should move)
- [ ] Closes with zero follow-ups

## Implementation Notes

- Mirror the shape #833 landed:
  `const SERVING_UNIT = String.raw`(?:grammes?|grams?|gms?|g|millilit(?:re|er)s?|mls?)\b`;`
- Consider whether this module should also accept the six spellings #833 restored
  (`grammi`, `gramos`, `gramas`, `gramm`, `grs`, `grm`). It parses **label OCR text**, not
  crowdsourced Open Food Facts free text, so the vocabulary case is weaker here — decide
  and record it rather than copying #833's list reflexively.
- Comma decimals: #833 added `,\d{1,2}` support to `barcode-lookup.ts`. Check whether this
  module's digit group has the same gap and whether European label OCR can reach it.

## Scope Contract

- **Mechanisms to use:** the existing constants and their existing call sites — no new
  parser, no shared extraction with `barcode-lookup.ts`
- **Files in scope:** `shared/lib/label-serving.ts` and its co-located `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR #833 (the sibling fix this mirrors) is merged.

## Risks

- Low. No behaviour should change — all four call sites already anchor. If any test moves,
  that is itself the finding: a call site was relying on the unanchored form.

## Updates

### 2026-08-16

- Filed during the review round for PRs #833–#845. Surfaced by #833's fixer as an
  out-of-scope sibling; constants and call sites verified on `main` before filing.
