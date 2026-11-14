import {
  apiReachabilityConfig,
  isApiServerResponse,
} from "../network-reachability";

// NetInfo's default probe is Google's generate_204. When it fails (iOS E2E run
// 42810549290: TLS error, then 10 s timeouts on the CI runner) the app marks
// itself offline, shows the banner over the header and pauses every
// default-networkMode query and mutation, though our own server is reachable.
// "Online" for this app means "our API answers".

function response(status: number, contentType: string | null): Response {
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  return { status, headers } as unknown as Response;
}

describe("apiReachabilityConfig", () => {
  it("probes our own health endpoint", () => {
    expect(
      apiReachabilityConfig("https://api.example.com").reachabilityUrl,
    ).toBe("https://api.example.com/api/health");
  });

  it("does not double the slash when the base URL ends with one", () => {
    expect(
      apiReachabilityConfig("http://localhost:3000/").reachabilityUrl,
    ).toBe("http://localhost:3000/api/health");
  });
});

describe("isApiServerResponse", () => {
  it.each([
    [200, "healthy"],
    [503, "up, database unreachable"],
    [429, "up, rate-limited"],
  ])("treats a JSON %i (%s) as reachable", async (status) => {
    await expect(
      isApiServerResponse(response(status, "application/json; charset=utf-8")),
    ).resolves.toBe(true);
  });

  it("treats a captive portal's HTML 200 as not reachable", async () => {
    await expect(
      isApiServerResponse(response(200, "text/html; charset=utf-8")),
    ).resolves.toBe(false);
  });

  it("treats a proxy's non-JSON 502 as not reachable", async () => {
    await expect(
      isApiServerResponse(response(502, "text/plain")),
    ).resolves.toBe(false);
  });

  it("treats a response with no content type as not reachable", async () => {
    await expect(isApiServerResponse(response(204, null))).resolves.toBe(false);
  });
});
