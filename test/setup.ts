import { vi, beforeEach } from "vitest";

// Mock environment variables for tests
process.env.JWT_SECRET = "test-jwt-secret-for-testing";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});
