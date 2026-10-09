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
- Follow-up: the pattern is now built from shared quantity, duration and hedge lists. It adds:
  - months, spelled-out numbers, "a couple (of)", "the whole/a full/an entire" and hedges ("more than", "at least");
  - contractions tied to their auxiliary ("dont", "cant", "wont", "haven't eaten", "cannot");
  - "went/gone N days without food", "eat nothing for a week" and "starved myself".

  A word that only ends in "nt" ("consistent eating for a week") does not trip. Tests: 34 positives and 25 negatives. A generated probe of 801 phrasings that should trip all tripped. Of 283 generated near-misses, including 160 "-nt word + eating for <duration>" rows, none tripped `prolonged_starvation`. The 8 "pregnant-…" rows match `medical_condition` by design.
