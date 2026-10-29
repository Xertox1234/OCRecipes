---
title: "Give the two XHR streaming clients one shared SSE transport"
status: in-progress
priority: medium
created: 2026-10-26
updated: 2026-10-26
assignee:
labels: [deferred, maintainability, client]
github_issue:
---

# Give the two XHR streaming clients one shared SSE transport

## Summary

Extract one `streamSse()` transport used by both `useChat.sendMessage` and `useCoachStream`, and move the unrelated notebook hooks out of `useChat.ts`.

## Background

Audit finding M4. `client/hooks/useChat.ts:408-750` and `client/hooks/useCoachStream.ts:255-400` each hand-roll token fetch, XHR open/headers (incl. `X-Timezone`), `responseText` slicing, `data:` parsing, and error/timeout/abort mapping. They had already diverged: `useCoachStream` lacked the partial-line buffer (audit M3 — fixed in the audit PR) and `useChat` lacks the inactivity timer. `useChat.ts:834-939` also holds notebook hooks unrelated to chat.

Deferred from the 2026-10-25 `/audit maintainability` run (user triage: the large refactors become todos, each its own PR with its own review). Discovery: `code-reviewer` with the maintainability-checklist lens; every cited line was re-read and grep-verified by the orchestrator before filing.

## Acceptance Criteria

- [ ] `client/lib/sse-xhr.ts` exports `streamSse({ url, body, headers, timeoutMs, inactivityMs?, onEvent, signal })` owning the line buffer, final flush, error/timeout/abort mapping
- [ ] Both hooks use it; each keeps only its own event reducer (and the coach typewriter drain)
- [ ] Notebook hooks move to `client/hooks/useNotebook.ts`; importers (NotebookScreen, NotebookEntryScreen, CoachProScreen) updated
- [ ] `streamSse` has its own unit tests incl. a split-chunk case and the RN abort→readystatechange ordering the existing MockXHR models
- [ ] Behaviour unchanged: existing tests for the touched files pass without edits to their assertions (new tests may be added)
- [ ] No file in scope ends above 600 lines unless it started there and shrank

## Implementation Notes

Keep the `settled` single-terminal-outcome guard and the epoch guards semantics. Decide explicitly whether `useChat` gains the inactivity timer (behaviour change → separate commit, called out in the PR).

## Scope Contract

- **Mechanisms to use:** extraction/move of existing code only — no new runtime behaviour
- **Files in scope:** `client/hooks/useChat.ts`, `client/hooks/useCoachStream.ts`, new `client/lib/sse-xhr.ts`, new `client/hooks/useNotebook.ts`, their importers and `__tests__`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- RN XHR event ordering (readystatechange at DONE before error/timeout/abort) is load-bearing; the existing tests model it — reuse them.
- Device-only behaviour (real network chunking) cannot be fully proven in Vitest.

## Updates

### 2026-10-26

- Initial creation from the 2026-10-25 maintainability audit
