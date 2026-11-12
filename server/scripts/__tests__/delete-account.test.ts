import { describe, it, expect, vi, beforeEach } from "vitest";

import {
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
};
let lines: string[];

beforeEach(() => {
  lines = [];
  deps = {
    findByEmail: vi.fn().mockResolvedValue(account),
    findByUsername: vi.fn().mockResolvedValue(account),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
    print: (line: string) => lines.push(line),
  };
});

describe("parseDeleteAccountArgs", () => {
  it("reads an email lookup", () => {
    expect(parseDeleteAccountArgs(["--email", "sam@example.com"])).toEqual({
      ok: true,
      lookup: { by: "email", value: "sam@example.com" },
      confirmId: undefined,
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
    });
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

  it("prints usage and deletes nothing on bad arguments", async () => {
    const code = await runDeleteAccount([], deps);
    expect(code).toBe(1);
    expect(deps.findByEmail).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("Usage");
  });
});
