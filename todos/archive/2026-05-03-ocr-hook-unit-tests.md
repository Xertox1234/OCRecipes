---
title: "Unit tests for useOCRDetection JS-thread handler"
status: done
priority: medium
created: 2026-05-03
updated: 2026-05-04
assignee:
labels: [deferred, testing]
---

# Unit tests for useOCRDetection JS-thread handler

## Summary

Add Vitest unit tests for the `handleOCRResult` JS-thread callback inside `useOCRDetection`, covering the debounce logic, once-per-session haptic guard, and state transitions.

## Background

`useOCRDetection` (`client/camera/hooks/useOCRDetection.ts`) was added in PR #55. The hook wraps a VisionCamera V5 frame processor and is hard to integration-test (no easy way to mock native frame outputs). However, the JS-thread handler (`handleOCRResult`) contains meaningful branching logic — debounced "no text" transition, haptic fired only once per session, `latestOCRResult` ref update — that can be extracted and tested in isolation without any RN native context. Deferred from PR #55 code review.

## Acceptance Criteria

- [ ] Extract `handleOCRResult` logic into a pure, testable helper (or test via `renderHook` with mocked timers)
- [ ] Test: first text detection calls `onTextDetected(true)` and fires haptic exactly once
- [ ] Test: subsequent text frames do NOT re-fire `onTextDetected(true)` or haptic
- [ ] Test: text disappearing debounces `onTextDetected(false)` by `debounceMs` (default 500ms)
- [ ] Test: text reappearing during the debounce window cancels the pending `false` callback
- [ ] Test: `enabled=false` resets haptic flag, `isTextDetectedRef`, and `latestOCRResult`
- [ ] All new tests pass in `npm run test:run`

## Implementation Notes

- Use `vi.useFakeTimers()` to control the debounce timeout
- Mock `expo-haptics` (`vi.mock('expo-haptics')`) to assert call count without native bridge
- `renderHook` from `@testing-library/react-hooks` works for hook-level tests without native modules
- Test file location: `client/camera/hooks/__tests__/useOCRDetection.test.ts`

## Dependencies

- None blocking; pure JS logic

## Risks

- If `useTextRecognition` from `react-native-vision-camera-ocr-plus` can't be mocked cleanly, may need to extract `handleOCRResult` into a standalone helper file first

## Updates

### 2026-05-03

- Initial creation — deferred from PR #55 code review
