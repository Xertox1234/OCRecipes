// Mock @sentry/react-native for tests. Prevents native module resolution.
import { vi } from "vitest";

export const init = vi.fn();
export const captureException = vi.fn();
export const captureMessage = vi.fn();
export const addBreadcrumb = vi.fn();
export const withScope = vi.fn((cb: (scope: unknown) => void) => cb({}));
export const wrap = vi.fn((component: unknown) => component);
