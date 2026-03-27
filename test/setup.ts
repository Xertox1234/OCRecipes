// Load .env so integration tests can connect to the real dev database
import "dotenv/config";

// Guard against accidentally running tests on a production database
const dbUrl = process.env.DATABASE_URL;
if (
  dbUrl &&
  !dbUrl.includes("localhost") &&
  !dbUrl.includes("127.0.0.1") &&
  !dbUrl.includes("_test") &&
  !dbUrl.includes("_dev")
) {
  throw new Error(
    "Refusing to run tests against a non-local database. " +
      `DATABASE_URL points to: ${dbUrl.replace(/\/\/.*@/, "//***@")}. ` +
      "Set DATABASE_URL to a local dev/test database.",
  );
}

// Ensure JWT_SECRET is always set for auth-related tests
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-jwt-secret-for-testing-minimum-32chars";

// React Native expects __DEV__ to be defined globally
(globalThis as Record<string, unknown>).__DEV__ = true;

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});
