# Testing Rules

- Every storage function that applies an IDOR ownership filter (`userId` scope) must have a "wrong userId returns undefined/null" test alongside the happy path
- Dual-Assertion IDOR test pattern: (1) assert correct user gets data, (2) assert different user gets nothing — both in the same test suite
- Never mix real and mocked implementations in `vi.mock` of the storage facade — mock all or mock none; partial mocks hide coupling
- Tests that verify a rate limiter must call the endpoint N+1 times and assert the (N+1)th call returns 429
- Storage functions that read a whole table with no user/transaction filter (e.g. search-index seed loaders) cannot have a meaningful "returns empty" negative test — committed dev-DB rows are visible even inside a rolled-back test transaction; test only the happy path (assert the seeded row is present) or assert the result does not contain the test's own seeded id
