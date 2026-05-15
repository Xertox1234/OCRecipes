---
title: "Sanitize recipe content in remix chat history before OpenAI calls"
status: done
priority: medium
created: 2026-05-09
updated: 2026-05-09
assignee:
labels: [deferred, security, audit-2026-05-09]
---

# Sanitize recipe content in remix chat history before OpenAI calls

## Summary

Recipe remix stores unsanitized `ingredients`/`instructions` as a `system`-role chat message. `generateRecipeChatResponse` only sanitizes `user`-role messages — a recipe author can embed prompt injection payloads that reach GPT-4o unsanitized on every chat turn.

## Background

Identified in the 2026-05-09 full audit (M1) by the security-auditor agent. The `buildRemixSystemPrompt` function correctly sanitizes content when constructing the initial system prompt — but the history-loading path in `recipe-chat.ts:367` only checks `role === "user"`.

## Acceptance Criteria

- [ ] In `generateRecipeChatResponse` history mapping (`server/services/recipe-chat.ts:367`), apply `sanitizeContextField` to message content for ALL roles (not just `"user"`)
- [ ] Or alternatively: sanitize `ingredients`/`instructions` before persisting the system message in `server/routes/chat.ts:190–205`
- [ ] Add a test verifying that prompt injection content in a `system` message is sanitized

## Implementation Notes

`sanitizeContextField` (lighter sanitization for context data) is more appropriate than `sanitizeUserInput` for system-role messages containing recipe data. The fix in `buildRemixSystemPrompt` at `recipe-chat.ts:250–260` is the reference implementation.
