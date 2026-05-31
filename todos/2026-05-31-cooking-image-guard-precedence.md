---
title: "Decide image-guard vs checkAiConfigured precedence in cooking.ts (503-vs-400 edge)"
status: backlog
priority: low
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, api, code-quality]
github_issue:
---

# cooking.ts image-guard precedence edge

## Summary

After the `requireValidImage` helper extraction, the image guard in `server/routes/cooking.ts` now runs _after_ `checkAiConfigured`. For the nonsensical "missing file + AI unconfigured" request, the route now returns 503 (AI down) instead of the previous 400 (no photo). All real-world paths are byte-identical; only this untested edge combination changed. Decide the intended precedence and lock it with a test.

## Background

Surfaced during the `photo-upload-helper` todo (branch `todo/2026-05-31-photo-upload-helper`). The helper was placed after the existing `checkAiConfigured` call, flipping the response code for one input combination that no client produces (a request with neither a file nor a configured AI backend). The reviewer judged 503 arguably _more_ correct (service genuinely unavailable), but flagged the silent behaviour change for an explicit decision. `cooking.test.ts` hardcodes `isAiConfigured` true, so this combination is never exercised.

## Acceptance Criteria

- [ ] Decide the intended precedence: validate the image _before_ or _after_ the AI-config check.
- [ ] `server/routes/cooking.ts` orders the two guards to match that decision (move `requireValidImage` before `checkAiConfigured` if 400-first is preferred; leave as-is if 503-first is intended).
- [ ] A test exercises the "missing file + AI unconfigured" combination and asserts the chosen status code (currently `cooking.test.ts` can't, because `isAiConfigured` is hardcoded true — parameterize it).
- [ ] All real-world paths (valid image, invalid bytes, missing file with AI configured) remain unchanged.

## Implementation Notes

- File: `server/routes/cooking.ts` (~line 231, the photos handler) — the relative order of `checkAiConfigured` and the `requireValidImage` guard.
- This is the lowest-value item in the 2026-05-31 deferred set (nonsensical-only input); a one-line reorder + one test, or an explicit "503-first is intended" code comment + test, both close it.

## Dependencies

- Conceptually related to `todos/archive/2026-05-31-photo-upload-helper.md`; not blocking.

## Risks

- None of practical consequence — no client produces this input combination.

## Updates

### 2026-05-31

- Created from the `photo-upload-helper` deferred warning during `/todo` deferred-warning triage (user chose to file rather than drop).
