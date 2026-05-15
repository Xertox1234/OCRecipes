---
title: "Add tests for cook session race condition mitigations"
status: backlog
priority: medium
created: 2026-03-09
labels: [testing, cook-and-track]
---

# Add tests for cook session race condition mitigations

## Summary

The Cook & Track capture flow has several race condition mitigations (promise memoization for session creation, serial analysis queue) that need dedicated tests to ensure they work correctly under concurrent operations.

## Acceptance Criteria

- [ ] Test promise memoization: rapid photo captures only create one session
- [ ] Test serial analysis queue: concurrent photo analyses process sequentially
- [ ] Test `userEdited` flag: AI merges don't overwrite manually edited ingredients
- [ ] Test debounced AsyncStorage persistence: rapid state changes batch into single write

## Implementation Notes

- These test the client-side patterns in `CookSessionCaptureScreen.tsx` and `useCookSession.ts`
- Promise memoization uses `sessionPromiseRef` — verify that calling `ensureSession()` multiple times concurrently returns the same promise
- Serial queue can be tested by mocking `addPhoto.mutateAsync` with controlled delays
- `cook-session-storage.ts` debounce can be tested with fake timers
