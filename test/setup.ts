// Load .env so integration tests can connect to the real dev database
import "dotenv/config";

import {
  impactAsync,
  notificationAsync,
  selectionAsync,
} from "./mocks/expo-haptics";
import { useReducedMotion } from "./mocks/react-native-reanimated";

// node:module must NOT be a static import here: under the jsdom environment
// vite processes this file with browser conditions and externalizes the
// builtin into a stub that crashes collection with "No such built-in module:
// node:". process.getBuiltinModule (Node ≥22.3) resolves it at runtime,
// invisible to vite's static analysis. See
// docs/solutions/runtime-errors/vitest-collection-crash-transient-contention-2026-07-16.md
const { createRequire } = process.getBuiltinModule("node:module");

// Stub binary static assets (images/fonts) so components that `require(...)` them
// (e.g. `<Image source={require("...png")} />`) can render under jsdom. vite-node
// executes those requires through Node's native `require` (createRequire), which
// bypasses Vite's resolver, aliases, and plugins — so the hook must live at the
// Node module-loader layer. Returns a numeric handle, mirroring Metro's bundler.
const nodeRequire = createRequire(import.meta.url);
for (const ext of [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
]) {
  nodeRequire.extensions[ext] = (module) => {
    module.exports = 1;
  };
}

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

// Silence pino output during tests
process.env.LOG_LEVEL = "silent";

// Ensure JWT_SECRET is always set for auth-related tests
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-jwt-secret-for-testing-minimum-32chars";

// React Native expects __DEV__ to be defined globally
(globalThis as Record<string, unknown>).__DEV__ = true;

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();

  // The mocks under test/mocks/ are module singletons — imported once per
  // worker and shared by every test in that worker. `vi.clearAllMocks()`
  // clears call history only, so a test that overrides one of these
  // singletons with `.mockImplementation()` / `.mockReturnValue()` /
  // `.mockResolvedValueOnce()` would leak that override into later tests in
  // the same worker file. `.mockReset()` additionally restores each mock's
  // `vi.fn(impl)` constructor-arg default (no-op resolved promise for the
  // haptics fns, `() => false` for useReducedMotion). This is scoped to the
  // test/mocks/ singletons on purpose — a global `mockReset: true` would also
  // wipe the `vi.fn().mockResolvedValue(...)` defaults set inside per-file
  // `vi.mock()` factory bodies, which those tests rely on.
  impactAsync.mockReset();
  notificationAsync.mockReset();
  selectionAsync.mockReset();
  useReducedMotion.mockReset();
});
