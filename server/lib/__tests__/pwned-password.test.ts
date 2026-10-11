import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import { isBreached } from "../pwned-password";

const sha1 = (s: string) =>
  crypto
    .createHash("sha1")
    .update(s.normalize("NFC"), "utf8")
    .digest("hex")
    .toUpperCase();

function fakeFetch(body: string, status = 200) {
  return vi.fn(async () => new Response(body, { status }));
}

describe("isBreached", () => {
  it("sends only the 5-hex prefix, with padding", async () => {
    const f = fakeFetch("");
    await isBreached("hunter2hunter2hunter2", f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `https://api.pwnedpasswords.com/range/${sha1("hunter2hunter2hunter2").slice(0, 5)}`,
    );
    expect((init.headers as Record<string, string>)["Add-Padding"]).toBe(
      "true",
    );
    expect(url).not.toContain(sha1("hunter2hunter2hunter2").slice(5));
  });

  it("detects a hit with CRLF lines and ignores padded :0 rows", async () => {
    const h = sha1("password-password");
    const body = `0000000000000000000000000000000000A:0\r\n${h.slice(5)}:42\r\n`;
    expect(
      await isBreached(
        "password-password",
        fakeFetch(body) as unknown as typeof fetch,
      ),
    ).toBe(true);
  });

  it("a padded :0 row for our suffix is not a hit", async () => {
    const h = sha1("rare-pass-phrase");
    expect(
      await isBreached(
        "rare-pass-phrase",
        fakeFetch(`${h.slice(5)}:0\r\n`) as unknown as typeof fetch,
      ),
    ).toBe(false);
  });

  it("fails open on non-200 and on network errors", async () => {
    expect(
      await isBreached(
        "x".repeat(15),
        fakeFetch("", 503) as unknown as typeof fetch,
      ),
    ).toBe("unavailable");
    const boom = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect(
      await isBreached("x".repeat(15), boom as unknown as typeof fetch),
    ).toBe("unavailable");
  });
});
