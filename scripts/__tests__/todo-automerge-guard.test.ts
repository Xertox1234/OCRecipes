import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GUARD_SCRIPT = join(__dirname, "..", "todo-automerge-guard.sh");
const REPO_ROOT = join(__dirname, "..", "..");
const ARCHIVE_PATH = "todos/archive/P3-2026-07-08-example.md";

const FAKE_GH_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "pr" ] && [ "$2" = "diff" ]; then
  if [ "\${FAKE_GH_DIFF_EXIT:-0}" != "0" ]; then
    echo "fake-gh: simulated gh pr diff failure" >&2
    exit "$FAKE_GH_DIFF_EXIT"
  fi
  printf '%s\\n' "$FAKE_GH_DIFF_FILES"
  exit 0
fi
if [ "$1" = "api" ]; then
  if [ "\${FAKE_GH_API_EXIT:-0}" != "0" ]; then
    printf '%s\\n' "\${FAKE_GH_API_BODY:-fake-gh: simulated gh api failure}" >&2
    exit "$FAKE_GH_API_EXIT"
  fi
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

function runGuardRaw(env: Record<string, string>): {
  status: number | null;
  stdout: string;
} {
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
      ...env,
    },
  });

  return { status: result.status, stdout: result.stdout };
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

  it.each([
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

describe("todo-automerge-guard.sh (server/routes/ HOLDs wholesale, not enumerate-the-sensitive-ones)", () => {
  it.each([
    "server/routes/recipes.ts",
    "server/routes/meal-suggestions.ts",
    "server/routes/verification.ts",
  ])(
    "HOLDs %s even though it names no sensitive keyword — server/routes/ was reverted off the allowlist entirely after a whole-root widening let auth-security logic (rate limiters, password schemas, upload validation, API-key auth) slip through in shared route infra whose filenames named no sensitive keyword",
    (file) => {
      const { status } = runGuard([file], GENERIC_LOW_TODO);
      expect(status).toBe(1);
    },
  );

  it.each([
    "server/routes/_rate-limiters.ts",
    "server/routes/_schemas.ts",
    "server/routes/_upload.ts",
    "server/routes/public-api.ts",
  ])(
    "HOLDs %s (the specific fail-open files a final whole-branch review found: real auth-security logic imported by auth.ts, matching no override token under the old whole-root widening)",
    (file) => {
      const { status } = runGuard([file], GENERIC_LOW_TODO);
      expect(status).toBe(1);
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

  it.each(["client/lib/query-client.ts", "client/lib/reporter.ts"])(
    "HOLDs %s (shared client/ infra carrying real security logic — Bearer-token attachment/session-expiry detection, and Authorization-header scrubbing before Sentry — found by a final-review hunt for the same hidden-security-logic pattern that caused server/routes/ to revert)",
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
    "Add health score to recipe card",
    "Improve healthy-recipe filter",
    "Show health insights on dashboard",
  ])(
    "does NOT HOLD a generic allowlisted file for the ordinary recipe-domain title %j (session/verif/receipt/secret/health deliberately excluded from SENSITIVE_INTENT_KEYWORDS — they collide with this app's own vocabulary)",
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

describe("todo-automerge-guard.sh (xhigh review: known Bearer-token/health-PII/misc gap files now HOLD)", () => {
  it.each([
    "client/lib/offline-queue-drain.ts",
    "client/lib/photo-upload.ts",
    "client/lib/durable-owner.ts",
    "client/hooks/useAvatarUpload.ts",
    "client/hooks/useCarouselRecipes.ts",
    "client/hooks/useChat.ts",
    "client/hooks/useCookSession.ts",
    "client/hooks/useHistoryData.ts",
    "client/hooks/useMenuScan.ts",
    "client/hooks/useNutritionLookup.ts",
    "client/hooks/useReceiptScan.ts",
    "client/hooks/useSavedItems.ts",
    "client/hooks/useCoachStream.ts",
  ])(
    "HOLDs %s (Bearer-token attachment / cross-user-isolation chokepoint — same shared-infra pattern as query-client.ts/reporter.ts, found by re-running that hunt across client/)",
    (file) => {
      const { status } = runGuard([file], GENERIC_LOW_TODO);
      expect(status).toBe(1);
    },
  );

  it.each([
    "client/context/OnboardingContext.tsx",
    "client/hooks/useDietaryProfileForm.ts",
    "client/hooks/useAllergenCheck.ts",
    "server/lib/dietary-context.ts",
  ])(
    "HOLDs %s (real health-PII fields — allergies/healthConditions — not caught by the (^|/)[Hh]ealth filename pattern)",
    (file) => {
      const { status } = runGuard([file], GENERIC_LOW_TODO);
      expect(status).toBe(1);
    },
  );

  it("HOLDs server/storage/export.ts (CCPA/PIPEDA data-export PII-redaction allowlist)", () => {
    const { status } = runGuard(["server/storage/export.ts"], GENERIC_LOW_TODO);
    expect(status).toBe(1);
  });

  it("HOLDs server/services/email.ts (per-recipient anti-abuse/anti-enumeration rate limiter gating verification-email sends)", () => {
    const { status } = runGuard(["server/services/email.ts"], GENERIC_LOW_TODO);
    expect(status).toBe(1);
  });

  it("does NOT HOLD server/routes/export.ts for the wrong reason (already held wholesale as a server/routes/ file, not because bare `export.ts` is itself sensitive) — this is a sanity check on the override addition's scope", () => {
    const { status } = runGuard(["server/routes/export.ts"], GENERIC_LOW_TODO);
    expect(status).toBe(1);
  });
});

describe("todo-automerge-guard.sh (xhigh review: skip-gate consumer gap closed)", () => {
  it("HOLDs server/lib/verification-token.ts via SENSITIVE_OVERRIDE directly (not just SAFE_ALLOWLIST omission) — this is what closes the todo-executor.md research-delegation skip-gate's gap, since that gate never checks SAFE_ALLOWLIST", () => {
    const { status } = runGuard(
      ["server/lib/verification-token.ts"],
      GENERIC_LOW_TODO,
    );
    expect(status).toBe(1);
  });
});

describe("todo-automerge-guard.sh (xhigh review: directory-independent allowlist token bypass closed)", () => {
  it.each([
    "server/routes/__tests__/auth-route-wiring.test.ts",
    ".github/workflows/ci-utils.ts",
    "scripts/deploy-utils.ts",
    "migrations/0099_migration.spec.ts",
  ])(
    "HOLDs %s (a test/spec/utils file under a directory that's absent from SAFE_ALLOWLIST — the directory-independent (^|/)__tests__/, .test., .spec., -utils. tokens used to let these slip through regardless of directory; now closed by a whole-dir SENSITIVE_OVERRIDE entry for each)",
    (file) => {
      const { status } = runGuard([file], GENERIC_LOW_TODO);
      expect(status).toBe(1);
    },
  );

  it("still allows docs/some-guide.md (docs/todos markdown stays exempt from the override, since it's never sensitive CODE) — sanity check the fix didn't over-reach", () => {
    const { status } = runGuard(["docs/some-guide.md"], GENERIC_LOW_TODO);
    expect(status).toBe(0);
  });
});

describe("todo-automerge-guard.sh (xhigh review: case-sensitivity and anchoring fixes)", () => {
  it.each([
    "client/screens/AdminDashboardScreen.tsx",
    "server/storage/premium-tier.ts",
  ])(
    "HOLDs %s ([Aa]dmin/[Pp]remium are now case-classed — the old bare `admin`/`Premium` literals only covered one of the two now-open roots' naming conventions)",
    (file) => {
      const { status } = runGuard([file], GENERIC_LOW_TODO);
      expect(status).toBe(1);
    },
  );

  it.each([
    "server/storage/session-store.ts",
    "server/storage/user-sessions.ts",
  ])(
    "HOLDs %s (session-storage naming variants the literal (^|/)sessions\\.ts$ anchor didn't cover)",
    (file) => {
      const { status } = runGuard([file], GENERIC_LOW_TODO);
      expect(status).toBe(1);
    },
  );

  it.each([
    "client/lib/cook-session-storage.ts",
    "client/hooks/useQuickLogSession.ts",
  ])(
    "still does NOT HOLD %s (the unrelated cook-along feature — confirms the broadened session-storage patterns didn't accidentally sweep it in)",
    (file) => {
      const { status } = runGuard([file], GENERIC_LOW_TODO);
      expect(status).toBe(0);
    },
  );
});

// Drift detection: re-runs the hunt that found query-client.ts/reporter.ts and 10 more
// hooks, as a test, so the NEXT such file fails loudly instead of silently auto-merging.
// Deliberately ONE narrow signature (Bearer-token attachment via tokenStorage), not a
// general "security detector": a broader signature tried for health-PII (any file
// referencing allergies/healthConditions) over-matched 10+ legitimate downstream
// consumers of already-captured profile data (recipe personalization, AI coach context)
// that are core product logic, not new chokepoints — see the guard script's
// SENSITIVE_OVERRIDE comment for why those stay hand-named instead.
function grepFiles(pattern: string, roots: string[]): string[] {
  try {
    return execFileSync(
      "grep",
      ["-rl", pattern, ...roots, "--include=*.ts", "--include=*.tsx"],
      { cwd: REPO_ROOT, encoding: "utf-8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch (err) {
    if ((err as { status?: number }).status === 1) return []; // grep: no matches
    throw err;
  }
}

describe("todo-automerge-guard.sh (drift detection: Bearer-token attachment chokepoints in client/)", () => {
  const tokenStorageFiles = new Set(
    grepFiles("tokenStorage", ["client", "server/services"]),
  );
  const authorizationFiles = new Set(
    grepFiles("Authorization", ["client", "server/services"]),
  );
  const bearerTokenFiles = [...tokenStorageFiles]
    .filter((f) => authorizationFiles.has(f))
    .filter((f) => !/__tests__|\.test\.|\.spec\./.test(f));

  it("found at least one Bearer-token chokepoint file (sanity check the signature still matches something — an empty result would mean the grep broke silently)", () => {
    expect(bearerTokenFiles.length).toBeGreaterThan(0);
  });

  it.each(
    bearerTokenFiles.length > 0
      ? bearerTokenFiles
      : ["(none found — see sanity check above)"],
  )(
    "HOLDs %s (matches the tokenStorage+Authorization signature; must be covered by SENSITIVE_OVERRIDE or explicitly reviewed and added to a waiver list)",
    (file) => {
      const { status } = runGuard([file], GENERIC_LOW_TODO);
      expect(status).toBe(1);
    },
  );
});

describe("todo-automerge-guard.sh (xhigh review: fail-closed error branches, previously untested — the fake-gh stub only ever simulated success)", () => {
  it("ERRORs (exit 2) when `gh pr diff` fails", () => {
    const { status, stdout } = runGuardRaw({
      FAKE_GH_DIFF_EXIT: "1",
      FAKE_GH_DIFF_FILES: "",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).toBe(2);
    expect(stdout).toContain("could not read changed files");
  });

  it("ERRORs (exit 2) on a genuinely empty diff", () => {
    const { status, stdout } = runGuardRaw({
      FAKE_GH_DIFF_FILES: "",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).toBe(2);
    expect(stdout).toContain("no file changes");
  });

  it("HOLDs (exit 1) when the archived todo is listed in the diff but a 404 comes back from the PR head (deleted?)", () => {
    const { status, stdout } = runGuardRaw({
      FAKE_GH_DIFF_FILES: ARCHIVE_PATH,
      FAKE_GH_API_EXIT: "1",
      FAKE_GH_API_BODY: '{"status": "404", "message": "Not Found"}',
    });
    expect(status).toBe(1);
    expect(stdout).toContain("absent from the PR head");
  });

  it("ERRORs (exit 2) on a non-404 `gh api` failure (e.g. auth/rate-limit) rather than silently passing", () => {
    const { status, stdout } = runGuardRaw({
      FAKE_GH_DIFF_FILES: ARCHIVE_PATH,
      FAKE_GH_API_EXIT: "1",
      FAKE_GH_API_BODY: "gh: authentication required",
    });
    expect(status).toBe(2);
    expect(stdout).toContain("could not read");
  });
});

describe("todo-automerge-guard.sh (xhigh review: stdout names the actual reason, not just the exit code)", () => {
  it("names the sensitive-intent keyword reason, not a generic HOLD message, when the TODO gate's intent check fires", () => {
    const { stdout } = runGuard(
      ["server/storage/meal-plan-analytics.ts"],
      ADMIN_PASSWORD_TODO,
    );
    expect(stdout).toContain("sensitive-domain keyword");
  });

  it("names the not-on-allowlist reason, not a generic HOLD message, when a file fails the PATH gate", () => {
    const { stdout } = runGuard(["server/routes/recipes.ts"], GENERIC_LOW_TODO);
    expect(stdout).toContain("not on the batch-merge allowlist");
  });

  it("prints the safe-allowlist OK message, not just a bare success, when every file is eligible", () => {
    const { stdout } = runGuard(
      ["client/screens/HomeScreen.tsx"],
      GENERIC_LOW_TODO,
    );
    expect(stdout).toContain("every changed file is on the safe allowlist");
  });
});

describe("todo-automerge-guard.sh (xhigh review: research-delegation skip-gate consumer, documented in .claude/agents/todo-executor.md but previously untested)", () => {
  // Re-implements the EXACT extraction + decision logic the skip-gate's bash snippet
  // documents (todo-executor.md's step 2b), against the real constants, so the skip-gate's
  // own gap (e.g. the verification-token.ts miss this xhigh review found) can't recur
  // silently — a change to SENSITIVE_OVERRIDE/SENSITIVE_INTENT_KEYWORDS that breaks this
  // consumer fails here, not just in the merge-guard's own test blocks above.
  function extractConstant(name: string): string {
    return execFileSync(
      "bash",
      [
        "-c",
        `grep -m1 '^${name}=' "$1" | cut -d= -f2- | tr -d "'"`,
        "_",
        GUARD_SCRIPT,
      ],
      { encoding: "utf-8" },
    ).trim();
  }

  function skipGateShouldSkip(
    affectedFiles: string[],
    todoTitle: string,
  ): boolean {
    const sens = extractConstant("SENSITIVE_OVERRIDE");
    const intent = extractConstant("SENSITIVE_INTENT_KEYWORDS");
    const filesMatch = affectedFiles.some((f) => new RegExp(sens).test(f));
    const titleMatches = new RegExp(intent, "i").test(todoTitle);
    return filesMatch || titleMatches;
  }

  it("both constants extract to non-empty values (the skip-gate fails closed — 'keep all reads inline' — if extraction ever breaks)", () => {
    expect(extractConstant("SENSITIVE_OVERRIDE").length).toBeGreaterThan(0);
    expect(extractConstant("SENSITIVE_INTENT_KEYWORDS").length).toBeGreaterThan(
      0,
    );
  });

  it("skips delegation for server/lib/verification-token.ts under a neutral title (the exact gap this xhigh review found and closed)", () => {
    expect(
      skipGateShouldSkip(
        ["server/lib/verification-token.ts"],
        "Extend verification token expiry to 48h",
      ),
    ).toBe(true);
  });

  it("skips delegation for any server/routes/ file (whole-dir override, closes the earlier server/routes/auth-specific gap too)", () => {
    expect(
      skipGateShouldSkip(["server/routes/recipes.ts"], "Fix pagination bug"),
    ).toBe(true);
  });

  it("does NOT skip delegation for an ordinary client/ file under a neutral title (delegation still happens for genuinely non-sensitive work)", () => {
    expect(
      skipGateShouldSkip(
        ["client/screens/HomeScreen.tsx"],
        "Fix pagination bug",
      ),
    ).toBe(false);
  });
});
