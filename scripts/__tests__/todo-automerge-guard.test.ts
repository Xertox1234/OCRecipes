import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GUARD_SCRIPT = join(__dirname, "..", "todo-automerge-guard.sh");
const ARCHIVE_PATH = "todos/archive/P3-2026-07-08-example.md";

const FAKE_GH_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "pr" ] && [ "$2" = "diff" ]; then
  printf '%s\\n' "$FAKE_GH_DIFF_FILES"
  exit 0
fi
if [ "$1" = "api" ]; then
  printf '%s\\n' "$FAKE_GH_FRONTMATTER"
  exit 0
fi
echo "fake-gh: unrecognized invocation: $*" >&2
exit 1
`;

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function frontmatter(fields: Record<string, string>): string {
  const lines = Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  return `---\n${lines}\n---\n\n# Body\n`;
}

function runGuard(
  diffFiles: string[],
  todoFrontmatter: string,
): { status: number | null; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), "fake-gh-"));
  tempDirs.push(dir);
  const ghPath = join(dir, "gh");
  writeFileSync(ghPath, FAKE_GH_SCRIPT);
  chmodSync(ghPath, 0o755);

  const result = spawnSync("bash", [GUARD_SCRIPT, "123"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      FAKE_GH_DIFF_FILES: [ARCHIVE_PATH, ...diffFiles].join("\n"),
      FAKE_GH_FRONTMATTER: todoFrontmatter,
    },
  });

  return { status: result.status, stdout: result.stdout };
}

const GENERIC_LOW_TODO = frontmatter({
  title: '"Fix pagination bug in recipe search"',
  priority: "low",
  labels: "[]",
});

const GENERIC_MEDIUM_TODO = frontmatter({
  title: '"Improve meal-plan sort order"',
  priority: "medium",
  labels: "[]",
});

const HIGH_PRIORITY_TODO = frontmatter({
  title: '"Fix critical crash on launch"',
  priority: "high",
  labels: "[]",
});

const SECURITY_LABELLED_TODO = frontmatter({
  title: '"Rotate refresh tokens"',
  priority: "low",
  labels: "[security]",
});

const ADMIN_PASSWORD_TODO = frontmatter({
  title: '"Fix admin password reset flow"',
  priority: "low",
  labels: "[]",
});

const AUTH_TITLE_TODO = frontmatter({
  title: '"Fix authentication redirect bug"',
  priority: "low",
  labels: "[]",
});

describe("todo-automerge-guard.sh (regression — behavior unchanged by this widening)", () => {
  it("HOLDs server/middleware/* (still absent from the allowlist)", () => {
    const { status } = runGuard(
      ["server/middleware/logging.ts"],
      GENERIC_LOW_TODO,
    );
    expect(status).toBe(1);
  });

  it("HOLDs server/routes/auth.ts (path override) even though server/routes/ is now broadly allowed", () => {
    const { status } = runGuard(["server/routes/auth.ts"], GENERIC_LOW_TODO);
    expect(status).toBe(1);
  });

  it("HOLDs client/context/AuthContext.tsx (path override)", () => {
    const { status } = runGuard(
      ["client/context/AuthContext.tsx"],
      GENERIC_LOW_TODO,
    );
    expect(status).toBe(1);
  });

  it.each([
    "migrations/0042_x.sql",
    ".github/workflows/ci.yml",
    "scripts/anything.sh",
    "shared/schema.ts",
  ])("HOLDs %s (unlisted root, unchanged)", (file) => {
    const { status } = runGuard([file], GENERIC_LOW_TODO);
    expect(status).toBe(1);
  });

  it("HOLDs an IAP path (unchanged existing behavior)", () => {
    const { status } = runGuard(
      ["server/services/receipt-validation.ts"],
      GENERIC_LOW_TODO,
    );
    expect(status).toBe(1);
  });

  it("HOLDs a genuinely unrecognized top-level path (proves the widened allowlist did not become fail-open)", () => {
    const { status } = runGuard(["infra/foo.yml"], GENERIC_LOW_TODO);
    expect(status).toBe(1);
  });

  it("HOLDs a high-priority todo", () => {
    const { status } = runGuard(
      ["client/screens/HomeScreen.tsx"],
      HIGH_PRIORITY_TODO,
    );
    expect(status).toBe(1);
  });

  it("HOLDs a security-labelled todo", () => {
    const { status } = runGuard(
      ["client/screens/HomeScreen.tsx"],
      SECURITY_LABELLED_TODO,
    );
    expect(status).toBe(1);
  });
});

