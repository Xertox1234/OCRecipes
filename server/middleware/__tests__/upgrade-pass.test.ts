import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";
import { requireUpgradePass, upgradePassOf } from "../upgrade-pass";
import { hashUpgradePassToken } from "../../lib/upgrade-pass";
import { createMockUser } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: { getLiveUpgradePass: vi.fn(), getUserForAuth: vi.fn() },
}));

const TOKEN = "t".repeat(43);

function app() {
  const a = express();
  a.post("/x", requireUpgradePass, (req, res) => {
    const ctx = upgradePassOf(res);
    res.json({
      userId: req.userId,
      twoStepAllowed: ctx.twoStepAllowed,
      tokenVersion: ctx.tokenVersion,
      idHash: ctx.idHash,
    });
  });
  return a;
}

const livePass = (over = {}) => ({
  idHash: hashUpgradePassToken(TOKEN),
  userId: "1",
  tokenVersion: 0,
  attempts: 0,
  twoStepAllowed: true,
  expiresAt: new Date(Date.now() + 60_000),
  consumedAt: null,
  createdAt: new Date(),
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(storage.getLiveUpgradePass).mockResolvedValue(livePass());
  vi.mocked(storage.getUserForAuth).mockResolvedValue(
    createMockUser({ id: "1", tokenVersion: 0, mfaEnabledAt: null }),
  );
});

const withPass = (header: string) =>
  request(app()).post("/x").set("Authorization", header);

function expectExpired(res: request.Response) {
  expect(res.status).toBe(401);
  expect(res.body.code).toBe("UPGRADE_PASS_EXPIRED");
}

describe("requireUpgradePass", () => {
  it("a live pass → next(), with req.userId and the pass context set", async () => {
    const res = await withPass(`UpgradePass ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      userId: "1",
      twoStepAllowed: true,
      tokenVersion: 0,
      idHash: hashUpgradePassToken(TOKEN),
    });
    expect(storage.getLiveUpgradePass).toHaveBeenCalledWith(
      hashUpgradePassToken(TOKEN),
    );
  });

  it("a Bearer header (a JWT) is never accepted, and storage is never asked", async () => {
    expectExpired(await withPass(`Bearer ${TOKEN}`));
    expect(storage.getLiveUpgradePass).not.toHaveBeenCalled();
  });

  it("no Authorization header → 401", async () => {
    expectExpired(await request(app()).post("/x"));
    expect(storage.getLiveUpgradePass).not.toHaveBeenCalled();
  });

  it("an absurd token length → 401 without a lookup", async () => {
    expectExpired(await withPass(`UpgradePass ${"t".repeat(500)}`));
    expectExpired(await withPass("UpgradePass short"));
    expect(storage.getLiveUpgradePass).not.toHaveBeenCalled();
  });

  it("unknown, consumed, expired or capped (no live row) → 401", async () => {
    vi.mocked(storage.getLiveUpgradePass).mockResolvedValue(undefined);
    expectExpired(await withPass(`UpgradePass ${TOKEN}`));
  });

  it("tokenVersion moved on since the pass was minted (a reset elsewhere) → 401", async () => {
    vi.mocked(storage.getUserForAuth).mockResolvedValue(
      createMockUser({ id: "1", tokenVersion: 1, mfaEnabledAt: null }),
    );
    expectExpired(await withPass(`UpgradePass ${TOKEN}`));
  });

  it("the account turned two-step on since → 401", async () => {
    vi.mocked(storage.getUserForAuth).mockResolvedValue(
      createMockUser({ id: "1", tokenVersion: 0, mfaEnabledAt: new Date() }),
    );
    expectExpired(await withPass(`UpgradePass ${TOKEN}`));
  });

  it("the user was deleted → 401", async () => {
    vi.mocked(storage.getUserForAuth).mockResolvedValue(undefined);
    expectExpired(await withPass(`UpgradePass ${TOKEN}`));
  });

  it("a storage failure → 500, never next()", async () => {
    vi.mocked(storage.getLiveUpgradePass).mockRejectedValue(new Error("db"));
    const res = await withPass(`UpgradePass ${TOKEN}`);
    expect(res.status).toBe(500);
    expect(res.body.userId).toBeUndefined();
  });
});
