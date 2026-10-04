import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory stand-ins for the two native stores. The module under test keeps a
// module-level cache, so each test re-imports it fresh (see loadTokenStorage).
const { secure, asyncStore, secureMock, asyncMock } = vi.hoisted(() => {
  const secure = new Map<string, string>();
  const asyncStore = new Map<string, string>();
  const secureMock = {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 3,
    getItemAsync: vi.fn(async (key: string) => secure.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      secure.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      secure.delete(key);
    }),
  };
  const asyncMock = {
    getItem: vi.fn(async (key: string) => asyncStore.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      asyncStore.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      asyncStore.delete(key);
    }),
  };
  return { secure, asyncStore, secureMock, asyncMock };
});

vi.mock("expo-secure-store", () => secureMock);
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: asyncMock,
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const SECURE_KEY = "ocrecipes_token";
const LEGACY_KEY = "@ocrecipes_token";
const MARKER_KEY = "@ocrecipes_install_marker";
const SECURE_OPTIONS = { keychainAccessible: 3 };

async function loadTokenStorage() {
  vi.resetModules();
  const mod = await import("@/lib/token-storage");
  return mod.tokenStorage;
}

beforeEach(() => {
  secure.clear();
  asyncStore.clear();
  vi.clearAllMocks();
});

describe("tokenStorage.get — moving an existing token to the Keychain", () => {
  it("moves a token saved by the old version into secure storage", async () => {
    asyncStore.set(LEGACY_KEY, "legacy-token");
    const tokenStorage = await loadTokenStorage();

    expect(await tokenStorage.get()).toBe("legacy-token");
    expect(secureMock.setItemAsync).toHaveBeenCalledWith(
      SECURE_KEY,
      "legacy-token",
      SECURE_OPTIONS,
    );
    expect(secure.get(SECURE_KEY)).toBe("legacy-token");
    expect(asyncStore.has(LEGACY_KEY)).toBe(false);
    expect(asyncStore.has(MARKER_KEY)).toBe(true);
  });

  it("keeps the old copy when the secure write fails, and still signs in", async () => {
    asyncStore.set(LEGACY_KEY, "legacy-token");
    secureMock.setItemAsync.mockRejectedValueOnce(new Error("keychain"));
    const tokenStorage = await loadTokenStorage();

    expect(await tokenStorage.get()).toBe("legacy-token");
    expect(asyncStore.get(LEGACY_KEY)).toBe("legacy-token");
  });
});

describe("tokenStorage.get — fresh install", () => {
  it("drops a Keychain token left behind by a deleted copy of the app", async () => {
    // iOS keeps Keychain items after the app is deleted; AsyncStorage is wiped.
    secure.set(SECURE_KEY, "token-from-previous-install");
    const tokenStorage = await loadTokenStorage();

    expect(await tokenStorage.get()).toBeNull();
    expect(secure.has(SECURE_KEY)).toBe(false);
    expect(asyncStore.has(MARKER_KEY)).toBe(true);
  });

  it("tries the drop again next launch when the Keychain delete fails", async () => {
    // Writing the marker after a failed delete would make the next launch trust
    // the stale token and sign in as the previous install's account.
    secure.set(SECURE_KEY, "token-from-previous-install");
    secureMock.deleteItemAsync.mockRejectedValueOnce(new Error("keychain"));
    const tokenStorage = await loadTokenStorage();

    expect(await tokenStorage.get()).toBeNull();
    expect(asyncStore.has(MARKER_KEY)).toBe(false);

    const nextLaunch = await loadTokenStorage();
    expect(await nextLaunch.get()).toBeNull();
    expect(secure.has(SECURE_KEY)).toBe(false);
  });

  it("reads the Keychain once the install has been seen before", async () => {
    asyncStore.set(MARKER_KEY, "1");
    secure.set(SECURE_KEY, "current-token");
    const tokenStorage = await loadTokenStorage();

    expect(await tokenStorage.get()).toBe("current-token");
    expect(secureMock.getItemAsync).toHaveBeenCalledWith(
      SECURE_KEY,
      SECURE_OPTIONS,
    );
    expect(secureMock.deleteItemAsync).not.toHaveBeenCalled();
  });

  it("does not wipe the Keychain when AsyncStorage cannot be read", async () => {
    secure.set(SECURE_KEY, "current-token");
    asyncMock.getItem.mockRejectedValueOnce(new Error("async storage down"));
    asyncMock.getItem.mockRejectedValueOnce(new Error("async storage down"));
    const tokenStorage = await loadTokenStorage();

    expect(await tokenStorage.get()).toBe("current-token");
    expect(secureMock.deleteItemAsync).not.toHaveBeenCalled();
  });
});

