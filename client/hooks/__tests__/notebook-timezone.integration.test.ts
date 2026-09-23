// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { useCreateNotebookEntry, useUpdateNotebookEntry } from "../useChat";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import { register } from "../../../server/routes/notebook";
import { storage } from "../../../server/storage";
import { createMockCoachNotebookEntry } from "../../../server/__tests__/factories";

// End-to-end over a real socket: the real hook → the real `apiRequest` → the
// real `fetch` → the real notebook route. The unit tests on either side mock
// the boundary this crosses (`apiRequest` on the client, the HTTP request on
// the server), so they cannot see a header that is set but never
// transmitted. That inference — "the server parses it, so it arrives" — is
// what made PR #901's anchor a no-op. Only the zone source and storage are
// stubbed.

vi.mock("@/lib/token-storage", () => ({
  tokenStorage: { get: vi.fn().mockResolvedValue("test-token") },
}));
vi.mock("@/lib/timezone", () => ({
  getDeviceTimezone: () => "America/Los_Angeles",
}));
vi.mock("../../../server/middleware/auth");
// Reached through the route's import graph, never called by it. The real
// module constructs an OpenAI client, which refuses to run under jsdom.
vi.mock("../../../server/lib/openai", () => ({
  OPENAI_TIMEOUT_FAST_MS: 1,
  OPENAI_TIMEOUT_STREAM_MS: 1,
  OPENAI_TIMEOUT_HEAVY_MS: 1,
  OPENAI_TIMEOUT_IMAGE_MS: 1,
  MODEL_FAST: "stub",
  MODEL_HEAVY: "stub",
  isAiConfigured: false,
  openai: {},
  dalleClient: {},
}));
vi.mock("../../../server/storage", () => ({
  storage: {
    createNotebookEntry: vi.fn(),
    updateNotebookEntry: vi.fn(),
  },
}));

let server: Server;
const originalDomain = process.env.EXPO_PUBLIC_DOMAIN;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  register(app);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  process.env.EXPO_PUBLIC_DOMAIN = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  process.env.EXPO_PUBLIC_DOMAIN = originalDomain;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.mocked(storage.createNotebookEntry).mockResolvedValue(
    createMockCoachNotebookEntry(),
  );
  vi.mocked(storage.updateNotebookEntry).mockResolvedValue(
    createMockCoachNotebookEntry(),
  );
});

// 2026-09-05 is PDT (UTC-7) in Los Angeles, so local midnight is 07:00Z. The
// UTC fallback a missing header produces would be 00:00Z.
describe("notebook follow-up date, client to server", () => {
  it("a manually created entry is anchored at the device zone's midnight", async () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useCreateNotebookEntry(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        type: "commitment",
        content: "Check in",
        followUpDate: "2026-09-05",
      });
    });

    expect(
      vi.mocked(storage.createNotebookEntry).mock.calls[0][0].followUpDate,
    ).toEqual(new Date("2026-09-05T07:00:00.000Z"));
  });

  it("an edited entry is anchored at the device zone's midnight", async () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useUpdateNotebookEntry(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 5, followUpDate: "2026-09-05" });
    });

    expect(
      vi.mocked(storage.updateNotebookEntry).mock.calls[0][2].followUpDate,
    ).toEqual(new Date("2026-09-05T07:00:00.000Z"));
  });
});
