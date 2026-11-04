import { getDeviceTimezone, sendDeviceTimezoneOnce } from "../timezone";

const { mockStore, mockApiRequest } = vi.hoisted(() => ({
  mockStore: {} as Record<string, string>,
  mockApiRequest: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((k: string) => Promise.resolve(mockStore[k] ?? null)),
    setItem: vi.fn((k: string, v: string) => {
      mockStore[k] = v;
      return Promise.resolve();
    }),
  },
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

describe("getDeviceTimezone", () => {
  it("returns the resolved IANA timezone when available", () => {
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
      resolvedOptions: () => ({ timeZone: "America/Los_Angeles" }),
    } as unknown as Intl.DateTimeFormat);

    expect(getDeviceTimezone()).toBe("America/Los_Angeles");

    spy.mockRestore();
  });

  it('falls back to "UTC" when timezone resolution throws', () => {
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("Intl unavailable");
    });

    expect(getDeviceTimezone()).toBe("UTC");

    spy.mockRestore();
  });
});

describe("sendDeviceTimezoneOnce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStore).forEach((k) => delete mockStore[k]);
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
      resolvedOptions: () => ({ timeZone: "Europe/Berlin" }),
    } as unknown as Intl.DateTimeFormat);
  });
  afterEach(() => vi.restoreAllMocks());

  it("sends the device timezone via the profile update", async () => {
    mockApiRequest.mockResolvedValue({});
    await sendDeviceTimezoneOnce("u1");
    expect(mockApiRequest).toHaveBeenCalledWith("PUT", "/api/auth/profile", {
      timezone: "Europe/Berlin",
    });
  });

  it("does not re-send once a send succeeded", async () => {
    mockApiRequest.mockResolvedValue({});
    await sendDeviceTimezoneOnce("u1");
    await sendDeviceTimezoneOnce("u1");
    expect(mockApiRequest).toHaveBeenCalledTimes(1);
  });

  it("sends separately for a different user on the same phone", async () => {
    mockApiRequest.mockResolvedValue({});
    await sendDeviceTimezoneOnce("u1");
    await sendDeviceTimezoneOnce("u2");
    expect(mockApiRequest).toHaveBeenCalledTimes(2);
  });

  it("swallows a failure and retries on the next call", async () => {
    mockApiRequest.mockRejectedValueOnce(new Error("offline"));
    await expect(sendDeviceTimezoneOnce("u1")).resolves.toBeUndefined();
    mockApiRequest.mockResolvedValue({});
    await sendDeviceTimezoneOnce("u1");
    expect(mockApiRequest).toHaveBeenCalledTimes(2);
  });
});
