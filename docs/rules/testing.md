# Testing Rules

- Every storage function that applies an IDOR ownership filter (`userId` scope) must have a "wrong userId returns undefined/null" test alongside the happy path
- Dual-Assertion IDOR test pattern: (1) assert correct user gets data, (2) assert different user gets nothing — both in the same test suite
- Never mix real and mocked implementations in `vi.mock` of the storage facade — mock all or mock none; partial mocks hide coupling
- Tests that verify a rate limiter must call the endpoint N+1 times and assert the (N+1)th call returns 429
- RN component render tests use `// @vitest-environment jsdom` + `@testing-library/react` (web variant) + the `renderComponent` helper — never `@testing-library/react-native`; the `react-native` → DOM-mock alias in `vitest.config.ts` makes `fireEvent.click` / `screen.getByRole` correct
- When a test file mocks an early-breaking paged/cursor loop with `mockResolvedValueOnce` chains, use `vi.resetAllMocks()` (not `vi.clearAllMocks()`) in `beforeEach` — `clearAllMocks` does NOT drain the once-queue, so an unconsumed trailing page leaks into later tests. Re-seed any `vi.mock` factory-set return values after `resetAllMocks()`