describe("tokenStorage.get — caching and failures", () => {
  it("reads the stores once, then serves the cached token", async () => {
    asyncStore.set(MARKER_KEY, "1");
    secure.set(SECURE_KEY, "current-token");
    const tokenStorage = await loadTokenStorage();

    await tokenStorage.get();
    await tokenStorage.get();
    expect(await tokenStorage.get()).toBe("current-token");
    expect(secureMock.getItemAsync).toHaveBeenCalledTimes(1);
  });

  it("shares one read between concurrent first calls", async () => {
    asyncStore.set(MARKER_KEY, "1");
    secure.set(SECURE_KEY, "current-token");
    const tokenStorage = await loadTokenStorage();

    const results = await Promise.all([
      tokenStorage.get(),
      tokenStorage.get(),
      tokenStorage.get(),
    ]);
    expect(results).toEqual([
      "current-token",
      "current-token",
      "current-token",
    ]);
    expect(secureMock.getItemAsync).toHaveBeenCalledTimes(1);
  });

  it("returns null on a Keychain read error without caching it, so the next call retries", async () => {
    asyncStore.set(MARKER_KEY, "1");
    secure.set(SECURE_KEY, "current-token");
    secureMock.getItemAsync.mockRejectedValueOnce(new Error("locked"));
    const tokenStorage = await loadTokenStorage();

    expect(await tokenStorage.get()).toBeNull();
    expect(await tokenStorage.get()).toBe("current-token");
  });
});

