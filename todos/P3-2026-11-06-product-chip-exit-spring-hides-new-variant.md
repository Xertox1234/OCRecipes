---
title: "ProductChip: a cancelled exit spring can hide a chip whose variant came back"
status: backlog
priority: low
created: 2026-11-06
updated: 2026-11-06
assignee:
labels: [deferred, camera]
github_issue:
---

# ProductChip: a cancelled exit spring can hide a chip whose variant came back

## Summary

If a variant returns while the exit spring is still running, the cancelled spring's completion callback still runs `setShouldRender(false)`, hiding the chip while a variant is showing.

## Background

Found by the react-hooks/set-state-in-effect batch A (PR #1771, 2026-11-06), which kept the exit path unchanged. Not seen on a device; needs a real-device check (the camera screens cannot be exercised in the simulator).

## Acceptance Criteria

- [ ] A test (fake timers / mocked Reanimated callback with `finished: false`) shows the chip stays rendered when the variant returns mid-exit.
- [ ] The exit callback only unmounts when the spring finished (`finished === true`) and no variant is set.

## Implementation Notes

- File: `client/camera/components/ProductChip.tsx` (exit spring callback) and its co-located test.
- Reanimated completion callbacks receive `finished`; guard on it.

## Scope Contract

- **Files in scope:** `client/camera/components/ProductChip.tsx` and its co-located tests.
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-11-06

- Filed from the set-state-in-effect batch A report.
