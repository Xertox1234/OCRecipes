---
title: "ai-reviewer.md: vision/text tier wording contradicts ai-models.ts"
status: done
priority: low
created: 2026-10-06
updated: 2026-10-09
assignee:
labels: [deferred, harness]
github_issue:
---

# ai-reviewer.md: vision/text tier wording contradicts ai-models.ts

## Summary

`.claude/agents/ai-reviewer.md` puts `photo-analysis.ts` under "Vision (HEAVY rows, gpt-4o)" and tells reviewers "FAST for text, HEAVY for vision". In `server/lib/ai-models.ts`, `photo-classify` is a FAST vision row and `photo-recipe-text` is a FAST row. The same section lists `voice-transcription.ts` as a row-backed text service, but that file has no `AI_FEATURES` row: it calls `openai.audio.transcriptions.create`, which `aiChat` does not cover.

## Background

The code-reviewer raised this as a suggestion in the roster pass of #1291 (OpenRouter PR 4). The one-pass review policy keeps suggestions off the reviewed branch. The old `MODEL_HEAVY` wording had the same inaccuracy, so this is not a regression.

## Acceptance Criteria

- [x] The vision bullet says that `photo-analysis.ts` has both HEAVY rows and FAST rows (`photo-classify` is FAST vision; `photo-recipe-text` is FAST text), or it drops the tier from the heading.
- [x] The checklist item "FAST for text, HEAVY for vision" is reworded so the row's tier is the authority, not the modality.
- [x] `voice-transcription.ts` moves out of the row-backed text list, for example: "(audio, direct `openai` client; no `AI_FEATURES` row)".

## Implementation Notes

- Only `.claude/agents/ai-reviewer.md` changes; it is around lines 45, 52 and 82 after #1291. Check each row in `server/lib/ai-models.ts`.
- Agent edits take effect on session reload.
