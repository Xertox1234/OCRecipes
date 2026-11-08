// Stub for modules/webview-site-data. Under Node the native module is absent,
// so the real wrapper would report every sign-out wipe as failed. Registered
// globally in test/setup.ts; per-file vi.mock of the same path overrides it.
import { vi } from "vitest";

export const clearImportBrowserData = vi.fn(() => Promise.resolve(true));
