import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  findCleanupGaps,
  parseDeleteAccountArgs,
  runDeleteAccount,
  type DeleteAccountDeps,
} from "../delete-account";

// Importing the script must not open a database connection.
vi.mock("../../db", () => ({
  db: {},
  pool: { end: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../../storage", () => ({ storage: {} }));
vi.mock("../../services/account-deletion", () => ({ deleteAccount: vi.fn() }));

const account = {
  id: "user-123",
  username: "sam",
  email: "sam@example.com",
  avatarUrl: "https://cdn/a/sam.jpg",
  createdAt: new Date("2026-01-02T00:00:00Z"),
  subscriptionTier: "free",
};

let deps: DeleteAccountDeps & {
  findByEmail: ReturnType<typeof vi.fn>;
  findByUsername: ReturnType<typeof vi.fn>;
  deleteAccount: ReturnType<typeof vi.fn>;
  cleanupGaps: ReturnType<typeof vi.fn>;
};
let lines: string[];

beforeEach(() => {
  lines = [];
  deps = {
    findByEmail: vi.fn().mockResolvedValue(account),
    findByUsername: vi.fn().mockResolvedValue(account),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
    cleanupGaps: vi.fn().mockReturnValue([]),
    print: (line: string) => lines.push(line),
  };
});

describe("parseDeleteAccountArgs", () => {
  it("reads an email lookup", () => {
    expect(parseDeleteAccountArgs(["--email", "sam@example.com"])).toEqual({
      ok: true,
      lookup: { by: "email", value: "sam@example.com" },
      confirmId: undefined,
      allowIncomplete: false,
    });
  });

  it("reads a username lookup with a confirmation", () => {
    expect(
      parseDeleteAccountArgs([
        "--username",
        "sam",
        "--confirm-delete",
        "user-123",
      ]),
    ).toEqual({
      ok: true,
      lookup: { by: "username", value: "sam" },
      confirmId: "user-123",
      allowIncomplete: false,
    });
  });

  it("reads --allow-incomplete", () => {
    const args = parseDeleteAccountArgs([
      "--email",
      "sam@example.com",
      "--allow-incomplete",
    ]);
    expect(args).toMatchObject({ ok: true, allowIncomplete: true });
  });

  it.each([
    [[]],
    [["--email"]],
    [["--email", "a@b.c", "--username", "sam"]],
    [["--email", "a@b.c", "--confirm-delete"]],
    [["--email", "--confirm-delete", "x"]],
  ])("refuses %j", (argv) => {
    expect(parseDeleteAccountArgs(argv).ok).toBe(false);
  });
});

describe("runDeleteAccount", () => {
  it("without a confirmation, shows the account and deletes nothing", async () => {
    const code = await runDeleteAccount(["--email", "Sam@Example.com"], deps);

    expect(code).toBe(0);
    expect(deps.findByEmail).toHaveBeenCalledWith("Sam@Example.com");
    expect(deps.deleteAccount).not.toHaveBeenCalled();
    const out = lines.join("\n");
    expect(out).toContain("user-123");
    expect(out).toContain("sam");
    expect(out).toContain("Nothing was deleted");
    expect(out).toContain("--confirm-delete user-123");
  });

  it("deletes when the confirmation is the account's id, and waits for the images", async () => {
    const code = await runDeleteAccount(
      ["--username", "sam", "--confirm-delete", "user-123"],
      deps,
    );

    expect(code).toBe(0);
    expect(deps.findByUsername).toHaveBeenCalledWith("sam");
    expect(deps.deleteAccount).toHaveBeenCalledWith(account, {
      awaitCleanup: true,
    });
    expect(lines.join("\n")).toContain("Deleted account user-123");
  });

  it("refuses a confirmation that is not the account's id", async () => {
    const code = await runDeleteAccount(
      ["--email", "sam@example.com", "--confirm-delete", "user-999"],
      deps,
    );

    expect(code).toBe(1);
    expect(deps.deleteAccount).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("does not match");
  });

  it("reports when no account matches", async () => {
    deps.findByEmail.mockResolvedValue(undefined);
    const code = await runDeleteAccount(
      ["--email", "nobody@example.com", "--confirm-delete", "user-123"],
      deps,
    );

    expect(code).toBe(1);
    expect(deps.deleteAccount).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("No account");
  });

  it("warns about a paid subscription, which deletion does not cancel", async () => {
    deps.findByEmail.mockResolvedValue({
      ...account,
      subscriptionTier: "premium",
    });
    await runDeleteAccount(["--email", "sam@example.com"], deps);
    expect(lines.join("\n")).toMatch(/subscription/i);
  });

  describe("when this environment cannot finish the deletion", () => {
    const gaps = [
      "stored pictures stay in storage (R2_* is not set)",
      "Apple sign-in stays authorised (Apple sign-in settings are not set)",
    ];
    beforeEach(() => {
      deps.cleanupGaps.mockReturnValue(gaps);
    });

    it("the look step still shows the account, and says what would be left", async () => {
      const code = await runDeleteAccount(["--email", "sam@example.com"], deps);

      expect(code).toBe(0);
      const out = lines.join("\n");
      expect(out).toContain("user-123");
      for (const gap of gaps) expect(out).toContain(gap);
      expect(deps.deleteAccount).not.toHaveBeenCalled();
    });

    it("the delete step refuses, deletes nothing and names what is missing", async () => {
      const code = await runDeleteAccount(
        ["--email", "sam@example.com", "--confirm-delete", "user-123"],
        deps,
      );

      expect(code).toBe(1);
      expect(deps.deleteAccount).not.toHaveBeenCalled();
      const out = lines.join("\n");
      for (const gap of gaps) expect(out).toContain(gap);
      expect(out).toContain("Nothing was deleted");
      expect(out).not.toContain("Deleted account");
    });

    it("deletes with --allow-incomplete, and says what was left behind", async () => {
      const code = await runDeleteAccount(
        [
          "--email",
          "sam@example.com",
          "--confirm-delete",
          "user-123",
          "--allow-incomplete",
        ],
        deps,
      );

      expect(code).toBe(0);
      expect(deps.deleteAccount).toHaveBeenCalledWith(account, {
        awaitCleanup: true,
      });
      const out = lines.join("\n");
      expect(out).toContain("Deleted account user-123");
      expect(out).toContain("Left behind");
      for (const gap of gaps) expect(out).toContain(gap);
    });
  });

  it("a complete environment prints no warning", async () => {
    await runDeleteAccount(
      ["--email", "sam@example.com", "--confirm-delete", "user-123"],
      deps,
    );
    const out = lines.join("\n");
    expect(out).not.toMatch(/left behind|cannot finish/i);
  });

  it("prints usage and deletes nothing on bad arguments", async () => {
    const code = await runDeleteAccount([], deps);
    expect(code).toBe(1);
    expect(deps.findByEmail).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("Usage");
  });
});

describe("findCleanupGaps", () => {
  const R2 = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_PUBLIC_BASE_URL",
  ];
  const APPLE = [
    "APPLE_TEAM_ID",
    "APPLE_SIGN_IN_KEY_ID",
    "APPLE_SIGN_IN_PRIVATE_KEY",
    "APPLE_BUNDLE_ID",
    "IDENTITY_TOKEN_ENC_KEY",
  ];
  const set = (names: string[], value: string) => {
    for (const name of names) vi.stubEnv(name, value);
  };
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("finds nothing when image storage and Apple sign-in are both set up", () => {
    set([...R2, ...APPLE], "x");
    expect(findCleanupGaps()).toEqual([]);
  });

  it("names the pictures when image storage is not set up", () => {
    set(R2, "");
    set(APPLE, "x");
    const gaps = findCleanupGaps();
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatch(/pictures/);
  });

  it("names Apple sign-in when one of its settings is missing", () => {
    set([...R2, ...APPLE], "x");
    vi.stubEnv("IDENTITY_TOKEN_ENC_KEY", "");
    const gaps = findCleanupGaps();
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatch(/Apple/);
  });
});
