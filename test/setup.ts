// Load .env so integration tests can connect to the real dev database
import "dotenv/config";

import {
  impactAsync,
  notificationAsync,
  selectionAsync,
} from "./mocks/expo-haptics";
import { signIn as googleSignIn } from "./mocks/google-sign-in-module";
import { clearImportBrowserData } from "./mocks/webview-site-data-module";
import { useReducedMotion } from "./mocks/react-native-reanimated";

// node:module must NOT be a static import here: under a shell-exported
// NODE_ENV=production, vite processes this file with browser conditions and
// externalizes the builtin into a stub that crashes collection with "No such
// built-in module: node:". process.getBuiltinModule (Node ≥22.3) resolves it
// at runtime, invisible to vite's static analysis. See
// docs/solutions/runtime-errors/shell-node-env-production-breaks-vitest-jsdom-2026-07-17.md
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

// supertest's request(app) used to listen on the wildcard address and connect to
// 127.0.0.1; on macOS another process holding 127.0.0.1 on that port answered
// instead. supertest 7.3 binds 127.0.0.1 itself (lib/test.js holdServer), so
// the prototype patch that lived here is gone — it broke on 7.3's lazy server
// start. test/supertest-loopback.test.ts stays as the canary for the bind.
// See docs/solutions/runtime-errors/supertest-per-request-listener-reaches-foreign-server-on-macos-2026-10-20.md

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
  googleSignIn.mockReset();
  clearImportBrowserData.mockReset();
});

// modules/google-sign-in calls requireNativeModule at import (throws under
// Node). Reached via @/lib/social-sign-in <- useAuth <- AuthContext.
vi.mock(
  "../modules/google-sign-in",
  () => import("./mocks/google-sign-in-module"),
);
// modules/webview-site-data imports the real `expo` entry; stub it. Reached via
// the clearDurableLocalState sweep <- useAuth <- AuthContext.
vi.mock(
  "../modules/webview-site-data",
  () => import("./mocks/webview-site-data-module"),
);