describe("tokenStorage.set", () => {
  it("writes to the Keychain and never to AsyncStorage", async () => {
    const tokenStorage = await loadTokenStorage();

    await tokenStorage.set("new-token");

    expect(secureMock.setItemAsync).toHaveBeenCalledWith(
      SECURE_KEY,
      "new-token",
      SECURE_OPTIONS,
    );
    expect(asyncStore.has(LEGACY_KEY)).toBe(false);
    expect(asyncStore.has(MARKER_KEY)).toBe(true);
    expect(await tokenStorage.get()).toBe("new-token");
  });

  it("keeps a token set while the first read is still running", async () => {
    // Fresh install: the first read is about to delete a stale Keychain item.
    // A login that lands mid-read must not be deleted or overwritten by it.
    secure.set(SECURE_KEY, "token-from-previous-install");
    let releaseRead!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    asyncMock.getItem.mockImplementationOnce(async (key: string) => {
      await gate;
      return asyncStore.get(key) ?? null;
    });
    const tokenStorage = await loadTokenStorage();

    const firstRead = tokenStorage.get();
    const login = tokenStorage.set("fresh-login");
    releaseRead();
    await Promise.all([firstRead, login]);

    expect(secure.get(SECURE_KEY)).toBe("fresh-login");
    expect(await tokenStorage.get()).toBe("fresh-login");
  });

  it("keeps a token when the first read starts in the same tick, right after set()", async () => {
    // set() must not pause before claiming the cache: a get() started in that
    // pause would run the fresh-install delete over the new login.
    secure.set(SECURE_KEY, "token-from-previous-install");
    const tokenStorage = await loadTokenStorage();

    const login = tokenStorage.set("fresh-login");
    const read = tokenStorage.get();
    await Promise.all([login, read]);

    expect(await tokenStorage.get()).toBe("fresh-login");
    expect(secure.get(SECURE_KEY)).toBe("fresh-login");
  });

  it("stays logged out when the first read starts in the same tick, right after clear()", async () => {
    asyncStore.set(MARKER_KEY, "1");
    secure.set(SECURE_KEY, "current-token");
    // Hold the delete until the next macrotask, so a read that slipped in
    // first would see (and cache) the token the logout is removing.
    secureMock.deleteItemAsync.mockImplementationOnce(
      (key: string) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            secure.delete(key);
            resolve();
          }, 0);
        }),
    );
    const tokenStorage = await loadTokenStorage();

    const logout = tokenStorage.clear();
    const read = tokenStorage.get();
    await Promise.all([logout, read]);

    expect(await tokenStorage.get()).toBeNull();
    expect(secure.has(SECURE_KEY)).toBe(false);
  });

  it("removes an old copy, so the next launch cannot swap it back in", async () => {
    // A move that failed part-way leaves the old AsyncStorage copy behind; a
    // later login must not let that older token win on the next cold start.
    asyncStore.set(MARKER_KEY, "1");
    asyncStore.set(LEGACY_KEY, "older-token");
    const tokenStorage = await loadTokenStorage();

    await tokenStorage.set("newer-token");
    const nextLaunch = await loadTokenStorage();

    expect(await nextLaunch.get()).toBe("newer-token");
  });

  it("leaves the install unmarked when a fresh-install login cannot be saved", async () => {
    // The stale-token drop failed and this login's write failed too: a marker
    // written now would make the next launch sign in as the previous install.
    secure.set(SECURE_KEY, "token-from-previous-install");
    secureMock.deleteItemAsync.mockRejectedValueOnce(new Error("keychain"));
    secureMock.setItemAsync.mockRejectedValueOnce(new Error("keychain"));
    const tokenStorage = await loadTokenStorage();
    await tokenStorage.get();

    await tokenStorage.set("fresh-login");
    const nextLaunch = await loadTokenStorage();

    expect(await nextLaunch.get()).toBeNull();
  });

  it("keeps the session when the Keychain write fails", async () => {
    secureMock.setItemAsync.mockRejectedValueOnce(new Error("keychain"));
    const tokenStorage = await loadTokenStorage();

    await expect(tokenStorage.set("new-token")).resolves.toBeUndefined();
    expect(await tokenStorage.get()).toBe("new-token");
  });

  it.each([[""], [null], [undefined], [12345]])("rejects %p", async (value) => {
    const tokenStorage = await loadTokenStorage();
    await expect(tokenStorage.set(value as unknown as string)).rejects.toThrow(
      "Token must be a non-empty string",
    );
  });
});

describe("tokenStorage.clear", () => {
  it("removes the token from the Keychain and any old copy", async () => {
    asyncStore.set(MARKER_KEY, "1");
    asyncStore.set(LEGACY_KEY, "legacy-token");
    secure.set(SECURE_KEY, "current-token");
    const tokenStorage = await loadTokenStorage();

    await tokenStorage.clear();

    expect(secure.has(SECURE_KEY)).toBe(false);
    expect(asyncStore.has(LEGACY_KEY)).toBe(false);
    expect(await tokenStorage.get()).toBeNull();
  });

  it("logs the session out even when the Keychain delete fails", async () => {
    asyncStore.set(MARKER_KEY, "1");
    secure.set(SECURE_KEY, "current-token");
    secureMock.deleteItemAsync.mockRejectedValueOnce(new Error("keychain"));
    const tokenStorage = await loadTokenStorage();

    await expect(tokenStorage.clear()).resolves.toBeUndefined();
    expect(await tokenStorage.get()).toBeNull();
  });
});

describe("tokenStorage.invalidateCache", () => {
  it("makes the next get read the Keychain again", async () => {
    asyncStore.set(MARKER_KEY, "1");
    secure.set(SECURE_KEY, "first-token");
    const tokenStorage = await loadTokenStorage();
    expect(await tokenStorage.get()).toBe("first-token");

    secure.set(SECURE_KEY, "second-token");
    tokenStorage.invalidateCache();

    expect(await tokenStorage.get()).toBe("second-token");
  });
});
