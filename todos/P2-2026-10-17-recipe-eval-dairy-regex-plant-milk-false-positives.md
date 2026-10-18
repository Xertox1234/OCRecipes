---
title: "recipe-generation eval: dairy/vegan forbidden-term regexes flag plant milks and dairy-free 'cream'"
status: backlog
priority: medium
created: 2026-10-17
updated: 2026-10-17
assignee:
labels: [deferred, evals, ai]
github_issue:
---

# recipe-generation eval: dairy regexes flag plant milks

## Summary

Three `mustNotContain` patterns in `evals/datasets/recipe-generation-cases.json` use `\bmilk\b` and `\bcream\b`, which match "almond milk", "coconut milk", "oat milk" and "chocolate cream" in otherwise compliant dairy-free / vegan / multi-allergy recipes. Every pattern failure in the 2026-10-17 model-comparison runs (gpt-4o control and Gemini candidates, 3 samples per case) was one of these false positives.

## Background

Found 2026-10-17 while running the suite to pick a gpt-4o replacement for `recipe-generate`. Example hits from the control run: `recipe-gen-dairy-free-dessert-06` on "unsweetened almond milk", `recipe-gen-multiple-allergies-08` on "400 ml coconut milk". The judge scored dietary compliance 9+ on the same samples. Because the paired comparison counts "new assertion failures" against a candidate, a model that favours plant milks (Gemini does) is penalised for being correct.

Deferred because it is an eval-harness defect, not app code, and was out of scope of the model comparison.

## Acceptance Criteria

- [ ] `\bbutter\b` on the same three patterns excludes nut and seed butters ("peanut butter", "almond butter", "tahini" is already fine) — the vegan case tripped on "natural peanut butter" twice in the Gemini 3.8 Flash low-effort run.
- [ ] Patterns on lines ~14 (vegan), ~134 (dairy-free), ~186 (multiple allergies) exclude plant milks and non-dairy creams. Suggested: `(?<!almond |coconut |oat |soy |soya |cashew |rice |hemp |pea |plant |nut |dairy-free )\bmilk\b` and the same lookbehind list for `\bcream\b` plus `(?<!coconut |cashew |chocolate |whipped coconut )`. JS supports lookbehind (V8 / Node).
- [ ] A unit test in `evals/__tests__/` asserts "almond milk" and "coconut cream" pass and "whole milk" / "heavy cream" / "milk chocolate" still fail for each edited pattern.
- [ ] Re-run `npm run eval:recipe-generation` once and confirm the control's pattern failures drop to zero without any new allergen slipping through (read the three affected cases' outputs by hand).
- [ ] Refresh `evals/baselines/recipe-generation.json` only if the owner agrees (the baseline's assertion pass rate will change).

## Implementation Notes

- `evals/assertions.ts` line ~50: `mustNotContain` is checked against ingredient lines only, so the lookbehind only needs to cover how ingredients are written ("400 ml coconut milk, canned").
- Keep "milk chocolate" failing on the dairy-free cases: a lookbehind on the word before "milk" does not cover it, so add a positive `milk chocolate` term where needed.
- `scripts/check-solution-frontmatter.js` does not apply here; `evals/datasets/*.json` is in lint-staged (`package.json` ~line 254), check what it runs.

## Scope Contract

- **Mechanisms to use:** the existing `mustNotContain` regex assertion — nothing new.
- **Files in scope:** `evals/datasets/recipe-generation-cases.json`, one new or extended test under `evals/__tests__/`, optionally `evals/baselines/recipe-generation.json`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- Loosening a safety regex. The lookbehind list is an allowlist of known plant milks; anything not on it still fails. Do not switch to a judge-only check.

## Updates

### 2026-10-17

- Initial creation (found during the recipe-generate model comparison).
