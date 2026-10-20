// Load .env so integration tests can connect to the real dev database
import "dotenv/config";

import {
  impactAsync,
  notificationAsync,
  selectionAsync,
} from "./mocks/expo-haptics";
import { signIn as googleSignIn } from "./mocks/google-sign-in-module";
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

// supertest's request(app) listens on the wildcard address, then connects to
// 127.0.0.1. On macOS another process can hold 127.0.0.1 on that same port, and
// the request lands on its server instead (a stray 401/403, or a rate-limit hit
// that never counts). Linux refuses the second bind, so CI never sees it. Bind
// 127.0.0.1 itself, which the kernel will not share. listen() with a host only
// settles asynchronously, so the bind moves out of serverAddress() (sync, runs
// in the constructor) into end(), which every await/.then/.end() goes through.
// Written against supertest 7.2.2; test/supertest-loopback.test.ts is the canary.
// See docs/solutions/runtime-errors/supertest-per-request-listener-reaches-foreign-server-on-macos-2026-10-20.md
const http = process.getBuiltinModule("node:http");
type EndCallback = (err: unknown, res?: unknown) => void;
type SupertestTest = {
  url: string;
  _server?: import("node:http").Server;
  _loopback?: { app: import("node:http").Server; path: string };
};
const supertestProto = nodeRequire("supertest").Test.prototype;
const originalServerAddress = supertestProto.serverAddress;
const originalEnd = supertestProto.end;
if (
  typeof originalServerAddress !== "function" ||
  typeof originalEnd !== "function"
) {
  throw new Error(
    "test/setup.ts: supertest's Test.serverAddress/end changed — revisit the 127.0.0.1 bind patch",
  );
}
supertestProto.serverAddress = function (
  this: SupertestTest,
  app: unknown,
  path: string,
) {
  // Leave https/http2 servers and already-listening servers to supertest.
  if (!(app instanceof http.Server) || app.address()) {
    return originalServerAddress.call(this, app, path);
  }
  this._loopback = { app, path };
  return `http://127.0.0.1${path}`; // placeholder; end() sets the real port
};
supertestProto.end = function (this: SupertestTest, fn?: EndCallback) {
  const pending = this._loopback;
  if (!pending) return originalEnd.call(this, fn);
  this._loopback = undefined;
  const { app, path } = pending;
  const onError = (err: Error) => fn?.(err);
  app.once("error", onError);
  app.listen(0, "127.0.0.1", () => {
    app.off("error", onError);
    const { port } = app.address() as import("node:net").AddressInfo;
    this.url = `http://127.0.0.1:${port}${path}`;
    this._server = app; // supertest's end() closes it after the response
    originalEnd.call(this, fn);
  });
  return this;
};

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
});

// modules/google-sign-in calls requireNativeModule at import (throws under
// Node). Reached via @/lib/social-sign-in <- useAuth <- AuthContext.
vi.mock(
  "../modules/google-sign-in",
  () => import("./mocks/google-sign-in-module"),
);
