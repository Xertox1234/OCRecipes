---
title: "useSendMessage / useCoachStream track only the latest XHR — an overlapping send can't be aborted"
status: backlog
priority: low
created: 2026-09-24
updated: 2026-09-24
assignee:
labels: [deferred, client-state, hooks]
github_issue:
---

# useSendMessage / useCoachStream track only the latest XHR — an overlapping send can't be aborted

## Summary

`useSendMessage` in `client/hooks/useChat.ts` keeps its in-flight request in a single `xhrRef`. Each `sendMessage` overwrites it, and the `finally` clears it to `null`. If two sends overlap on one hook instance, `abortStream()` only reaches the newest request. When the first request finishes, it also nulls the ref while the second is still running, so the second can no longer be aborted. `useCoachStream` (`client/hooks/useCoachStream.ts`) has the same single-ref shape.

## Background

Deferred from the #1065 mobile review; the user approved filing it on 2026-09-24. The real UI can't reach this today, because the send button is disabled while streaming. It's a hardening item: any future caller that sends programmatically (quick replies, retry, a deep link) could overlap.

## Acceptance Criteria

- [ ] Either overlapping sends are impossible at the hook level (`sendMessage` refuses or queues while `isStreamingRef.current`), or `abortStream()` aborts every in-flight request, and a request's cleanup only clears the ref when it still owns it.
- [ ] Test: two overlapping `sendMessage` calls, then `abortStream()`. Assert the chosen behavior for both requests.
- [ ] `useCoachStream` gets the same treatment, or a recorded reason why not.

## Implementation Notes

- Cheapest fix: in the `finally`, only clear the ref if it still points at this request: `if (xhrRef.current === xhr) xhrRef.current = null`. Combine it with a guard on `isStreamingRef.current` at the start of `sendMessage`.
- Tests: `client/hooks/__tests__/useChat.test.ts`, and `useCoachStream`'s tests in `client/hooks/__tests__/useCoachStream.test.ts`.
