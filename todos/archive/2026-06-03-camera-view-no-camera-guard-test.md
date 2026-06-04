---
title: "Add test coverage for CameraView no-device guard (PR #341)"
status: done
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, camera]
github_issue:
---

# Add test coverage for CameraView no-device guard (PR #341)

## Summary

The `if (!device) return <CameraUnavailable />` guard added in PR #341 has no test coverage. No `CameraView.test.ts` exists; the no-camera path is untested.

## Background

Deferred from 2026-06-03 full audit (L13). Files: `client/camera/components/CameraView.tsx:149`, `client/camera/components/CameraView.ios.tsx:180`.

## Acceptance Criteria

- [ ] Test file created for `CameraView` (jsdom + `@testing-library/react` pattern per project conventions)
- [ ] Test asserts that `<CameraUnavailable />` renders when `useCameraDevice` returns `undefined`
- [ ] Test asserts that the camera view renders when a device is available

## Implementation Notes

Use `// @vitest-environment jsdom` header. Mock `react-native-vision-camera` → `useCameraDevice` returning `undefined` for the no-device test case. The `CameraUnavailable` component should be identifiable by its accessible text.

## Dependencies

- None

## Risks

- Low — new test file, no production code changes

## Updates

### 2026-06-03

- Initial creation (deferred from full audit L13)
