/**
 * Vitest stub for @sentry/node, aliased in vitest.config.ts.
 *
 * Not for native-module isolation (the @sentry/react-native mock's reason) —
 * @sentry/node is pure JS but costs ~500ms to import (it pulls the OTel
 * instrumentation tree), and server/routes/_helpers.ts imports
 * server/lib/error-reporter.ts, which would make every route test file pay
 * that import. The reporter is inactive in tests anyway (NODE_ENV gate).
 *
 * server/lib/__tests__/error-reporter.test.ts supplies its own vi.mock
 * factory, which takes precedence over this alias.
 */
import { vi } from "vitest";

export const init = vi.fn();
export const captureException = vi.fn();
export const captureMessage = vi.fn();
export const flush = vi.fn(() => Promise.resolve(true));
export const setupExpressErrorHandler = vi.fn();
export const httpIntegration = vi.fn(() => ({ name: "Http" }));
export const onUncaughtExceptionIntegration = vi.fn(() => ({
  name: "OnUncaughtException",
}));
