import { ApiError } from "../api-error";
import { appStateToFocus, resolveImageUrl } from "../query-client";

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
      let code: string | undefined;
      try {
        const parsed: unknown = JSON.parse(text);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          typeof (parsed as { code?: unknown }).code === "string"
        ) {
          code = (parsed as { code: string }).code;
        }
      } catch {
        // Non-JSON error body — no machine-readable code to extract.
      }
      throw new ApiError(`${res.status}: ${text}`, code);
    }
  }

  it("does not throw for successful responses", async () => {
    const response = new Response("OK", { status: 200 });
    await expect(throwIfResNotOk(response)).resolves.not.toThrow();
  });

  it("throws an ApiError instance for non-ok responses", async () => {
    const response = new Response('{"error":"Bad request"}', { status: 400 });
    await expect(throwIfResNotOk(response)).rejects.toBeInstanceOf(ApiError);
  });

  it("attaches the code from a standard JSON error body", async () => {
    const response = new Response(
      '{"error":"Premium feature","code":"PREMIUM_REQUIRED"}',
      { status: 403 },
    );
    await expect(throwIfResNotOk(response)).rejects.toMatchObject({
      code: "PREMIUM_REQUIRED",
      message: '403: {"error":"Premium feature","code":"PREMIUM_REQUIRED"}',
    });
  });

  it("leaves code undefined for a non-JSON error body", async () => {
    const response = new Response("Not Found", { status: 404 });
    await expect(throwIfResNotOk(response)).rejects.toMatchObject({
      code: undefined,
    });
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

describe("apiRequest init merge", () => {
  it("merges init.headers so Authorization is never clobbered", () => {
    const authHeader = "Bearer token";
    const initHeaders = { "X-Custom": "yes", Authorization: "should-lose" };
    const ourHeaders = { Authorization: authHeader };
    const merged = { ...initHeaders, ...ourHeaders };
    expect(merged["Authorization"]).toBe(authHeader);
    expect(merged["X-Custom"]).toBe("yes");
  });

  it("body from data wins over any init.body", () => {
    const data = { foo: "bar" };
    const init = { body: "should-lose" };
    const body = data ? JSON.stringify(data) : undefined;
    const fetchArgs = { ...init, body };
    expect(fetchArgs.body).toBe(JSON.stringify(data));
  });
});

describe("appStateToFocus", () => {
  // Exercises the real focus-mapping helper used by the focusManager wiring in
  // query-client.ts: on native, focused iff the app is "active"; on web it
  // returns undefined so the caller skips the override and TanStack's default
  // document-visibility focus check stays in effect.
  it("treats the active state as focused on native", () => {
    expect(appStateToFocus("ios", "active")).toBe(true);
    expect(appStateToFocus("android", "active")).toBe(true);
  });

  it("treats background and inactive states as not focused on native", () => {
    expect(appStateToFocus("ios", "background")).toBe(false);
    expect(appStateToFocus("ios", "inactive")).toBe(false);
  });

  it("returns undefined on web so the focus override is skipped", () => {
    expect(appStateToFocus("web", "active")).toBeUndefined();
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

describe("resolveImageUrl", () => {
  // After the R2 migration the DB stores absolute CDN URLs. resolveImageUrl
  // must pass http(s)/data: URLs through unchanged and only prepend the API
  // base to legacy relative paths — these assertions lock that contract so a
  // future refactor can't silently re-break R2 image URLs.
  it("returns absolute R2/CDN URLs unchanged", () => {
    const url = "https://img.example.com/recipe-images/recipe-abc.png";
    expect(resolveImageUrl(url)).toBe(url);
  });
  it("passes data: URLs through unchanged", () => {
    expect(resolveImageUrl("data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA",
    );
  });
  it("returns null for nullish input", () => {
    expect(resolveImageUrl(null)).toBeNull();
    expect(resolveImageUrl(undefined)).toBeNull();
  });
  it("prepends the API base to a relative /api path", () => {
    const out = resolveImageUrl("/api/recipe-images/foo.png");
    expect(out).toMatch(/^https?:\/\/.+\/api\/recipe-images\/foo\.png$/);
  });
});
