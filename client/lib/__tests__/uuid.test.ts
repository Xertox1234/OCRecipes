import { describe, it, expect, vi, afterEach } from "vitest";

import { randomUuidV4 } from "../uuid";

// RFC 4122 version 4: version nibble 4, variant bits 10xx (8, 9, a, b).
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomUuidV4", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an RFC 4122 version 4 UUID", () => {
    for (let i = 0; i < 200; i++) {
      expect(randomUuidV4()).toMatch(UUID_V4);
    }
  });

  it("does not repeat across many calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(randomUuidV4());
    expect(seen.size).toBe(2000);
  });

  // Hermes (the app's JS engine) has no global `crypto`. Vitest runs in Node,
  // where `crypto.randomUUID` exists, which is how a bare call shipped in May
  // and broke every coach stream on device while every test stayed green.
  it("works on a runtime with no global crypto", () => {
    vi.stubGlobal("crypto", undefined);
    expect(randomUuidV4()).toMatch(UUID_V4);
  });
});
