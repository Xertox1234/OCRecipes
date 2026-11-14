// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import type { Request } from "express";
import { ipKeyGenerator } from "../ip-key";
import * as rateLimiters from "../../routes/_rate-limiters";

function req(over: Partial<Request>): Request {
  return { headers: {}, socket: {}, ...over } as unknown as Request;
}

describe("ipKeyGenerator (lib)", () => {
  afterEach(() => {
    delete process.env.RAILWAY_ENVIRONMENT_NAME;
  });

  it("is the same function _rate-limiters re-exports", () => {
    expect(rateLimiters.ipKeyGenerator).toBe(ipKeyGenerator);
  });

  it("ignores X-Real-IP off Railway", () => {
    expect(
      ipKeyGenerator(
        req({ ip: "1.2.3.4", headers: { "x-real-ip": "9.9.9.9" } }),
      ),
    ).toBe("1.2.3.4");
  });

  it("trusts X-Real-IP on Railway", () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "production";
    expect(
      ipKeyGenerator(
        req({ ip: "1.2.3.4", headers: { "x-real-ip": "9.9.9.9" } }),
      ),
    ).toBe("9.9.9.9");
  });
});
