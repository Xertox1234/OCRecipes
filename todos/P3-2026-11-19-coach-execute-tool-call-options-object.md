---
title: "Give executeToolCall an options object and drop the dead _preloadedProfile argument"
status: backlog
priority: low
created: 2026-11-19
updated: 2026-11-19
assignee:
labels: [deferred, maintainability, server, coach]
github_issue:
---

# Give executeToolCall an options object and drop the dead \_preloadedProfile argument

## Summary

`executeToolCall(toolName, args, userId, _preloadedProfile, tz, opts…)` carries an unused positional argument. It was kept only because tests pin the later arguments by index. Changing the arguments after `userId` to one options object removes the dead argument and the index pinning.

## Background

This was left over from `todos/archive/P1-2026-11-19-coach-tools-registry.md` (PR #1950). That todo's Implementation Notes asked for this conversion in a separate commit. The executor left it out because it reaches outside that todo's Scope Contract.

## Acceptance Criteria

- [ ] `executeToolCall(toolName, args, userId, { tz, ...existing trailing options })`. The arguments after `userId` become one object, and `_preloadedProfile` is gone.
- [ ] The one production caller (`server/services/nutrition-coach.ts`, the `executeToolCall(` call in the tool loop) passes the object.
- [ ] Tests that read `executeToolCall` arguments by index read them by name instead.
- [ ] `generateCoachResponse` / `generateCoachProResponse` signatures are unchanged. The coach-chat-turn-stages todo relies on them staying positional.
- [ ] Behaviour unchanged: the existing coach test files stay green apart from the argument-shape updates above.

## Implementation Notes

- The `_preloadedProfile` doc comment in `server/services/coach-tools.ts` explains why it was kept. Delete the comment along with the argument.
- If a `generateCoach*` test indexes into `executeToolCall`'s calls, update it. If it indexes into `generateCoach*`'s own calls, leave it alone.
- Review: server-reviewer + ai-reviewer.

## Scope Contract

- **Mechanisms to use:** a plain options-object parameter — nothing new.
- **Files in scope:** `server/services/coach-tools.ts`, `server/services/nutrition-coach.ts` (the call site only), and `server/services/__tests__/*.test.ts` files that assert on `executeToolCall` arguments.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None (#1950 merged).

## Updates

### 2026-11-19

- Filed as the follow-up of PR #1950 (coach-tools registry).
