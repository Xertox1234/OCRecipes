import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../family";

// A failed Drizzle statement's message ends with "\nparams:" and every bound
// value. For a family profile those values are another person's name,
// allergies and note, so the create and update routes must not log them.

const mockLog = vi.hoisted(() => {
  const log: Record<string, unknown> = {};
  for (const level of ["error", "warn", "info", "debug", "trace", "fatal"]) {
    log[level] = vi.fn();
  }
  log.child = () => log;
  return log as Record<
    "error" | "warn" | "info" | "debug" | "trace" | "fatal",
    ReturnType<typeof vi.fn>
  > & { child: () => unknown };
});
vi.mock("../../lib/logger", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../lib/logger")>();
  return {
    ...orig,
    logger: mockLog,
    rootLogger: mockLog,
    createServiceLogger: () => mockLog,
  };
});

vi.mock("../../storage", () => ({
  storage: {
    getEffectiveTierForUser: vi.fn(),
    getUserProfile: vi.fn(),
    getFamilyProfiles: vi.fn(),
    createFamilyProfile: vi.fn(),
    updateFamilyProfile: vi.fn(),
    deleteFamilyProfile: vi.fn(),
    setFamilyPlanningEnabled: vi.fn(),
  },
}));
vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");

/** Everything logged at any level, with each Error's message, stack and cause spelled out. */
function allLogged(): string {
  const seen: unknown[] = [];
  const spell = (value: unknown): unknown => {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
        cause: spell(value.cause),
      };
    }
    if (value !== null && typeof value === "object") {
      if (seen.includes(value)) return "[circular]";
      seen.push(value);
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, spell(v)]),
      );
    }
    return value;
  };
  return JSON.stringify(
    (["error", "warn", "info", "debug", "trace", "fatal"] as const).map(
      (level) => mockLog[level].mock.calls.map((call) => call.map(spell)),
    ),
  );
}

/** The shape Drizzle throws for a failed statement, with the pg error as its cause. */
function failedQuery(): Error {
  const pgError = new Error(
    'invalid input syntax for type json: "ZZNOTE-eczema"',
  );
  const error = new Error(
    'Failed query: insert into "family_profiles" ("user_id", "name", "allergies", "note") values ($1, $2, $3, $4)\n' +
      'params: 1,ZZCHILDNAME,[{"name":"peanuts","severity":"severe"}],ZZNOTE-eczema',
    { cause: pgError },
  );
  error.name = "DrizzleQueryError";
  return error;
}

const body = { name: "ZZCHILDNAME", allergies: [], note: null };

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("family profile writes never log the profile's details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("premium");
  });

  it("the test's own detector sees the details in an unredacted error (control)", () => {
    (mockLog.error as unknown as (...args: unknown[]) => void)(
      { err: failedQuery() },
      "control",
    );
    const logged = allLogged();
    expect(logged).toContain("ZZCHILDNAME");
    expect(logged).toContain("ZZNOTE-eczema");
    expect(logged).toContain("peanuts");
  });

  it("create: answers 500 and logs the failed statement without its values", async () => {
    vi.mocked(storage.createFamilyProfile).mockRejectedValue(failedQuery());

    const res = await request(createApp())
      .post("/api/family-profiles")
      .send(body);

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("ZZCHILDNAME");
    const logged = allLogged();
    // It did log the failure, and which statement failed...
    expect(mockLog.error).toHaveBeenCalledTimes(1);
    expect(logged).toContain("Failed query: insert into");
    // ...but none of the profile's details.
    expect(logged).not.toContain("ZZCHILDNAME");
    expect(logged).not.toContain("ZZNOTE-eczema");
    expect(logged).not.toContain("peanuts");
    expect(logged).not.toContain("params:");
  });

  it("update: answers 500 and logs the failed statement without its values", async () => {
    vi.mocked(storage.updateFamilyProfile).mockRejectedValue(failedQuery());

    const res = await request(createApp())
      .put("/api/family-profiles/5")
      .send(body);

    expect(res.status).toBe(500);
    const logged = allLogged();
    expect(mockLog.error).toHaveBeenCalledTimes(1);
    expect(logged).not.toContain("ZZCHILDNAME");
    expect(logged).not.toContain("ZZNOTE-eczema");
    expect(logged).not.toContain("peanuts");
  });

  it("keeps an ordinary error's message, so real failures stay diagnosable", async () => {
    vi.mocked(storage.createFamilyProfile).mockRejectedValue(
      new Error("connection terminated unexpectedly"),
    );

    await request(createApp()).post("/api/family-profiles").send(body);

    expect(allLogged()).toContain("connection terminated unexpectedly");
  });
});
