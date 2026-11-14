// Default `expo-file-system/legacy` for tests (vitest alias). The real module
// loads expo-modules-core, which cannot be imported under Vitest — and the
// sign-out wipe (client/hooks/auth-session.ts → @/lib/device-leftovers) now
// reaches it, so every test that loads the real auth code would fail at
// collection without this.
//
// Inert on purpose: no cache folder (the web shape), nothing listed, every
// call resolves. A test that cares about file calls still mocks the module
// itself with vi.mock("expo-file-system/legacy", …), which wins over the alias.
export const cacheDirectory: string | null = null;
export const documentDirectory: string | null = null;
export const EncodingType = { UTF8: "utf8", Base64: "base64" } as const;
export const FileSystemUploadType = {
  BINARY_CONTENT: 0,
  MULTIPART: 1,
} as const;

export const readDirectoryAsync = (): Promise<string[]> => Promise.resolve([]);
export const deleteAsync = (): Promise<void> => Promise.resolve();
export const writeAsStringAsync = (): Promise<void> => Promise.resolve();
export const getInfoAsync = () => Promise.resolve({ exists: false as const });
export const uploadAsync = () =>
  Promise.resolve({ status: 200, body: "", headers: {} });
