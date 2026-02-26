// Mock environment variables for tests
process.env.JWT_SECRET = "test-jwt-secret-for-testing";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

// React Native expects __DEV__ to be defined globally
(globalThis as Record<string, unknown>).__DEV__ = true;

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});
