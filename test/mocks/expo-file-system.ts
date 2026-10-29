// Shared `expo-file-system` mock for upload tests. `expo/fetch` only serializes
// FormData parts that are strings, Blobs, or objects with `bytes()`; jsdom's
// FormData stringifies anything, so tests assert the part is a mock `File`.
// Use via: vi.mock("expo-file-system", () => import("<rel>/test/mocks/expo-file-system"))
// (not a vitest alias: that would also capture `expo-file-system/legacy`).
export class File {
  type: string | null = "image/jpeg";
  constructor(public uri: string) {}
  bytes = async () => new Uint8Array();
}
