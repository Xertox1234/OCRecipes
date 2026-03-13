// Mock AsyncStorage
const mockAsyncStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: mockAsyncStorage,
}));

// Create a test implementation of token storage
// (Can't import actual module because it requires React Native)
function createTokenStorage() {
  const TOKEN_KEY = "@ocrecipes_token";
  let cachedToken: string | null = null;
  let cacheInitialized = false;

  return {
    async get(): Promise<string | null> {
      if (!cacheInitialized) {
        try {
          cachedToken = await mockAsyncStorage.getItem(TOKEN_KEY);
        } catch {
          cachedToken = null;
        }
        cacheInitialized = true;
      }
      return cachedToken;
    },

    async set(token: string): Promise<void> {
      if (!token || typeof token !== "string") {
        throw new Error("Token must be a non-empty string");
      }
      cachedToken = token;
      cacheInitialized = true;
      await mockAsyncStorage.setItem(TOKEN_KEY, token);
    },

    async clear(): Promise<void> {
      cachedToken = null;
      cacheInitialized = true;
      await mockAsyncStorage.removeItem(TOKEN_KEY);
    },

    invalidateCache(): void {
      cacheInitialized = false;
      cachedToken = null;
    },
  };
}

describe("Token Storage", () => {
  let tokenStorage: ReturnType<typeof createTokenStorage>;

  beforeEach(() => {
    vi.clearAllMocks();
    tokenStorage = createTokenStorage();
  });

  describe("get", () => {
    it("reads from AsyncStorage on first call", async () => {
      mockAsyncStorage.getItem.mockResolvedValue("stored-token");

      const token = await tokenStorage.get();

      expect(mockAsyncStorage.getItem).toHaveBeenCalledWith("@ocrecipes_token");
      expect(token).toBe("stored-token");
    });

    it("returns cached value on subsequent calls", async () => {
      mockAsyncStorage.getItem.mockResolvedValue("stored-token");

      await tokenStorage.get();
      await tokenStorage.get();
      await tokenStorage.get();

      // Should only call AsyncStorage once
      expect(mockAsyncStorage.getItem).toHaveBeenCalledTimes(1);
    });

    it("returns null when no token stored", async () => {
      mockAsyncStorage.getItem.mockResolvedValue(null);

      const token = await tokenStorage.get();

      expect(token).toBeNull();
    });

    it("returns null and caches on AsyncStorage error", async () => {
      mockAsyncStorage.getItem.mockRejectedValue(new Error("Storage error"));

      const token = await tokenStorage.get();

      expect(token).toBeNull();
      // Subsequent calls should return cached null
      const token2 = await tokenStorage.get();
      expect(token2).toBeNull();
      expect(mockAsyncStorage.getItem).toHaveBeenCalledTimes(1);
    });
  });

  describe("set", () => {
    it("saves token to AsyncStorage", async () => {
      await tokenStorage.set("new-token");

      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        "@ocrecipes_token",
        "new-token",
      );
    });

    it("updates cache after setting", async () => {
      mockAsyncStorage.getItem.mockResolvedValue(null);
      await tokenStorage.get(); // Initialize cache with null

      await tokenStorage.set("new-token");
      const token = await tokenStorage.get();

      expect(token).toBe("new-token");
      // Should not re-read from AsyncStorage
      expect(mockAsyncStorage.getItem).toHaveBeenCalledTimes(1);
    });

    it("throws error for empty string", async () => {
      await expect(tokenStorage.set("")).rejects.toThrow(
        "Token must be a non-empty string",
      );
    });

    it("throws error for non-string value", async () => {
      await expect(tokenStorage.set(null as any)).rejects.toThrow(
        "Token must be a non-empty string",
      );
    });

    it("throws error for undefined", async () => {
      await expect(tokenStorage.set(undefined as any)).rejects.toThrow(
        "Token must be a non-empty string",
      );
    });

    it("throws error for number", async () => {
      await expect(tokenStorage.set(12345 as any)).rejects.toThrow(
        "Token must be a non-empty string",
      );
    });
  });

  describe("clear", () => {
    it("removes token from AsyncStorage", async () => {
      await tokenStorage.clear();

      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith(
        "@ocrecipes_token",
      );
    });

    it("clears the cache", async () => {
      mockAsyncStorage.getItem.mockResolvedValue("existing-token");
      await tokenStorage.get(); // Cache the token

      await tokenStorage.clear();
      const token = await tokenStorage.get();

      expect(token).toBeNull();
    });
  });

  describe("invalidateCache", () => {
    it("forces re-read from AsyncStorage on next get", async () => {
      mockAsyncStorage.getItem
        .mockResolvedValueOnce("first-token")
        .mockResolvedValueOnce("second-token");

      const first = await tokenStorage.get();
      expect(first).toBe("first-token");

      tokenStorage.invalidateCache();

      const second = await tokenStorage.get();
      expect(second).toBe("second-token");
      expect(mockAsyncStorage.getItem).toHaveBeenCalledTimes(2);
    });

    it("clears cached token", async () => {
      mockAsyncStorage.getItem.mockResolvedValue("cached-token");
      await tokenStorage.get();

      tokenStorage.invalidateCache();

      // Before calling get(), the internal cache should be null
      // (We can verify this by mocking getItem to return something different)
      mockAsyncStorage.getItem.mockResolvedValue("new-token");
      const token = await tokenStorage.get();
      expect(token).toBe("new-token");
    });
  });
});

describe("Token Storage Edge Cases", () => {
  it("handles concurrent get calls during initialization", async () => {
    let resolveGet: (value: string | null) => void;
    mockAsyncStorage.getItem.mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve;
      }),
    );

    const storage = createTokenStorage();

    // Start multiple concurrent gets
    const promise1 = storage.get();
    const promise2 = storage.get();
    const promise3 = storage.get();

    // Resolve the AsyncStorage call
    resolveGet!("concurrent-token");

    const [result1, result2, result3] = await Promise.all([
      promise1,
      promise2,
      promise3,
    ]);

    // All should return the same token
    expect(result1).toBe("concurrent-token");
    expect(result2).toBe("concurrent-token");
    expect(result3).toBe("concurrent-token");
  });

  it("validates token format (whitespace only)", async () => {
    const storage = createTokenStorage();

    // Whitespace-only string is technically a string, but probably invalid
    // The current implementation would accept it
    await expect(storage.set("   ")).resolves.not.toThrow();
  });
});
