---
title: "Coach safety classifier misses plain-language starvation requests"
status: done
priority: medium
created: 2026-10-07
updated: 2026-10-07
assignee:
labels: [deferred, ai, safety]
github_issue:
---

# Coach safety classifier misses plain-language starvation requests

## Summary

"how do I stop eating for a week" classifies as `personalized_advice`, not `safety_refusal`. The regex safety layer in `server/services/coach-intent-classifier.ts` only catches fasting phrased as "water fast" or "N-day/hour fast".

## Background

This came up while writing the coach-recipe-offer acceptance tests (Task 13, 2026-10-07). The plan's safety example, "how do I stop eating for a week", did not reach the safety path, so the test switched to "how do I do a 5 day water fast", which matches `extreme_fasting`.

Two things follow from the miss:

- The Coach model sees the message as ordinary advice. It still has its own system-prompt safety guidance, but the deterministic refusal layer doesn't fire.
- With `RECIPE_OFFER_ENABLED` on, the `offer_recipe` tool stays available on such a message.

The defect is in the regex layer only. It is pre-existing and not caused by the offer work.

## Acceptance Criteria

- [x] Plain-language prolonged-starvation phrasings classify as a safety intent. Examples:
  - "stop eating for a week"
  - "not eat for 5 days"
  - "go without food for a week"
  - "skip eating for days"
- [x] Ordinary phrasings do NOT trip it:
  - "skip breakfast"
  - "intermittent fasting 16:8"
  - "stop eating late at night"
  - "stop eating sugar"
- [x] Tests cover both lists in the classifier's test file. Each positive gets a paired negative control.

## Implementation Notes

- Extend the `extreme_fasting` pattern (`server/services/coach-intent-classifier.ts` ~59-61), or add a sibling pattern. It should key on a duration of days or a week combined with not eating.
- Watch false positives on "stop eating X" (a food) and "stop eating after 8pm".

## Scope Contract

- **Mechanisms to use:** the existing `SAFETY_PATTERNS` array. Nothing new.
- **Files in scope:** `server/services/coach-intent-classifier.ts` and its `__tests__` file.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Over-broad regex refusing ordinary diet questions.

## Updates

### 2026-10-07

- Initial creation, from the coach-recipe-offer Task 13 acceptance tests.

### 2026-10-09

- Added sibling `prolonged_starvation` pattern to `SAFETY_PATTERNS` (day/week or 24+ hour durations, plus reflexive "starve myself"; a named food, clock time or quantity does not match).
- Tests (#1333): 14 positives (incl. "go 7 days without eating", "how long can I go without food") and 14 negatives (incl. "stop eating meat for a week", "fast for 12 hours"); red before, green after.
- Follow-up (after #1333): #1333's pattern is kept unchanged, and a SECOND `prolonged_starvation` entry adds wider phrasings. Because of the second entry, this change can only add refusals, never remove one.
  - The added phrasings are months, number words, ranges ("2-3 days", "two or three days"), "3+", decimals, glued units ("3days"), "48h" and hedges ("more than a week").
  - Contractions are tied to their auxiliary ("dont", "isn't", "shan't", "haven't eaten"), so "consistent eating for a week" is not read as a negation.
  - Also added: "went/gone N days without food", "eat nothing for a week" and "starved myself".
  - Earlier attempts to veto "without eating <food>" were dropped. Every veto list also let real starvation phrasing through ("without eating to lose weight", "after my surgery", "out of guilt"). So "can I go a week without eating meat" still over-refuses, as #1333 does. The new went/gone frames over-refuse the same way where main answered ("I went a week without eating pizza", "I went a week without eating well"). Both are the safe direction.
  - Tests: 56 positives and 27 negatives.
  - Probe on a generated 1630-row corpus (12 negating verbs x 14 quantity formats x 9 units, 5 "without eating" frames x 20 tails, 12 "-nt word" rows, 6 controls), against main f16f02e5: main refuses 362, this head refuses 1260, 0 rows that main refuses pass here. Short hours, "-nt" words, "I'm starving" and "stop eating sugar" stay ordinary. The zero is a property of this corpus. The two-entry structure is what guarantees it in general.
- Cleanup PR: the second entry also takes "never" and "refuse to" as negators and "fortnight" as a duration (from the #1339 code-reviewer). Tests: 59 positives and 29 negatives, 272 pass.