describe("todo-automerge-guard.sh (new: widened path allowlist)", () => {
  it("allows server/routes/recipes.ts for a low-priority todo", () => {
    const { status } = runGuard(["server/routes/recipes.ts"], GENERIC_LOW_TODO);
    expect(status).toBe(0);
  });

  it("allows server/storage/meal-plans.ts for a medium-priority todo", () => {
    const { status } = runGuard(
      ["server/storage/meal-plans.ts"],
      GENERIC_MEDIUM_TODO,
    );
    expect(status).toBe(0);
  });

  it("allows client/hooks/useSomething.ts (previously off the old subdirectory list)", () => {
    const { status } = runGuard(
      ["client/hooks/useSomething.ts"],
      GENERIC_LOW_TODO,
    );
    expect(status).toBe(0);
  });

  it("allows client/hooks/useCookSession.ts (confirmed non-sensitive; not swept in by the anchored sessions.ts pattern)", () => {
    const { status } = runGuard(
      ["client/hooks/useCookSession.ts"],
      GENERIC_LOW_TODO,
    );
    expect(status).toBe(0);
  });

  it.each([
    "server/routes/verification.ts",
    "server/storage/verification.ts",
    "client/components/VerificationBadge.tsx",
  ])(
    "allows %s (Verified Product API — barcode/nutrition-data verification, not auth; confirmed by reading its imports before assuming 'verification' meant email verification)",
    (file) => {
      const { status } = runGuard([file], GENERIC_LOW_TODO);
      expect(status).toBe(0);
    },
  );
});

describe("todo-automerge-guard.sh (new: expanded sensitive-path override)", () => {
  it.each([
    "server/storage/users.ts",
    "server/storage/sessions.ts",
    "server/storage/api-keys.ts",
    "client/components/SessionExpiryBridge.tsx",
    "client/screens/VerifyEmailScreen.tsx",
    "server/routes/store-webhooks.ts",
    "server/routes/_admin.ts",
    "server/routes/admin-api-keys.ts",
    "client/context/PremiumContext.tsx",
    "client/hooks/usePremiumFeatures.ts",
    "client/screens/LoginScreen.tsx",
  ])(
    "HOLDs %s (new path-override entry, closes a gap found by auditing the real directories)",
    (file) => {
      const { status } = runGuard([file], GENERIC_LOW_TODO);
      expect(status).toBe(1);
    },
  );
});

describe("todo-automerge-guard.sh (new: sensitive-intent keyword gate)", () => {
  it("HOLDs an ordinary, newly-opened storage file when the todo title mentions admin/password (intent gate catches what the path override alone would miss)", () => {
    const { status } = runGuard(
      ["server/storage/meal-plan-analytics.ts"],
      ADMIN_PASSWORD_TODO,
    );
    expect(status).toBe(1);
  });

  it("HOLDs any file when the todo title mentions authentication, even an unrelated allowlisted screen", () => {
    const { status } = runGuard(
      ["client/screens/HomeScreen.tsx"],
      AUTH_TITLE_TODO,
    );
    expect(status).toBe(1);
  });

  it.each([
    "Add secret ingredient field to recipe form",
    "Fix grocery receipt OCR crash",
    "Improve cook session review screen",
    "Improve barcode verification accuracy",
  ])(
    "does NOT HOLD a generic allowlisted file for the ordinary recipe-domain title %j (session/verif/receipt/secret deliberately excluded from SENSITIVE_INTENT_KEYWORDS — they collide with this app's own vocabulary)",
    (title) => {
      const { status } = runGuard(
        ["client/screens/HomeScreen.tsx"],
        frontmatter({
          title: JSON.stringify(title),
          priority: "low",
          labels: "[]",
        }),
      );
      expect(status).toBe(0);
    },
  );
});
