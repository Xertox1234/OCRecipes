---
title: "OpenRouter foundation (#1286): review minors — logging, casts, test precision"
status: backlog
priority: low
created: 2026-10-06
updated: 2026-10-06
assignee:
labels: [deferred, server, ai]
github_issue:
---

# OpenRouter foundation (#1286): review minors

## Summary

These are the non-blocking findings from the task reviews and the whole-branch roster review of PR #1286, the `aiChat` foundation. None of them change behaviour today, because no service calls `aiChat` until the PR 2 migrations. Several of them are easiest to do in PR 2–4 while those files are open.

## Background

The repo's one-pass review policy (`docs/AI_WORKFLOW.md`) keeps warnings and suggestions off the reviewed branch. The two blocking-relevant warnings, 408 and the moderation 403, were fixed in the stacked follow-up PR. What remains here is polish and precision.

## Acceptance Criteria

### `server/lib/ai-client.ts`

- [ ] The fallback warn log includes the original OpenRouter error (status and message). Today a transport or balance fallback logs only `fallbackReason`.
- [ ] Narrow `answeredModel` with `typeof model === "string" ? model : null` instead of `(res as ChatCompletion).model`, in both the non-streaming and fallback paths.
- [ ] Try removing the `as unknown as` casts (the params cast to `Record<string, unknown>`, and the casts in `defaultDeps` to `AiChatClient`). Keep only the ones tsc actually requires.
- [ ] Drop the dead `"no-key"` member of `FallbackReason`, or start emitting it.
- [ ] Throttle the per-feature config-error `reportError` (for example, once per feature per N minutes). Today a misconfigured row reports once per request.
- [ ] `wrapStream`'s `finally`: a rejection from `iterator.return()` must not mask the original error or skip `onEnd`.

### `server/lib/ai-failure.ts`

- [ ] Add a comment noting that while the breaker is open, a straggler failure extends the cooldown, and that there is no single-trial gate.

### `server/lib/__tests__/ai-client.test.ts`

- [ ] The abort tests (non-streaming, and while peeking) can't tell the two `isAbort` arms apart. Add a row with only an `APIUserAbortError` and no signal, and a row with only an aborted signal and an `APIConnectionError`. Assert that `breaker.recordFailure` and `report` are never called.
- [ ] Rename "no context → nothing recorded" to "no context → row model used". The current name claims more than the test checks.
- [ ] Add a test for an empty stream (`first.done`): it counts as success and yields nothing.

### Other files

- [ ] `eslint-plugin-ocrecipes/__tests__/rules.test.ts`: move the `no-direct-chat-completions` `tester.run` block above the `// ─── Specifier resolution, enumerated` header comment, which it currently splits from its `describe`.
- [ ] `server/__tests__/README.md`: the `OPENROUTER_API_KEY` row should say routing applies only to call sites that have migrated to `aiChat()`, until PR 4 completes the migration. Alternatively, reword it when PR 4 lands.

## Implementation Notes

- Source: SDD ledger for plan `docs/superpowers/plans/2026-10-06-openrouter-model-routing.md` (local-only). Reviewers: code-reviewer (task gates plus baseline), ai-reviewer.
- The day-one test in `server/lib/__tests__/ai-models.test.ts` asserts `model === openai/${fallback}`. That is expected to change in the first per-feature switch PR; it is not a defect.
