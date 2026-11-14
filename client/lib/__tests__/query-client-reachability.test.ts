// query-client.ts subscribes TanStack's onlineManager to NetInfo at module
// load. NetInfo applies its configuration to later subscriptions, so the probe
// must point at our API before that subscription, or the onlineManager keeps
// probing Google (see network-reachability.ts).
describe("query-client NetInfo wiring", () => {
  it("points the reachability probe at our API before subscribing", async () => {
    // test/setup.ts clears mocks before each test, so load the module here,
    // and take NetInfo from the same fresh module graph.
    vi.resetModules();
    const { default: NetInfo } = await import(
      "@react-native-community/netinfo"
    );
    await import("../query-client");
    const configure = vi.mocked(NetInfo.configure);
    const addEventListener = vi.mocked(NetInfo.addEventListener);

    expect(configure).toHaveBeenCalledTimes(1);
    const config = configure.mock.calls[0][0];
    expect(config.reachabilityUrl).toBe("http://localhost:3000/api/health");

    // The rule it passed: a JSON 503 (server up, database down) is reachable,
    // an HTML 200 (captive portal) is not.
    const reply = (status: number, contentType: string) =>
      ({
        status,
        headers: new Headers({ "content-type": contentType }),
      }) as unknown as Response;
    await expect(
      config.reachabilityTest?.(reply(503, "application/json")),
    ).resolves.toBe(true);
    await expect(
      config.reachabilityTest?.(reply(200, "text/html")),
    ).resolves.toBe(false);

    expect(addEventListener).toHaveBeenCalled();
    expect(configure.mock.invocationCallOrder[0]).toBeLessThan(
      addEventListener.mock.invocationCallOrder[0],
    );
  });
});
