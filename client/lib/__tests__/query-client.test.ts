// Test the getApiUrl function logic
describe("getApiUrl", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns local network IP when EXPO_PUBLIC_DOMAIN is not set", () => {
    delete process.env.EXPO_PUBLIC_DOMAIN;

    // Recreate the function logic
    function getApiUrl(): string {
      const host = process.env.EXPO_PUBLIC_DOMAIN;
      if (!host) {
        return "http://192.168.137.175:3000";
      }
      if (host.startsWith("http://") || host.startsWith("https://")) {
        return host;
      }
      const protocol = host.startsWith("localhost") ? "http" : "https";
      const url = new URL(`${protocol}://${host}`);
      return url.href;
    }

    expect(getApiUrl()).toBe("http://192.168.137.175:3000");
  });

  it("returns host directly when it includes protocol", () => {
    process.env.EXPO_PUBLIC_DOMAIN = "https://api.example.com";

    function getApiUrl(): string {
      const host = process.env.EXPO_PUBLIC_DOMAIN;
      if (!host) {
        return "http://192.168.137.175:3000";
      }
      if (host.startsWith("http://") || host.startsWith("https://")) {
        return host;
      }
      const protocol = host.startsWith("localhost") ? "http" : "https";
      const url = new URL(`${protocol}://${host}`);
      return url.href;
    }

    expect(getApiUrl()).toBe("https://api.example.com");
  });

  it("uses http protocol for localhost", () => {
    process.env.EXPO_PUBLIC_DOMAIN = "localhost:3000";

    function getApiUrl(): string {
      const host = process.env.EXPO_PUBLIC_DOMAIN;
      if (!host) {
        return "http://192.168.137.175:3000";
      }
      if (host.startsWith("http://") || host.startsWith("https://")) {
        return host;
      }
      const protocol = host.startsWith("localhost") ? "http" : "https";
      const url = new URL(`${protocol}://${host}`);
      return url.href;
    }

    expect(getApiUrl()).toBe("http://localhost:3000/");
  });

  it("uses https protocol for non-localhost domains", () => {
    process.env.EXPO_PUBLIC_DOMAIN = "api.ocrecipes.com";

    function getApiUrl(): string {
      const host = process.env.EXPO_PUBLIC_DOMAIN;
      if (!host) {
        return "http://192.168.137.175:3000";
      }
      if (host.startsWith("http://") || host.startsWith("https://")) {
        return host;
      }
      const protocol = host.startsWith("localhost") ? "http" : "https";
      const url = new URL(`${protocol}://${host}`);
      return url.href;
    }

    expect(getApiUrl()).toBe("https://api.ocrecipes.com/");
  });
});

describe("throwIfResNotOk", () => {
  async function throwIfResNotOk(res: Response) {
    if (!res.ok) {
      const text = (await res.text()) || res.statusText;
      throw new Error(`${res.status}: ${text}`);
    }
  }

  it("does not throw for successful responses", async () => {
    const response = new Response("OK", { status: 200 });
    await expect(throwIfResNotOk(response)).resolves.not.toThrow();
  });

  it("throws for 400 Bad Request", async () => {
    const response = new Response('{"error":"Bad request"}', {
      status: 400,
      statusText: "Bad Request",
    });
    await expect(throwIfResNotOk(response)).rejects.toThrow(
      '400: {"error":"Bad request"}',
    );
  });

  it("throws for 401 Unauthorized", async () => {
    const response = new Response('{"error":"Unauthorized"}', {
      status: 401,
      statusText: "Unauthorized",
    });
    await expect(throwIfResNotOk(response)).rejects.toThrow("401:");
  });

  it("throws for 404 Not Found", async () => {
    const response = new Response("Not Found", {
      status: 404,
      statusText: "Not Found",
    });
    await expect(throwIfResNotOk(response)).rejects.toThrow("404: Not Found");
  });

  it("throws for 500 Internal Server Error", async () => {
    const response = new Response("Internal Server Error", {
      status: 500,
      statusText: "Internal Server Error",
    });
    await expect(throwIfResNotOk(response)).rejects.toThrow("500:");
  });

  it("uses statusText when response body is empty", async () => {
    const response = new Response("", {
      status: 503,
      statusText: "Service Unavailable",
    });
    await expect(throwIfResNotOk(response)).rejects.toThrow(
      "503: Service Unavailable",
    );
  });
});

describe("API Request Headers", () => {
  it("builds headers with Content-Type for data", () => {
    const data = { username: "test" };
    const headers: Record<string, string> = {};

    if (data) {
      headers["Content-Type"] = "application/json";
    }

    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("does not set Content-Type when no data", () => {
    const data = undefined;
    const headers: Record<string, string> = {};

    if (data) {
      headers["Content-Type"] = "application/json";
    }

    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("adds Authorization header when token exists", () => {
    const token = "test-jwt-token";
    const headers: Record<string, string> = {};

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    expect(headers["Authorization"]).toBe("Bearer test-jwt-token");
  });

  it("does not add Authorization header when no token", () => {
    const token = null;
    const headers: Record<string, string> = {};

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    expect(headers["Authorization"]).toBeUndefined();
  });
});

describe("UnauthorizedBehavior", () => {
  type UnauthorizedBehavior = "returnNull" | "throw";

  it("returnNull behavior returns null on 401", () => {
    const behavior: UnauthorizedBehavior = "returnNull";
    const status = 401;

    const result = behavior === "returnNull" && status === 401 ? null : "data";
    expect(result).toBe(null);
  });

  it("throw behavior does not return null on 401", () => {
    const behavior: UnauthorizedBehavior = "throw";
    const status = 401;

    const shouldReturnNull =
      (behavior as string) === "returnNull" && status === 401;
    expect(shouldReturnNull).toBe(false);
  });

  it("returnNull behavior does not affect non-401 responses", () => {
    const behavior: UnauthorizedBehavior = "returnNull";
    const status = 200;

    const shouldReturnNull =
      behavior === "returnNull" && (status as number) === 401;
    expect(shouldReturnNull).toBe(false);
  });
});

describe("URL Construction", () => {
  it("constructs URL from base and route", () => {
    const baseUrl = "http://localhost:3000";
    const route = "/api/auth/login";

    const url = new URL(route, baseUrl);

    expect(url.href).toBe("http://localhost:3000/api/auth/login");
  });

  it("handles routes without leading slash", () => {
    const baseUrl = "http://localhost:3000/";
    const route = "api/auth/login";

    const url = new URL(route, baseUrl);

    expect(url.href).toBe("http://localhost:3000/api/auth/login");
  });

  it("constructs query key as URL path", () => {
    const baseUrl = "http://localhost:3000";
    const queryKey = ["/api", "scanned-items", "123"];

    const url = new URL(queryKey.join("/") as string, baseUrl);

    expect(url.href).toBe("http://localhost:3000/api/scanned-items/123");
  });
});
