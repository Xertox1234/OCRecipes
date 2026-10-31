import { describe, it, expect, vi, beforeEach } from "vitest";

const getPermissionsAsync = vi.fn();
const requestPermissionsAsync = vi.fn();
const getExpoPushTokenAsync = vi.fn();
const removeTokenListener = vi.fn();
const addPushTokenListener = vi.fn((_listener: () => void) => ({
  remove: removeTokenListener,
}));
vi.mock("expo-notifications", () => ({
  getPermissionsAsync: () => getPermissionsAsync(),
  requestPermissionsAsync: () => requestPermissionsAsync(),
  getExpoPushTokenAsync: (...args: unknown[]) => getExpoPushTokenAsync(...args),
  addPushTokenListener: (listener: () => void) =>
    addPushTokenListener(listener),
}));

const apiRequest = vi.fn();
vi.mock("../query-client", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

// PROJECT_ID is read at module load, so stub it before importing.
vi.stubEnv("EXPO_PUBLIC_PROJECT_ID", "proj-1");
const { unregisterPushToken, registerPushToken, subscribePushTokenRotation } =
  await import("../push-token-registration");

describe("unregisterPushToken (auth audit H2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getExpoPushTokenAsync.mockResolvedValue({ data: "ExponentPushToken[x]" });
    apiRequest.mockResolvedValue({});
  });

  it("deletes this device's token from the signed-in account", async () => {
    getPermissionsAsync.mockResolvedValue({ status: "granted" });
    await unregisterPushToken();
    expect(apiRequest).toHaveBeenCalledWith("DELETE", "/api/push-tokens", {
      token: "ExponentPushToken[x]",
    });
  });

  it("never prompts for permission and skips when it was not granted", async () => {
    getPermissionsAsync.mockResolvedValue({ status: "denied" });
    await unregisterPushToken();
    expect(requestPermissionsAsync).not.toHaveBeenCalled();
    expect(getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("never throws — sign-out must continue if the request fails", async () => {
    getPermissionsAsync.mockResolvedValue({ status: "granted" });
    apiRequest.mockRejectedValue(new Error("offline"));
    await expect(unregisterPushToken()).resolves.toBeUndefined();
  });

  it("gives up after 3 s so a hung network never stalls sign-out", async () => {
    vi.useFakeTimers();
    try {
      getPermissionsAsync.mockResolvedValue({ status: "granted" });
      getExpoPushTokenAsync.mockReturnValue(new Promise(() => {}));
      const done = vi.fn();
      void unregisterPushToken().then(done);
      await vi.advanceTimersByTimeAsync(2999);
      expect(done).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // A DELETE that fires after the cap would carry whatever session token is
  // stored THEN — after a new sign-in, the next user's — and remove their row.
  it("never sends the DELETE once the cap has fired", async () => {
    vi.useFakeTimers();
    try {
      getPermissionsAsync.mockResolvedValue({ status: "granted" });
      let resolveToken!: (v: { data: string }) => void;
      getExpoPushTokenAsync.mockReturnValue(
        new Promise((r) => {
          resolveToken = r;
        }),
      );
      void unregisterPushToken();
      await vi.advanceTimersByTimeAsync(3000);
      resolveToken({ data: "ExponentPushToken[late]" });
      await vi.advanceTimersByTimeAsync(0);
      expect(apiRequest).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("registerPushToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getExpoPushTokenAsync.mockResolvedValue({ data: "ExponentPushToken[x]" });
    apiRequest.mockResolvedValue({});
  });

  it("asks for permission by default (sign-in)", async () => {
    getPermissionsAsync.mockResolvedValue({ status: "undetermined" });
    requestPermissionsAsync.mockResolvedValue({ status: "granted" });

    expect(await registerPushToken()).toBe("ExponentPushToken[x]");
    expect(requestPermissionsAsync).toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/push-tokens",
      expect.objectContaining({ token: "ExponentPushToken[x]" }),
    );
  });

  it("with prompt: false, never asks and skips when not already granted", async () => {
    getPermissionsAsync.mockResolvedValue({ status: "undetermined" });

    expect(await registerPushToken({ prompt: false })).toBeNull();
    expect(requestPermissionsAsync).not.toHaveBeenCalled();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("with prompt: false, registers when permission is already granted", async () => {
    getPermissionsAsync.mockResolvedValue({ status: "granted" });

    expect(await registerPushToken({ prompt: false })).toBe(
      "ExponentPushToken[x]",
    );
    expect(requestPermissionsAsync).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/push-tokens",
      expect.objectContaining({ token: "ExponentPushToken[x]" }),
    );
  });
});

describe("subscribePushTokenRotation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getExpoPushTokenAsync.mockResolvedValue({ data: "ExponentPushToken[new]" });
    apiRequest.mockResolvedValue({});
  });

  it("re-registers (without prompting) when the push token rotates", async () => {
    getPermissionsAsync.mockResolvedValue({ status: "granted" });
    const unsubscribe = subscribePushTokenRotation();

    expect(addPushTokenListener).toHaveBeenCalledTimes(1);
    const listener = addPushTokenListener.mock.calls[0][0];
    listener();
    await vi.waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/push-tokens",
        expect.objectContaining({ token: "ExponentPushToken[new]" }),
      ),
    );
    expect(requestPermissionsAsync).not.toHaveBeenCalled();

    unsubscribe();
    expect(removeTokenListener).toHaveBeenCalledTimes(1);
  });
});
