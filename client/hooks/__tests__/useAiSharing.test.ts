import { QueryClient } from "@tanstack/react-query";

import {
  AI_SHARING_READ_TIMEOUT_MS,
  aiSharingQueryOptions,
} from "../useAiSharing";

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));
vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

// The root navigator holds its opening spinner on this read (privacy audit
// H3), so it must give up quickly instead of retrying a server that is down.
describe("aiSharingQueryOptions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockApiRequest.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not retry", () => {
    expect(aiSharingQueryOptions.retry).toBe(false);
  });

  it("gives up after a short deadline when the server hangs", async () => {
    mockApiRequest.mockImplementation(
      (_m: string, _r: string, _d: unknown, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const client = new QueryClient();

    const read = client.fetchQuery(aiSharingQueryOptions);
    const settled = expect(read).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(AI_SHARING_READ_TIMEOUT_MS);
    await settled;
  });

  it("returns the status when the server answers", async () => {
    mockApiRequest.mockResolvedValue({
      json: async () => ({ allowed: true, answered: true }),
    });

    await expect(
      new QueryClient().fetchQuery(aiSharingQueryOptions),
    ).resolves.toEqual({ allowed: true, answered: true });
  });
});
