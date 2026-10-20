---
title: "LabelAnalysisScreen verification 'returns past the label camera' test flaked once under a full --retry=0 suite"
status: backlog
priority: low
created: 2026-10-20
updated: 2026-10-20
assignee:
labels: [deferred, testing, client]
github_issue:
---

# LabelAnalysisScreen verification test flaked under full-suite load

## Summary

`client/screens/__tests__/LabelAnalysisScreen.verification.test.tsx` > "LabelAnalysisScreen — verification mode Done > returns past the label camera to the product after a verification" failed once in a full `--retry=0` suite (2026-10-20): the `POST /api/verification/submit` mock was called, but with a body that did not match the expected arguments (the diff showed `sessionId: "session-1"` among the differing fields). It passed 3/3 when run alone. CI's `retry: 2` hides it.

## Background

Found while verifying the supertest loopback-bind fix — unrelated to it (client jsdom test, no supertest). Likely a timing race under CPU load between the screen's state updates and the submit call.

## Acceptance Criteria

- [ ] Reproduce under load (e.g. 20 parallel `--retry=0` runs of the file) and capture the full received-vs-expected diff
- [ ] Fix the race (await the state the assertion depends on) so 40 parallel `--retry=0` runs pass

## Implementation Notes

- Files: `client/screens/__tests__/LabelAnalysisScreen.verification.test.tsx`; the screen is `client/screens/LabelAnalysisScreen.tsx` (read-only unless the cause is there).
- Repro loop: `for i in $(seq 20); do NODE_ENV=test npx vitest run client/screens/__tests__/LabelAnalysisScreen.verification.test.tsx --retry=0 & done; wait`.
