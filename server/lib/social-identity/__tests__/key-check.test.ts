import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import { encryptToken } from "../token-crypto";
import {
  checkIdentityKey,
  identityKeyFingerprint,
  runIdentityKeyBootCheck,
} from "../key-check";

const key = crypto.randomBytes(32);
const otherKey = crypto.randomBytes(32);
const raw = key.toString("base64");

// null = no key configured (an `undefined` argument would take the default).
function deps(sample: () => Promise<string[]>, rawKey: string | null = raw) {
  return {
    raw: rawKey ?? undefined,
    sample: vi.fn(sample),
    report: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe("identityKeyFingerprint", () => {
  it("is the first 8 hex of sha256 over the decoded key", () => {
    expect(identityKeyFingerprint(key)).toBe(
      crypto.createHash("sha256").update(key).digest("hex").slice(0, 8),
    );
    expect(identityKeyFingerprint(key)).toMatch(/^[0-9a-f]{8}$/);
    expect(identityKeyFingerprint(otherKey)).not.toBe(
      identityKeyFingerprint(key),
    );
  });
});

describe("checkIdentityKey", () => {
  it("counts tokens the key reads and tokens it cannot", () => {
    const mine = encryptToken("r.mine", key);
    const theirs = encryptToken("r.theirs", otherKey);
    expect(checkIdentityKey([mine, theirs, mine], key)).toEqual({
      checked: 3,
      unreadable: 1,
    });
  });

  it("counts a malformed blob as unreadable", () => {
    expect(checkIdentityKey(["v1:junk", "not-a-blob"], key)).toEqual({
      checked: 2,
      unreadable: 2,
    });
  });

  it("checks nothing when nothing is stored", () => {
    expect(checkIdentityKey([], key)).toEqual({ checked: 0, unreadable: 0 });
  });
});

// Owner ruling 5 (2026-10-12): a key that can't read the stored Apple tokens
// keeps the server running and alerts — it never refuses to start.
describe("runIdentityKeyBootCheck", () => {
  const fp = identityKeyFingerprint(key);

  it("right key → passes, logs the fingerprint and the count, reports nothing", async () => {
    const d = deps(async () => [
      encryptToken("a", key),
      encryptToken("b", key),
    ]);
    await runIdentityKeyBootCheck(d);
    expect(d.log.info).toHaveBeenCalledWith(
      { keyFingerprint: fp, checked: 2 },
      "identity key check: passed",
    );
    expect(d.log.error).not.toHaveBeenCalled();
    expect(d.report).not.toHaveBeenCalled();
  });

  it("wrong key → error log + one report naming the key, and still resolves", async () => {
    const d = deps(async () => [
      encryptToken("a", otherKey),
      encryptToken("b", key),
    ]);
    await expect(runIdentityKeyBootCheck(d)).resolves.toBeUndefined();
    expect(d.log.error).toHaveBeenCalledWith(
      { keyFingerprint: fp, checked: 2, unreadable: 1 },
      "identity key check: IDENTITY_TOKEN_ENC_KEY cannot read stored Apple tokens",
    );
    expect(d.report).toHaveBeenCalledTimes(1);
    const [err, context] = d.report.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(
      "IDENTITY_TOKEN_ENC_KEY cannot read 1 of 2 stored Apple refresh tokens — was the key replaced?",
    );
    expect(context).toBe("identity-key-boot-check");
  });

  it("never puts a token or its plaintext in a log or report", async () => {
    const blob = encryptToken("r.secret-plain", otherKey);
    const good = encryptToken("r.other-plain", key);
    const d = deps(async () => [blob, good]);
    await runIdentityKeyBootCheck(d);
    const seen = JSON.stringify([
      d.log.info.mock.calls,
      d.log.error.mock.calls,
      d.report.mock.calls.map(([e, c]) => [(e as Error).message, c]),
    ]);
    for (const secret of [blob, good, "r.secret-plain", "r.other-plain", raw]) {
      expect(seen).not.toContain(secret);
    }
  });

  it("nothing stored → passes, and says it checked zero", async () => {
    const d = deps(async () => []);
    await runIdentityKeyBootCheck(d);
    expect(d.log.info).toHaveBeenCalledWith(
      { keyFingerprint: fp, checked: 0 },
      "identity key check: no stored Apple tokens to check",
    );
    expect(d.report).not.toHaveBeenCalled();
  });

  it("database error → warns it could not run; no wrong-key alert", async () => {
    const d = deps(async () => {
      throw new Error("connection refused");
    });
    await expect(runIdentityKeyBootCheck(d)).resolves.toBeUndefined();
    expect(d.log.warn).toHaveBeenCalledTimes(1);
    expect(d.log.warn.mock.calls[0][1]).toBe(
      "identity key check: could not run",
    );
    expect(d.log.warn.mock.calls[0][0]).toMatchObject({ keyFingerprint: fp });
    expect(d.log.error).not.toHaveBeenCalled();
    expect(d.report).not.toHaveBeenCalled();
  });

  it("malformed key → warns it could not run, never rejects or reads the database", async () => {
    const d = deps(async () => [], crypto.randomBytes(16).toString("base64"));
    await expect(runIdentityKeyBootCheck(d)).resolves.toBeUndefined();
    expect(d.log.warn).toHaveBeenCalledTimes(1);
    expect(d.log.warn.mock.calls[0][1]).toBe(
      "identity key check: could not run",
    );
    expect(d.sample).not.toHaveBeenCalled();
    expect(d.log.error).not.toHaveBeenCalled();
    expect(d.report).not.toHaveBeenCalled();
  });

  it("no key configured (Apple sign-in off) → skips without reading the database", async () => {
    const d = deps(async () => [], null);
    await runIdentityKeyBootCheck(d);
    expect(d.sample).not.toHaveBeenCalled();
    expect(d.report).not.toHaveBeenCalled();
    expect(d.log.error).not.toHaveBeenCalled();
  });
});
