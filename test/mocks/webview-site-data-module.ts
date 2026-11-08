// Stub for modules/webview-site-data, so tests never load the real `expo`
// entry its index imports. Registered globally in test/setup.ts; per-file
// vi.mock of the same path overrides it (e.g. to drive the failure path).
import { vi } from "vitest";

export const clearImportBrowserData = vi.fn(() => Promise.resolve(true));
