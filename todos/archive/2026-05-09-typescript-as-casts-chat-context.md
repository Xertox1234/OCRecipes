---
title: "Replace unsafe as-casts on DB text columns in chat and coach-context routes"
status: done
priority: medium
created: 2026-05-09
updated: 2026-05-09
assignee:
labels: [deferred, typescript, audit-2026-05-09]
---

# Replace unsafe as-casts on DB text columns in chat and coach-context routes

## Summary

Three `as TypeName` casts on untyped `text` DB columns: `m.role as WarmUpMessageRole` (coach-context.ts:161), `profile.allergies as {...} | null` (coach-context.ts:72), and three JSONB field casts in chat.ts:403–409 that are redundant given `$type<>()` hints.

## Background

Identified in the 2026-05-09 full audit (M7/M8/M9) by the typescript-specialist agent. The `conversation.type` cast (M7 pattern, H7) was already fixed in this audit — these are the remaining cast patterns in the same files.

## Acceptance Criteria

- [x] `coach-context.ts:161` — add type guard `isWarmUpRole(r: string): r is WarmUpMessageRole` and filter; remove cast
- [x] `coach-context.ts:72` — remove the `as { name: string }[] | null` cast; the field is `.$type<Allergy[]>().default([])` and is non-nullable
- [x] `chat.ts:403–409` — remove the three JSONB field casts; `$type<>()` annotations already provide correct types
- [x] Types remain clean (`tsc --noEmit` passes)

## Updates

### 2026-05-09

- All acceptance criteria already satisfied by commit b1c0c86b (PR #86: fix(types): remove unsafe as-casts in coach-context and chat routes)
- Archiving as completed without further changes needed

## Implementation Notes

The `isWarmUpRole` guard can be co-located near its use site. `WarmUpMessageRole` is likely `"user" | "assistant" | "system"` — verify in the type definition before writing the guard.
