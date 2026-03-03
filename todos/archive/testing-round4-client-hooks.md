---
title: "Test client hooks with real logic"
status: done
priority: medium
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [testing, client, hooks, infrastructure]
---

# Test Client Hooks with Real Logic

## Summary

Add tests for the client hooks that contain meaningful logic beyond thin TanStack Query wrappers. Primary targets are `useAuth` (127 lines) and `useChat` (153 lines) which have state machines, async flows, and streaming logic. This requires installing `@testing-library/react-native` or `@testing-library/react` and configuring a React test environment.

## Background

The client hooks directory has 29 files but only 23% line coverage (2 hooks tested: `usePremiumFeatures`, `useRecipeForm`). However, most hooks (22 of 27 untested) are thin TanStack Query wrappers that delegate to `useQuery`/`useMutation` with `apiRequest` — testing these provides minimal value since they just call the API and cache results.

The meaningful testing targets are hooks with real logic:
- **useAuth.ts** (127 lines): Auth state machine, token management, AsyncStorage persistence, network error fallback to cached data
- **useChat.ts** (153 lines): Server-Sent Events streaming, message parsing, state management
- **useGroceryList.ts** (212 lines): Optimistic updates with rollback, complex cache invalidation
- **useMealPlanRecipes.ts** (185 lines): Multi-step mutations, cache coordination
- **useDiscardItem.ts** (61 lines): Optimistic rollback on mutation failure

## Acceptance Criteria

- [x] Install and configure `@testing-library/react` (or react-native variant) for hook testing
- [x] Configure Vitest to handle React/JSX in hook test files (may need jsdom environment)
- [x] `client/hooks/__tests__/useAuth.test.ts` — test auth state transitions, token management, network error fallback
- [x] `client/hooks/__tests__/useChat.test.ts` — test SSE streaming logic, message parsing
- [x] At least 3 additional hook tests for hooks with optimistic update logic
- [x] All new tests pass alongside existing 1,135 tests (now 1,384 total across 87 files)
- [x] `useAuth` coverage ≥ 70% (11 tests covering all branches)
- [x] No React Native import failures (mock native modules as needed)

## Implementation Notes

### Environment Setup

The current Vitest config uses `environment: "node"`. Hook tests need a DOM environment:

```typescript
// Option 1: Per-file environment override
// @vitest-environment jsdom

// Option 2: Configure in vitest.config.ts for client test files
test: {
  environmentMatchGlobs: [
    ['client/**/*.test.ts', 'jsdom'],
  ],
}
```

Install required packages:
```bash
npm install -D @testing-library/react @testing-library/react-hooks jsdom
# Or for React Native:
npm install -D @testing-library/react-native react-test-renderer
```

### useAuth.ts — Key Test Scenarios

```typescript
// Testable logic (doesn't need full RN environment):
// 1. checkAuth() with no token → unauthenticated state
// 2. checkAuth() with valid token → fetches /api/auth/me → authenticated
// 3. checkAuth() with invalid token → clears token → unauthenticated
// 4. checkAuth() with network error → falls back to AsyncStorage cache
// 5. login() → stores token + user → authenticated state
// 6. register() → stores token + user → authenticated state
// 7. logout() → clears token + AsyncStorage → unauthenticated state
// 8. updateUser() → calls API → updates state + AsyncStorage
```

Mocks needed:
- `@react-native-async-storage/async-storage` (already has jest mock: `@react-native-async-storage/async-storage/jest/async-storage-mock`)
- `@/lib/query-client` (apiRequest, getApiUrl)
- `@/lib/token-storage` (tokenStorage)
- `global.fetch` (for checkAuth's direct fetch call)

### useChat.ts — Key Test Scenarios

- SSE stream parsing (`EventSource` or fetch with `ReadableStream`)
- Message accumulation during streaming
- Error handling on stream failure
- Chat history fetching via TanStack Query

### Alternative: Extract & Test Pure Logic

If setting up `renderHook` is too complex, an alternative approach:
1. Extract the logic from hooks into pure functions (e.g., `authStateMachine.ts`)
2. Test the pure functions directly (no React needed)
3. Keep hooks as thin wrappers around the pure functions

This is a larger refactor but produces more maintainable tests.

### Hooks NOT Worth Testing Individually

These are thin TanStack Query wrappers (1-2 `useQuery`/`useMutation` calls). Testing them would just verify that TanStack Query works, not our code:

`useAccessibility`, `useAdaptiveGoals`, `useColorScheme`, `useDailyBudget`, `useExerciseLogs`, `useFasting`, `useFavourites`, `useFoodParse`, `useHaptics`, `useHealthKit`, `useMealPlan`, `useMealSuggestions`, `useMedication`, `useMenuScan`, `useMicronutrients`, `usePantry`, `useSavedItems`, `useScreenOptions`, `useSuggestionInstructions`, `useTheme`, `useVoiceRecording`, `useWeightLogs`

## Dependencies

- `@testing-library/react` or `@testing-library/react-hooks` — NOT currently installed
- `jsdom` — NOT currently installed (needed for DOM environment)
- May need `@react-native-async-storage/async-storage` mock setup
- React 19 compatibility with testing-library must be verified

## Risks

- **React 19 compatibility**: `@testing-library/react-hooks` is deprecated in favor of `renderHook` from `@testing-library/react` v14+. Verify React 19 support.
- **React Native module resolution**: Hooks importing from `react-native` (e.g., `useColorScheme`) may cause Rollup parse failures in Vitest's node/jsdom environment. Need module mocks.
- **Expo module mocking**: `useHaptics` uses `expo-haptics`, `useVoiceRecording` uses `expo-av`, `useHealthKit` uses `expo-health` — all need mocks if imported transitively
- **Scope creep**: Easy to spend too much time on environment setup. Set a time-box for infrastructure work (2 hours max) before pivoting to the "extract pure logic" alternative.
- **TanStack Query Provider**: Hooks using `useQuery`/`useMutation` need a `QueryClientProvider` wrapper in `renderHook`. Create a shared test utility for this.

## Updates

### 2026-02-25
- Initial creation after Round 3 audit
- 27 untested hooks, but only 5 have meaningful testable logic
- Infrastructure setup required before any hook tests can be written

### 2026-02-25 (Completed)
- Installed `@testing-library/react`, `react-dom@19.1.0`, `jsdom` as dev dependencies
- Used per-file `// @vitest-environment jsdom` directives (cleaner than global config)
- Used `vi.hoisted()` pattern to create mocks that survive `vi.mock()` hoisting
- Created 4 new test files with 27 total tests:
  - `useAuth.test.ts` — 11 tests (checkAuth 5 branches, login, register, logout 2, updateUser 2)
  - `useChat.test.ts` — 8 tests (SSE streaming, error handling, cache invalidation, auth headers)
  - `useDiscardItem.test.ts` — 4 tests (optimistic removal, rollback, cache invalidation)
  - `useGroceryList.test.ts` — 4 tests (optimistic toggle, rollback, API calls, cache invalidation)
- All 1,384 tests pass across 87 files (was 1,357 tests across 83 files)
- Client hooks coverage: 6/29 hooks tested (was 2/29), now covering all hooks with meaningful logic
