---
title: "Front-of-pack allergen read: measure the reply on a dense pack"
status: backlog
priority: low
created: 2026-11-26
updated: 2026-11-26
assignee:
labels: [deferred, ai]
github_issue:
---

# Front-of-pack allergen read: measure the reply on a dense pack

## Summary

`analyzeFrontLabel(img, { allergens: true })` (server/services/front-label-analysis.ts)
reads the front of a pack at `detail: "high"` and returns up to 20 allergen
statements of 500 characters each, under the "front-label-scan" row's 1300
token cap, which includes Gemini's reasoning tokens. The tests mock the
model, so nobody has seen a live reply on a long multilingual pack.

## Background

The JSON-truncation rule asks for one live read of `finish_reason` and the
reasoning-token count on the longest realistic input before trusting a cap.
A cut-off reply fails to parse, the front read is then dropped, and the card
falls back to "Packaged food" with "I couldn't read the front of the pack".
That is safe, but the allergy check is lost on exactly the packs that print
the most.

## Acceptance criteria

- [ ] One live call on a dense EU/multilingual pack front, with
      `finish_reason` and the token counts recorded here.
- [ ] If it truncates, raise the cap for the allergen read only (the
      default read keeps 1300).
