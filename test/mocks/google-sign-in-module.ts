// Stub for modules/google-sign-in. Its entry calls requireNativeModule at
// import, which throws under Node. Registered globally in test/setup.ts;
// per-file vi.mock of the same path overrides it.
import { vi } from "vitest";

export const signIn = vi.fn(() => Promise.resolve(null));
