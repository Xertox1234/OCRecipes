import { describe, it, expect } from "vitest";

import { evaluateApiDomain } from "../check-api-domain";

// The machine's real interfaces are irrelevant here — every case passes its own
// list, so this suite cannot start agreeing with whatever network the developer
// happens to be on. See docs/solutions/logic-errors/
// an-uncontrolled-ambient-input-makes-the-check-agree-with-what-it-checks-2026-08-31.md
const LOCAL = ["192.168.0.122", "10.7.70.181"];

describe("evaluateApiDomain", () => {
  it("skips when EXPO_PUBLIC_DOMAIN is unset", () => {
    expect(evaluateApiDomain(undefined, LOCAL).status).toBe("skip");
    expect(evaluateApiDomain("", LOCAL).status).toBe("skip");
  });

  it("accepts loopback, which is what sim-only work should use", () => {
    for (const d of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
    ]) {
      expect(evaluateApiDomain(d, LOCAL).status).toBe("ok");
    }
  });

  it("accepts a real hostname — a DNS name cannot be a stale LAN IP", () => {
    expect(evaluateApiDomain("https://api.ocrecipes.com", LOCAL).status).toBe(
      "ok",
    );
  });

  it("accepts a LAN IP that is one of this machine's addresses", () => {
    expect(evaluateApiDomain("http://192.168.0.122:3000", LOCAL).status).toBe(
      "ok",
    );
  });

  // The actual bug, six times over: .env pinned to an IP the machine no longer has.
  it("reports STALE for a LAN IP this machine does not hold", () => {
    const v = evaluateApiDomain("http://192.168.0.102:3000", LOCAL);
    expect(v.status).toBe("stale");
    if (v.status !== "stale") throw new Error("unreachable");
    expect(v.host).toBe("192.168.0.102");
    expect(v.localIps).toEqual(LOCAL);
  });

  it("parses the host with no scheme and with no port", () => {
    expect(evaluateApiDomain("192.168.0.102:3000", LOCAL).status).toBe("stale");
    expect(evaluateApiDomain("http://192.168.0.102", LOCAL).status).toBe(
      "stale",
    );
  });

  // An empty interface list is the en0-is-down case. It must NOT read as
  // "every IP is stale" — that would fail the dev loop for the wrong reason.
  it("skips rather than failing when no local IPv4 could be determined", () => {
    expect(evaluateApiDomain("http://192.168.0.102:3000", []).status).toBe(
      "skip",
    );
  });

  it("ignores surrounding quotes and whitespace from the .env line", () => {
    expect(
      evaluateApiDomain('  "http://192.168.0.122:3000"  ', LOCAL).status,
    ).toBe("ok");
  });
});
