import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GUARD_SCRIPT = join(__dirname, "..", "todo-automerge-guard.sh");
const REPO_ROOT = join(__dirname, "..", "..");
const ARCHIVE_PATH = "todos/archive/P3-2026-07-08-example.md";

const FAKE_GH_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
# Large corpora arrive by FILE, not by environment variable. Linux caps a single envp/argv
# string at MAX_ARG_STRLEN (32 * PAGE_SIZE = 131072 bytes); macOS does not, so an over-size
# list passes locally and fails execve with E2BIG on CI, where spawnSync surfaces it as
# status === null ("expected null to be +0") naming neither the size nor the limit.
FAKE_GH_DIFF_FILES="\${FAKE_GH_DIFF_FILES:-}"
if [ -n "\${FAKE_GH_DIFF_FILES_FILE:-}" ]; then
  FAKE_GH_DIFF_FILES="$(cat "$FAKE_GH_DIFF_FILES_FILE")"
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  # The guard compares its file-list read against the PR's DECLARED changed-file count so it can
  # refuse a truncated list. Default to the number of lines this test supplied, keeping the
  # completeness check a no-op unless a row sets FAKE_GH_CHANGED_FILES to model truncation.
  printf '%s\\n' "\${FAKE_GH_CHANGED_FILES:-$(printf '%s\\n' "$FAKE_GH_DIFF_FILES" | grep -c . || true)}"
  exit 0
fi
if [ "$1" = "api" ]; then
  # The guard now reads its file list from pulls/{n}/files (so a rename's previous_filename is
  # gated too), which is also a \`gh api\` call — so this stub must dispatch on the endpoint or
  # it would answer the file-list request with frontmatter.
  # Scan ALL arguments rather than matching \$2: the contents call puts -H at \$2 and reaches the
  # frontmatter branch only by falling off the end of a positional case, so a later reordering of
  # the file-list call would misroute it silently.
  _ep=""
  for a in "$@"; do
    case "$a" in */pulls/*/files) _ep="files" ;; esac
  done
  case "\$_ep" in
    files)
      if [ "\${FAKE_GH_DIFF_EXIT:-0}" != "0" ]; then
        echo "fake-gh: simulated pulls/files failure" >&2
        exit "$FAKE_GH_DIFF_EXIT"
      fi
      # Multi-page simulation: \`gh api --paginate --jq\` re-runs the SAME filter once PER PAGE
      # and concatenates raw output (\`gh help api\`: "Each page is a separate JSON array or
      # object" -- --slurp is what would merge pages into one array first, and the guard does
      # not pass it). FAKE_GH_PR_FILES_JSON_PAGES is a JSON array of page-arrays; loop and
      # re-run the guard's own jq expression once per page, mirroring gh's own per-page
      # semantics, so a test can prove the STRUCTURAL ROW COUNT check sums every "N " row
      # rather than trusting only the first.
      if [ -n "\${FAKE_GH_PR_FILES_JSON_PAGES:-}" ]; then
        jqexpr=""; prev=""
        for a in "$@"; do
          if [ "$prev" = "--jq" ]; then jqexpr="$a"; fi
          prev="$a"
        done
        page_count="$(printf '%s' "$FAKE_GH_PR_FILES_JSON_PAGES" | jq 'length')"
        i=0
        while [ "$i" -lt "$page_count" ]; do
          printf '%s' "$FAKE_GH_PR_FILES_JSON_PAGES" | jq -c ".[$i]" | jq -r "\${jqexpr:-.}"
          i=$((i + 1))
        done
        exit 0
      fi
      # When a test supplies raw endpoint JSON, run the guard's OWN --jq over it, so the jq
      # expression is what is under test rather than a list the stub hands back. Otherwise fall
      # back to the post-jq list, which is what every pre-existing test supplies.
      if [ -n "\${FAKE_GH_PR_FILES_JSON:-}" ]; then
        jqexpr=""; prev=""
        for a in "$@"; do
          if [ "$prev" = "--jq" ]; then jqexpr="$a"; fi
          prev="$a"
        done
        printf '%s' "$FAKE_GH_PR_FILES_JSON" | jq -r "\${jqexpr:-.}"
        exit 0
      fi
      # Emit the destination CLASS the guard now reads, so its completeness check counts FILES.
      # Tests keep supplying plain paths; the prefix is added here rather than in every row.
      # The guard's STRUCTURAL ROW COUNT check now also expects one "N <count>" row ahead of
      # the F rows (the page's own element count) -- without it every test on this branch
      # would read total_N=0 against a non-zero raw F count and fail-closed at that check
      # instead of exercising the behaviour under test. FAKE_GH_N_ROW overrides the emitted
      # value (default: the real count) so a test can make the N row LIE, the one way to fire
      # the STRUCTURAL ROW COUNT mismatch arm through this stub -- the real jq filter never
      # produces a lying N row (that's what the B sentinel above prevents), so this is the
      # only path that can exercise the arm at all.
      _n="$(printf '%s\\n' "$FAKE_GH_DIFF_FILES" | sed -e '/^$/d' | grep -c . || true)"
      printf 'N %s\\n' "\${FAKE_GH_N_ROW:-$_n}"
      printf '%s\\n' "$FAKE_GH_DIFF_FILES" | sed -e '/^$/d' -e 's/^/F /'
      exit 0
      ;;
  esac
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

  it("HOLDs a medium-priority todo (carved out of auto-merge — review-required like high/critical)", () => {
    const { status, stdout } = runGuard(
      ["client/screens/HomeScreen.tsx"],
      GENERIC_MEDIUM_TODO,
    );
    expect(status).toBe(1);
    expect(stdout).toContain("only low todos are batch-merge-eligible");
  });
});

describe("todo-automerge-guard.sh (new: widened path allowlist)", () => {
  it("allows server/storage/meal-plans.ts", () => {
    const { status } = runGuard(
      ["server/storage/meal-plans.ts"],
      GENERIC_LOW_TODO,
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

describe("todo-automerge-guard.sh (docs/rules/ carve-out: binding review rules are not ordinary docs)", () => {
  it.each([
    "docs/rules/security.md",
    "docs/rules/accessibility.md",
    "docs/rules/database.md",
    "docs/rules/typescript.md",
  ])(
    "HOLDs %s (binding review rules: the markdown exemption used to short-circuit the sensitive check for every docs path, so a batch PR trimming security.md's IDOR/JWT/rate-limiting/SSRF rules was auto-merge eligible — scoped to the whole directory, not security.md alone, since every rules file is equally binding and a per-file list would go stale as rules files are added)",
    (file) => {
      const { status } = runGuard([file], GENERIC_LOW_TODO);
      expect(status).toBe(1);
    },
  );

  it("HOLDs a future NON-markdown file under docs/rules/ too (the override is anchored on the directory, not on the .md extension)", () => {
    const { status } = runGuard(["docs/rules/security.yaml"], GENERIC_LOW_TODO);
    expect(status).toBe(1);
  });

  it("HOLDs a mixed PR that touches an eligible client/ file AND a rules file (the realistic shape: todo-executor.md Step 5b appends a CRITICAL/HIGH rule bullet to docs/rules/{domain}.md from inside the /todo PR)", () => {
    const { status } = runGuard(
      ["client/screens/HomeScreen.tsx", "docs/rules/security.md"],
      GENERIC_LOW_TODO,
    );
    expect(status).toBe(1);
  });

  it("names the sensitive/not-allowlisted reason and the offending rules file on stdout, not a bare exit code", () => {
    const { stdout } = runGuard(["docs/rules/security.md"], GENERIC_LOW_TODO);
    expect(stdout).toContain("not on the batch-merge allowlist");
    expect(stdout).toContain("docs/rules/security.md");
  });

  it.each([
    "docs/solutions/best-practices/some-solution-2026-08-05.md",
    "docs/research/some-benchmark.md",
    "docs/todo-automation-runbook.md",
    "todos/P3-2026-08-05-some-open-todo.md",
    "todos/archive/P3-2026-08-05-another.md",
  ])(
    "still allows %s (every OTHER docs/todos path keeps the markdown exemption — the high-volume, low-risk case it exists for; the carve-out must not have swallowed it)",
    (file) => {
      const { status } = runGuard([file], GENERIC_LOW_TODO);
      expect(status).toBe(0);
    },
  );
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

// Shells a `grep -m1 '^NAME=' "$GUARD_SCRIPT" | cut -d= -f2- | tr -d "'"` against the
// REAL script file — the exact same extraction idiom todo-executor.md's research-
// delegation skip-gate uses at runtime, so a test built on it validates the actual
// consumer contract, not a reimplementation. Module-scoped so every describe block that
// needs a constant's live value (SENSITIVE_OVERRIDE, SAFE_ALLOWLIST, STRUCTURAL_SENSITIVE, …)
// shares one implementation.
// Split a regex alternation at TOP LEVEL only. A naive `.split("|")` also splits inside
// `(^|/)` and `(agents|skills)`, which happens to be harmless when both sides of a comparison
// are split the same way, but silently drops `(^|/)\\.claude/(agents|skills)/` out of any
// predicate that inspects whole alternatives.
function splitAlternatives(re: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let esc = false;
  for (const ch of re) {
    if (esc) {
      cur += ch;
      esc = false;
      continue;
    }
    if (ch === "\\") {
      cur += ch;
      esc = true;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "|" && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

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

// Generates a file list via `git ls-files` — the corpus is the real tracked tree, not a
// hand-listed fixture (docs/solutions/code-quality/a-sampled-corpus-described-as-generated).
// No narrowing (`head`, a subdirectory glob meant as a sample, etc.) — callers that want a
// subset pass an explicit pathspec, which git itself resolves, so the result is still a
// full, un-sampled listing of whatever was asked for.
function gitLsFiles(...pathspecs: string[]): string[] {
  return execFileSync("git", ["ls-files", ...pathspecs], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
}

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
  it("ERRORs (exit 2) when the pulls/{n}/files read fails", () => {
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
  // extractConstant is module-scoped (see top of file) so this reuses the same helper.
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

  // These four are new to SENSITIVE_OVERRIDE in this diff. The PATH GATE itself never
  // reaches SENSITIVE_OVERRIDE for these paths (STRUCTURAL_SENSITIVE HOLDs and `continue`s
  // first, at step 2), so the ONLY reachable consumer of SENSITIVE_OVERRIDE's new content
  // for these four paths is this skip-gate — without a row here, removing them from
  // SENSITIVE_OVERRIDE (while leaving STRUCTURAL_SENSITIVE untouched) would leave every
  // other test in this file green.
  it.each([
    ".claude/agents/code-reviewer.md",
    ".claude/skills/todo/SKILL.md",
    "docs/AI_WORKFLOW.md",
    "docs/PATTERNS.md",
  ])(
    "skips delegation for %s under a neutral title (new SENSITIVE_OVERRIDE entry, reachable only through this consumer — see STRUCTURAL_SENSITIVE's own PATH GATE shortcut)",
    (file) => {
      expect(skipGateShouldSkip([file], "Fix pagination bug")).toBe(true);
    },
  );

  // docs/legacy-patterns/ is new to SENSITIVE_OVERRIDE in THIS diff (Risks section of
  // todos/archive/P3-2026-09-16-legacy-patterns-still-takes-the-automerge-markdown-
  // exemption.md: "check both consumers, not just the PATH GATE"). Same reachability gap
  // as the four rows above: the PATH GATE never reaches SENSITIVE_OVERRIDE for this path
  // either (STRUCTURAL_SENSITIVE HOLDs and `continue`s first), so this skip-gate is the
  // only consumer that would notice a regression here.
  it("skips delegation for docs/legacy-patterns/security.md under a neutral title (new SENSITIVE_OVERRIDE entry, reachable only through this consumer)", () => {
    expect(
      skipGateShouldSkip(
        ["docs/legacy-patterns/security.md"],
        "Fix pagination bug",
      ),
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

// Write the changed-file list to a file inside the stub's own temp dir and hand the fake gh
// its PATH. Passing it in the environment instead caps the corpus at Linux's MAX_ARG_STRLEN
// (131072 bytes) — a limit macOS does not share, so an over-size list passes locally and fails
// only on CI. As of 2026-09-20 the docs/solutions/ + todos/ control corpus is ~131KB, i.e. at
// that cliff, and it grows every time a solution doc or todo is added.
function writeDiffFiles(dir: string, files: string[]): string {
  const path = join(dir, "diff-files.txt");
  writeFileSync(path, files.join("\n"));
  return path;
}

function runGuardPathsOnly(files: string[]): {
  status: number | null;
  stdout: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "guard-gh-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "gh"), FAKE_GH_SCRIPT);
  chmodSync(join(dir, "gh"), 0o755);
  const result = spawnSync("bash", [GUARD_SCRIPT, "--paths-only", "123"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH ?? ""}`,
      FAKE_GH_DIFF_FILES_FILE: writeDiffFiles(dir, files),
    },
  });
  return { status: result.status, stdout: result.stdout ?? "" };
}

function runGuardDefault(files: string[]): {
  status: number | null;
  stdout: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "guard-gh-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "gh"), FAKE_GH_SCRIPT);
  chmodSync(join(dir, "gh"), 0o755);
  const result = spawnSync("bash", [GUARD_SCRIPT, "123"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH ?? ""}`,
      FAKE_GH_DIFF_FILES_FILE: writeDiffFiles(dir, files),
    },
  });
  return { status: result.status, stdout: result.stdout ?? "" };
}

// Every case asserts `PR #123` in the output, not only the verdict. Without it none of
// these rows can see whether `--paths-only` was actually SHIFTED off argv: with the shift
// removed, `PR` binds to the literal string `--paths-only`, the fake gh stubs ignore their
// PR argument entirely, and all four produce the same exit code and the same verdict
// substring — `guard: OK PR #--paths-only — …`. Mutation-verified: the assertions below
// are what make the flag-consumption observable.
describe("todo-automerge-guard.sh --paths-only", () => {
  it("passes a safe diff that contains NO todos/archive file", () => {
    const { status, stdout } = runGuardPathsOnly([
      "client/screens/GroceryListScreen.tsx",
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain("PR #123");
  });

  it("still HOLDs a sensitive path", () => {
    const { status, stdout } = runGuardPathsOnly([
      "client/hooks/useNutritionLookup.ts",
    ]);
    expect(status).toBe(1);
    expect(stdout).toContain("not on the batch-merge allowlist");
    expect(stdout).toContain("PR #123");
  });

  it("still HOLDs a non-allowlisted path", () => {
    const { status, stdout } = runGuardPathsOnly(["infra/deploy.yml"]);
    expect(status).toBe(1);
    expect(stdout).toContain("PR #123");
  });

  it("DEFAULT mode is unchanged: the same safe diff still HOLDs on the TODO GATE", () => {
    const { status, stdout } = runGuardDefault([
      "client/screens/GroceryListScreen.tsx",
    ]);
    expect(status).toBe(1);
    expect(stdout).toContain("no todos/archive/*.md in the diff");
    expect(stdout).toContain("PR #123");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Markdown-exemption bypass fix: the step-2 markdown exemption used to run BEFORE any
// sensitivity check, so every whole-directory SENSITIVE_OVERRIDE entry (server/routes/,
// .github/, scripts/, migrations/, docs/rules/) had a silent `\.md$` bypass through it,
// and the files that DEFINE review (.claude/agents/, .claude/skills/, docs/AI_WORKFLOW.md,
// docs/PATTERNS.md) were in no override at all. STRUCTURAL_SENSITIVE now runs first, for
// every file (markdown included). --paths-only is used throughout below because that is
// the exact mode .claude/hooks/merge-review-guard.sh stage 2 calls.
// ─────────────────────────────────────────────────────────────────────────────

describe("todo-automerge-guard.sh (markdown-exemption bypass closed: .claude/agents/ and .claude/skills/ now HOLD)", () => {
  // Generated via git ls-files, not hand-listed — see gitLsFiles's own comment.
  const agentFiles = gitLsFiles(".claude/agents");
  const skillFiles = gitLsFiles(".claude/skills");

  it(`generated a non-empty corpus (${agentFiles.length} .claude/agents/ files, ${skillFiles.length} .claude/skills/ files) — sanity check git ls-files didn't return empty`, () => {
    expect(agentFiles.length).toBeGreaterThan(0);
    expect(skillFiles.length).toBeGreaterThan(0);
  });

  it.each(agentFiles)(
    'HOLDs %s (--paths-only) — the reviewer checklists that define what "reviewed" means',
    (file) => {
      const { status } = runGuardPathsOnly([file]);
      expect(status).toBe(1);
    },
  );

  it.each(skillFiles)(
    "HOLDs %s (--paths-only) — every .claude/skills/ file, including /codify's review-rule routing table",
    (file) => {
      const { status } = runGuardPathsOnly([file]);
      expect(status).toBe(1);
    },
  );

  it.each([
    "docs/AI_WORKFLOW.md",
    "docs/PATTERNS.md",
    ".github/copilot-instructions.md",
  ])(
    "HOLDs %s (--paths-only) — the Review Policy roster / knowledge-base index / Copilot review source",
    (file) => {
      const { status } = runGuardPathsOnly([file]);
      expect(status).toBe(1);
    },
  );

  it("merge-review-guard.sh stage 2 falls through to stage 3 (review record required) for any non-zero GUARD_RC — verified by reading the held, out-of-scope file, not by editing or executing it", () => {
    const hookText = readFileSync(
      join(REPO_ROOT, ".claude/hooks/merge-review-guard.sh"),
      "utf-8",
    );
    expect(hookText).toContain('[ "$GUARD_RC" -eq 0 ] && exit 0');
  });
});

describe("todo-automerge-guard.sh (non-regression: all docs/rules/*.md still HOLD via STRUCTURAL_SENSITIVE, generated not hand-listed)", () => {
  const rulesFiles = gitLsFiles("docs/rules");

  it(`generated all ${rulesFiles.length} docs/rules/*.md files via git ls-files`, () => {
    expect(rulesFiles.length).toBeGreaterThan(0);
  });

  it.each(rulesFiles)(
    "HOLDs %s (--paths-only, unchanged by the reorder)",
    (file) => {
      const { status } = runGuardPathsOnly([file]);
      expect(status).toBe(1);
    },
  );
});

describe("todo-automerge-guard.sh (docs/legacy-patterns/ now HOLDs via STRUCTURAL_SENSITIVE + SENSITIVE_OVERRIDE, generated not hand-listed)", () => {
  // The frozen pattern-documentation archive the newly-protected reviewer checklists cite
  // as their reference body (todos/archive/P3-2026-09-16-legacy-patterns-still-takes-the-
  // automerge-markdown-exemption.md) — previously took the markdown exemption like any
  // ordinary doc, unlike its sibling docs/rules/.
  const legacyPatternsFiles = gitLsFiles("docs/legacy-patterns");

  it(`generated all ${legacyPatternsFiles.length} docs/legacy-patterns/*.md files via git ls-files`, () => {
    expect(legacyPatternsFiles.length).toBeGreaterThan(0);
  });

  it.each(legacyPatternsFiles)(
    "HOLDs %s (--paths-only) — the reference body the reviewer checklists cite",
    (file) => {
      const { status } = runGuardPathsOnly([file]);
      expect(status).toBe(1);
    },
  );
});

describe("todo-automerge-guard.sh (controls, same run: the high-volume docs/todos exemption must not regress)", () => {
  it.each([
    "docs/solutions/best-practices/security-rules-extended-rationale-2026-06-05.md",
    "docs/research/some-benchmark.md",
    "docs/todo-automation-runbook.md",
    "todos/P3-2026-08-05-some-open-todo.md",
    "todos/archive/P3-2026-08-05-another.md",
  ])(
    "still allows %s (--paths-only) — control: the exemption's own high-volume, low-risk case must not have been swallowed",
    (file) => {
      const { status } = runGuardPathsOnly([file]);
      expect(status).toBe(0);
    },
  );
});

describe("todo-automerge-guard.sh (non-regression bound: .claude/settings.json and .claude/hooks/*.sh keep HOLDing via allowlist absence, not the new override)", () => {
  it("SAFE_ALLOWLIST does not match .claude/settings.json or a .claude/hooks/*.sh path — they HOLD at step 1, unaffected by STRUCTURAL_SENSITIVE/SENSITIVE_OVERRIDE (a widened allowlist later would silently expose them; this pins that today's protection is the NARROW allowlist, not the new override)", () => {
    const allowlist = extractConstant("SAFE_ALLOWLIST");
    expect(new RegExp(allowlist).test(".claude/settings.json")).toBe(false);
    expect(new RegExp(allowlist).test(".claude/hooks/some-hook.sh")).toBe(
      false,
    );
  });

  it.each([".claude/settings.json", ".claude/hooks/some-hook.sh"])(
    "HOLDs %s end to end (--paths-only)",
    (file) => {
      const { status } = runGuardPathsOnly([file]);
      expect(status).toBe(1);
    },
  );
});

describe("todo-automerge-guard.sh (generated corpus, both directions, counts quoted with the corpus that produced them)", () => {
  // Full tracked population — no head/narrowing glob (docs/solutions/code-quality/
  // a-sampled-corpus-described-as-generated-2026-09-13.md is exactly this failure mode).
  const allTracked = gitLsFiles();
  const reviewGoverningFiles = [
    ...gitLsFiles(".claude/agents"),
    ...gitLsFiles(".claude/skills"),
    "docs/AI_WORKFLOW.md",
    "docs/PATTERNS.md",
    ".github/copilot-instructions.md",
  ];
  const exemptControlFiles = allTracked.filter(
    (f) => f.startsWith("docs/solutions/") || f.startsWith("todos/"),
  );

  it(`generated the full tracked corpus (${allTracked.length} paths) and both control subsets (${reviewGoverningFiles.length} review-governing, ${exemptControlFiles.length} docs/solutions+todos) via git ls-files — sanity check this is the real corpus, not a stub`, () => {
    expect(allTracked.length).toBeGreaterThan(1000);
    expect(reviewGoverningFiles.length).toBeGreaterThan(0);
    expect(exemptControlFiles.length).toBeGreaterThan(0);
  });

  it(`HOLDs every one of the ${reviewGoverningFiles.length} review-governing files in one batched --paths-only run (direction 1: newly sensitive)`, () => {
    const { status, stdout } = runGuardPathsOnly(reviewGoverningFiles);
    expect(status).toBe(1);
    for (const f of reviewGoverningFiles) {
      expect(stdout).toContain(f);
    }
  });

  // The guard's PATH GATE runs a handful of `grep -qE` calls per file in a bash while
  // loop; ~1750 files takes ~15-20s wall clock, well over vitest's 10s default. Not a
  // hang — the batched-run rows above and below this one finish in well under a second.
  it(`does not regress a single one of the ${exemptControlFiles.length} docs/solutions/ and todos/ files in one batched --paths-only run (direction 2: must-still-PASS control)`, () => {
    const { status } = runGuardPathsOnly(exemptControlFiles);
    expect(status).toBe(0);
  }, 60000);
});

describe("todo-automerge-guard.sh (drift guard: STRUCTURAL_SENSITIVE stays a subset of SENSITIVE_OVERRIDE)", () => {
  it("every STRUCTURAL_SENSITIVE alternative also appears as an alternative in SENSITIVE_OVERRIDE (prevents the exact drift the script's own comment warns about: a path exempted structurally by STRUCTURAL_SENSITIVE but never reaching the SENSITIVE_OVERRIDE check that is supposed to HOLD it as code — the next whole-directory entry added only to SENSITIVE_OVERRIDE and not mirrored here would silently reopen the markdown bypass for that one new directory)", () => {
    const structuralAlternatives = splitAlternatives(
      extractConstant("STRUCTURAL_SENSITIVE"),
    );
    const sensitiveAlternatives = new Set(
      splitAlternatives(extractConstant("SENSITIVE_OVERRIDE")),
    );
    const missing = structuralAlternatives.filter(
      (alt) => !sensitiveAlternatives.has(alt),
    );
    expect(missing).toEqual([]);
  });

  // The assertion above tests STRUCTURAL is a subset of SENSITIVE. That is NOT the direction
  // that protects this fix: adding an entry to SENSITIVE_OVERRIDE only grows the set being
  // subtracted, so it stays green. Measured by mutation — appending `|(^|/)fake-governance/` to
  // SENSITIVE_OVERRIDE alone leaves `missing` empty, while appending the same alternative to
  // STRUCTURAL_SENSITIVE alone turns it red. The markdown bypass reopens in the FIRST direction,
  // so it needs its own assertion.
  //
  // Deliberately NOT set equality: the free-text keywords (`secret`, `[Aa]dmin`, `credential`, …)
  // must stay OUT of STRUCTURAL_SENSITIVE by design — this script measures them at 0 useful vs 33
  // unintended holds. The property that matters is narrower. SAFE_ALLOWLIST ends in a
  // directory-independent `\.md$`, so EVERY directory containing markdown is auto-allowlisted
  // unless it is also named structurally; therefore any whole-directory entry (and the exact
  // doc-path entries, which admit a trailing `/` for a future split-into-a-directory) must be
  // mirrored. A shape test, not a corpus test, so it cannot go quiet as the tree changes.
  it("every whole-directory and exact-doc-path SENSITIVE_OVERRIDE alternative is mirrored in STRUCTURAL_SENSITIVE (the direction that actually reopens the markdown bypass)", () => {
    // Predicate on "this alternative NAMES A PATH", not on one spelling of one. The first
    // version required the `(^|/)...` + trailing-slash form, so it policed only the shape I
    // happened to probe with: measured, `|^docs/legacy-patterns/` and
    // `|(^|/)docs/REVIEW_POLICY\\.md$` both stayed green while being equally exploitable. Both
    // are the ambient idiom here - 9 of SAFE_ALLOWLIST's 14 alternatives use bare `^dir/`, and
    // 11 of SENSITIVE_OVERRIDE's use the `(^|/)x\\.ts$` exact-file form.
    // `\\.ts$` entries are excluded deliberately: a TypeScript path can never be the markdown
    // that SAFE_ALLOWLIST's `\\.md$` tail auto-exempts, so they need no structural mirror.
    const isStructuralShape = (alt: string) =>
      (alt.startsWith("(^|/)") || alt.startsWith("^")) &&
      (alt.endsWith("/") || alt.endsWith("/)") || alt.endsWith("$")) &&
      !alt.endsWith("\\.ts$");
    const structural = new Set(
      splitAlternatives(extractConstant("STRUCTURAL_SENSITIVE")),
    );
    const candidates = splitAlternatives(
      extractConstant("SENSITIVE_OVERRIDE"),
    ).filter(isStructuralShape);
    // Guard the guard: if the shape predicate ever matches nothing, this row would pass
    // vacuously and pin nothing at all.
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.filter((alt) => !structural.has(alt))).toEqual([]);
  });
});

describe("todo-automerge-guard.sh (mutation-verified: STRUCTURAL_SENSITIVE's rc-capture discipline is fail-closed, not a bare && chain)", () => {
  function runScript(
    scriptPath: string,
    files: string[],
  ): { status: number | null } {
    const dir = mkdtempSync(join(tmpdir(), "guard-mutant-gh-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, "gh"), FAKE_GH_SCRIPT);
    chmodSync(join(dir, "gh"), 0o755);
    const result = spawnSync("bash", [scriptPath, "--paths-only", "123"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH ?? ""}`,
        FAKE_GH_DIFF_FILES_FILE: writeDiffFiles(dir, files),
      },
    });
    return { status: result.status };
  }

  function mutantScriptWithBrokenStructuralSensitive(): string {
    const original = readFileSync(GUARD_SCRIPT, "utf-8");
    const mutated = original.replace(
      /^STRUCTURAL_SENSITIVE='[^']*'$/m,
      "STRUCTURAL_SENSITIVE='(unclosed'",
    );
    // Sanity check the mutation itself actually landed — otherwise this "mutation test"
    // would silently run the healthy script twice and both rows would pass for the wrong
    // reason (docs/solutions/code-quality/a-guard-and-its-mutation-test-can-both-be-inert).
    expect(mutated).not.toBe(original);
    const dir = mkdtempSync(join(tmpdir(), "guard-mutant-src-"));
    tempDirs.push(dir);
    const mutantPath = join(dir, "todo-automerge-guard.sh");
    writeFileSync(mutantPath, mutated);
    chmodSync(mutantPath, 0o755);
    return mutantPath;
  }

  const CONTROL_FILE =
    "docs/solutions/best-practices/security-rules-extended-rationale-2026-06-05.md";

  it(`control: the healthy (unmutated) script still PASSES ${CONTROL_FILE} — proves the harness itself is not broken before trusting the mutant row below`, () => {
    const { status } = runScript(GUARD_SCRIPT, [CONTROL_FILE]);
    expect(status).toBe(0);
  });

  it(`mutant: a malformed STRUCTURAL_SENSITIVE (grep rc >= 2) HOLDs the SAME ${CONTROL_FILE} instead of silently taking the markdown exemption — fail-closed, mirroring step 4's existing rc_sens idiom, not a bare && chain that would invert a regex error into a silent PASS`, () => {
    const mutantPath = mutantScriptWithBrokenStructuralSensitive();
    const { status } = runScript(mutantPath, [CONTROL_FILE]);
    expect(status).toBe(1);
  });
});

describe("todo-automerge-guard.sh (rename source paths are gated, not just destinations)", () => {
  // `gh pr diff --name-only` reports a git-detected RENAME as its DESTINATION only, so a
  // high-similarity move OUT of a covered directory used to read as one ordinary new markdown
  // file, take the SAFE_ALLOWLIST exemption, and arm auto-merge. Measured against this repo when
  // the hole was found: PR #977 carries `R067 todos/… -> todos/archive/…` and `gh pr diff 977
  // --name-only` lists only the destination, while control PR #965 (scored delete+add rather
  // than a rename) lists BOTH paths — so removals ARE normally listed and the blind spot is
  // specific to renames. The guard now reads pulls/{n}/files and emits `previous_filename`.
  //
  // These two rows differ ONLY by the presence of `previous_filename`, so a pass here cannot be
  // explained by the destination path, the todo gate, or the archive row. The stub runs the
  // guard's OWN `--jq` over this JSON, so the jq expression is what is under test.
  const RENAMED_OUT = "docs/solutions/kb/code-reviewer.md";

  it("HOLDs a PR that renames a reviewer checklist OUT of .claude/agents/ (source path is gated)", () => {
    const { status } = runGuardRaw({
      FAKE_GH_PR_FILES_JSON: JSON.stringify([
        { filename: ARCHIVE_PATH },
        {
          filename: RENAMED_OUT,
          previous_filename: ".claude/agents/code-reviewer.md",
        },
      ]),
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).toBe(1);
  });

  it("control — the identical destination path with NO previous_filename still passes, so the HOLD above is attributable to the rename source alone", () => {
    const { status } = runGuardRaw({
      FAKE_GH_PR_FILES_JSON: JSON.stringify([
        { filename: ARCHIVE_PATH },
        { filename: RENAMED_OUT },
      ]),
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).toBe(0);
  });
});

describe("todo-automerge-guard.sh (a truncated file list is refused, not gated)", () => {
  // `--paginate` closes the per-page truncation only; it cannot page past the endpoint's
  // server-side maximum file count. Under-reporting is the dangerous direction because of the
  // CONSUMER: merge-review-guard.sh reads this guard's exit 0 as "no review record required",
  // so a short list is a merge-gate bypass rather than a missed auto-merge HOLD. Rename sources
  // only ever ADD lines, so a count BELOW the PR's declared total can only mean truncation.
  it("ERRORs (exit 2) when fewer paths come back than the PR declares changed", () => {
    const { status, stdout } = runGuardRaw({
      FAKE_GH_DIFF_FILES: [ARCHIVE_PATH, "client/a.ts"].join("\n"),
      FAKE_GH_CHANGED_FILES: "9",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).toBe(2);
    expect(stdout).toContain("truncated");
  });

  it("control — the same paths with an agreeing declared count are gated normally, so the ERROR above is attributable to the mismatch alone", () => {
    const { status } = runGuardRaw({
      FAKE_GH_DIFF_FILES: [ARCHIVE_PATH, "client/a.ts"].join("\n"),
      FAKE_GH_CHANGED_FILES: "2",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).not.toBe(2);
  });

  it("control — a rename SOURCE pushing the count ABOVE the declared total is not mistaken for truncation", () => {
    const { status } = runGuardRaw({
      FAKE_GH_PR_FILES_JSON: JSON.stringify([
        { filename: ARCHIVE_PATH },
        { filename: "client/a.ts", previous_filename: "client/old.ts" },
      ]),
      FAKE_GH_CHANGED_FILES: "2",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).not.toBe(2);
  });
});

describe("todo-automerge-guard.sh (rename sources cannot MASK a truncated file list)", () => {
  // The first version of the completeness check counted LINES against a FILE count. Because a
  // rename source is an extra line, R renames masked R files truncated away — measured: declared
  // 3 with two destinations plus one rename source reached 3 lines and returned OK, so a
  // protected .claude/agents/ markdown truncated out of the page went from HOLD to a merge-gate
  // pass. Counting destination rows against declared files is what closes it, and this row is
  // the regression pin: it is GREEN only while the two sides measure the same unit.
  it("ERRORs (exit 2) when a rename source pads the line count up to the declared total", () => {
    const { status, stdout } = runGuardRaw({
      FAKE_GH_PR_FILES_JSON: JSON.stringify([
        { filename: ARCHIVE_PATH },
        { filename: "client/a.ts", previous_filename: "client/old.ts" },
      ]),
      FAKE_GH_CHANGED_FILES: "3",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).toBe(2);
    expect(stdout).toContain("truncated");
  });

  // A rename whose source is reported as an EMPTY STRING rather than absent: jq truthiness makes
  // "" TRUE, so the original sentinel predicate skipped it and emitted a blank path that both
  // the count and the gating loop then dropped silently. GitHub does not emit this today; the
  // predicate is hardened rather than relying on that.
  it("ERRORs (exit 2) on a renamed row whose previous_filename is an empty string", () => {
    const { status, stdout } = runGuardRaw({
      FAKE_GH_PR_FILES_JSON: JSON.stringify([
        { filename: ARCHIVE_PATH },
        { filename: "client/a.ts", status: "renamed", previous_filename: "" },
      ]),
      FAKE_GH_CHANGED_FILES: "2",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).toBe(2);
    expect(stdout).toContain("previous_filename");
  });
});

describe("todo-automerge-guard.sh (fail-closed arms survive a payload larger than the pipe buffer)", () => {
  // `grep -q` exits on first match. Fed by a producer PIPE under `set -o pipefail`, the writer
  // takes SIGPIPE and the pipeline returns 141, so the `if` is FALSE and the sentinel is skipped
  // — but ONLY once the payload exceeds the 64KB pipe buffer. A small input passes happily, which
  // is exactly why that regression shipped. These rows go through FAKE_GH_PR_FILES_JSON so the
  // guard's own jq runs; the FAKE_GH_DIFF_FILES branch prefixes every line itself and could never
  // reproduce it.
  const PIPE_BUF_BYTES = 65536;
  const bigRows = [
    { filename: ARCHIVE_PATH },
    { filename: "client/renamed.ts", status: "renamed" }, // no previous_filename -> the X row
    // Cross the threshold with FEW, LONG paths rather than many short ones. The regime is a BYTE
    // count; the guard's PATH GATE cost is a ROW count, because it loops per file running greps.
    // 4000 short rows cleared 64KB and then timed out on CI under coverage instrumentation —
    // the expensive dimension was the one that did not matter.
    ...Array.from({ length: 520 }, (_, i) => ({
      filename: `client/generated/${"deeply-nested-fixture-segment/".repeat(4)}file-${String(i).padStart(5, "0")}.ts`,
    })),
  ];
  // The emitted form is "F " + path + "\n" per destination — the value the mechanism actually
  // sees, not the JSON we constructed.
  const emittedBytes =
    bigRows.reduce((n, r) => n + 2 + r.filename.length + 1, 0) + 2;

  it("REGIME PRECONDITION — the large payload really is above the pipe buffer", () => {
    // Below the threshold the row beneath would pass for the wrong reason.
    expect(emittedBytes).toBeGreaterThan(PIPE_BUF_BYTES);
  });

  it("ERRORs (exit 2) on an unusable rename source even when the emitted list exceeds the pipe buffer", () => {
    const { status, stdout } = runGuardRaw({
      FAKE_GH_PR_FILES_JSON: JSON.stringify(bigRows),
      FAKE_GH_CHANGED_FILES: String(bigRows.length),
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).toBe(2);
    // Assert the DIAGNOSTIC, not just the code: three separate arms exit 2 here, so a bare
    // status check cannot attribute the ERROR to the sentinel this row is named for. Measured —
    // dropping `X$` from the class-check allowed set leaves this row green at 2 while stdout
    // reads "could not be classed" instead.
    expect(stdout).toContain("previous_filename");
  }, 60000);

  it("control — the same unusable rename source BELOW the pipe buffer also errors, so the row above is about the regime and not the row", () => {
    const smallRows = [
      { filename: ARCHIVE_PATH },
      { filename: "client/renamed.ts", status: "renamed" },
    ];
    const smallBytes =
      smallRows.reduce((n, r) => n + 2 + r.filename.length + 1, 0) + 2;
    expect(smallBytes).toBeLessThan(PIPE_BUF_BYTES);
    const { status, stdout } = runGuardRaw({
      FAKE_GH_PR_FILES_JSON: JSON.stringify(smallRows),
      FAKE_GH_CHANGED_FILES: String(smallRows.length),
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).toBe(2);
    expect(stdout).toContain("previous_filename");
  });
});

describe("todo-automerge-guard.sh (a filename carrying a literal newline is refused as B, not raw-printed)", () => {
  // Was "a row that cannot be classed is refused" and asserted `stdout.toContain("class")`.
  // The fixture below (a filename with an embedded newline, no "F "-look-alike tail) now hits
  // the jq-level B sentinel BEFORE the row ever reaches the class-strip: `.filename | test("\n")`
  // reads the structured JSON string directly and suppresses the F row entirely, so the row
  // arrives already classed as "B" — the old generic "row came back without a recognisable
  // class" arm is no longer what fires for this specific cause, only the more precise, dedicated
  // B-sentinel diagnostic is. Re-fixturing and re-asserting rather than just flipping the old
  // expectation, per docs/solutions/code-quality/flipped-test-expectation-must-recheck-which-gate-it-now-hits-2026-08-28.md:
  // a bare `toBe(2)` can't tell "still generically unclassed" from "now specifically refused as a
  // forged-newline risk", and this test exists to prove the LATTER.
  it("ERRORs (exit 2) via the B sentinel when a filename contains a literal newline, instead of raw-printing it as a second (unclassed) line", () => {
    const { status, stdout } = runGuardRaw({
      FAKE_GH_PR_FILES_JSON: JSON.stringify([
        { filename: ARCHIVE_PATH },
        { filename: ".claude/agents/code-reviewer.md\nclient/safe.ts" },
      ]),
      FAKE_GH_CHANGED_FILES: "2",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).toBe(2);
    expect(stdout).toContain("newline");
  });

  it("control — ordinary rows all class cleanly and are gated normally, so the refusal above is attributable to the newline-bearing row", () => {
    const { status } = runGuardRaw({
      FAKE_GH_PR_FILES_JSON: JSON.stringify([
        { filename: ARCHIVE_PATH },
        { filename: "client/safe.ts" },
      ]),
      FAKE_GH_CHANGED_FILES: "2",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).toBe(0);
  });
});

describe("todo-automerge-guard.sh (a filename that forges a self-classing 'F ' row cannot inflate the completeness count)", () => {
  // The exact shape from the P2 review that filed this todo: unlike the plain unclassed-row
  // fixture above, this filename's embedded-newline TAIL is itself crafted to look like a real
  // destination row ("F client/b.ts"). Under the pre-fix classing scheme that tail passed the
  // class check trivially (it matches `^F `) and was counted as a genuine second destination,
  // so `seen_files` reached the PR's declared total though only one real file — plus the
  // archive — had actually been returned. Measured against the unfixed script (git history):
  // declared 3, two real elements (archive + this one) => 3 raw "F " lines => rc 0 "guard: OK".
  it("ERRORs (exit 2) — the self-classing tail is refused via B, not counted as a second destination", () => {
    const { status, stdout } = runGuardRaw({
      FAKE_GH_PR_FILES_JSON: JSON.stringify([
        { filename: ARCHIVE_PATH },
        { filename: "client/a.ts\nF client/b.ts" },
      ]),
      FAKE_GH_CHANGED_FILES: "3",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).toBe(2);
    // Attributable to the newline arm specifically — several arms in this script exit 2, and a
    // bare status check cannot tell this one from, say, the unrelated "truncated" arm.
    expect(stdout).toContain("newline");
  });

  it("control — the same two paths with NO embedded newline, and a declared count that agrees with the real total, are gated normally", () => {
    const { status } = runGuardRaw({
      FAKE_GH_PR_FILES_JSON: JSON.stringify([
        { filename: ARCHIVE_PATH },
        { filename: "client/a.ts" },
      ]),
      FAKE_GH_CHANGED_FILES: "2",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).not.toBe(2);
  });
});

describe("todo-automerge-guard.sh (a filename that forges BOTH a self-classing row AND a compensating count row cannot survive the B sentinel)", () => {
  // code-reviewer WARNING (P2 review round): every other forged-row test above is ALSO caught by
  // the STRUCTURAL ROW COUNT check alone (N vs. raw F mismatches on a simple forged F-only tail),
  // so none of them can tell "the shipped B-sentinel fix" apart from a weaker N-row-only
  // implementation matching the Acceptance Criteria's literal text. This fixture is the one input
  // that DOES discriminate: the filename embeds a forged "F " row AND a forged, compensating "N "
  // row in the SAME payload ("client/a.ts\nF client/b.ts\nN 1"), chosen so that total_N and
  // raw_F_count would BALANCE (3 == 3) under an N-row-only design with no B branch — measured by
  // both the implementer and the code-reviewer round against a hand-built AC-literal filter. Only
  // the B sentinel, which suppresses the ENTIRE item's F/N-shaped output the moment a newline is
  // found (regardless of what the newline's tail spells), closes this.
  it("ERRORs (exit 2) via B — a compensating forged 'N' row cannot make a forged 'F' row balance the structural count", () => {
    const { status, stdout } = runGuardRaw({
      FAKE_GH_PR_FILES_JSON: JSON.stringify([
        { filename: ARCHIVE_PATH },
        { filename: "client/a.ts\nF client/b.ts\nN 1" },
      ]),
      FAKE_GH_CHANGED_FILES: "3",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).toBe(2);
    expect(stdout).toContain("newline");
  });

  it("control — the same two paths with NO embedded newline, and a declared count that agrees with the real total, are gated normally", () => {
    const { status } = runGuardRaw({
      FAKE_GH_PR_FILES_JSON: JSON.stringify([
        { filename: ARCHIVE_PATH },
        { filename: "client/a.ts" },
      ]),
      FAKE_GH_CHANGED_FILES: "2",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).not.toBe(2);
  });
});

describe("todo-automerge-guard.sh (a forged 'F todos/archive/...' tail cannot satisfy the TODO GATE for a file that is not really in the diff)", () => {
  // The second consequence this todo closes: `files` (the TODO GATE's own input) is built from
  // the SAME raw_files stream the completeness check reads, so a self-classing forged tail that
  // spells a real todos/archive/*.md path used to let the TODO GATE "find" an archived todo that
  // was never genuinely part of the diff — measured pre-fix: no real archive file, declared 1,
  // one element whose filename forges an "F todos/archive/<path>" tail present in the PR head =>
  // rc 0 "guard: OK", flipped from the correct rc 1 "no todos/archive/*.md in the diff" a plain
  // version of the same input returns. This is now closed at the SAME B sentinel, not a second,
  // new gate — the forged tail never reaches "F "-classed text at all, regardless of which
  // downstream consumer (completeness count or TODO GATE) would have read it.
  it("ERRORs (exit 2) — a forged 'F todos/archive/...' tail does not flip the guard to OK, or even to a TODO-GATE HOLD", () => {
    const { status, stdout } = runGuardRaw({
      FAKE_GH_PR_FILES_JSON: JSON.stringify([
        { filename: `client/only-real-file.ts\nF ${ARCHIVE_PATH}` },
      ]),
      FAKE_GH_CHANGED_FILES: "1",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).toBe(2);
    expect(stdout).toContain("newline");
  });

  it("control — the identical real file with NO forged tail correctly HOLDs at the TODO GATE (no archive in the diff), attributing the row above to the forgery alone", () => {
    const { status, stdout } = runGuardRaw({
      FAKE_GH_PR_FILES_JSON: JSON.stringify([
        { filename: "client/only-real-file.ts" },
      ]),
      FAKE_GH_CHANGED_FILES: "1",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).toBe(1);
    expect(stdout).toContain("no todos/archive");
  });
});

describe("todo-automerge-guard.sh (STRUCTURAL ROW COUNT sums every page's 'N' row, not just the first)", () => {
  // `--paginate` re-runs the guard's --jq filter once PER PAGE (gh help api: "Each page is a
  // separate JSON array or object"), so a >1-page response emits more than one "N <count>" row.
  // Reading only the first would fail-closed on every ordinary PR whose file count crosses a
  // page boundary — this pins the sum, using FAKE_GH_PR_FILES_JSON_PAGES to make the stub re-run
  // the guard's real jq filter once per page, exactly mirroring gh's own semantics.
  it("passes a two-page response (1 file + 2 files) whose declared total (3) matches the SUM of both pages' N rows", () => {
    const { status } = runGuardRaw({
      FAKE_GH_PR_FILES_JSON_PAGES: JSON.stringify([
        [{ filename: ARCHIVE_PATH }],
        [{ filename: "client/a.ts" }, { filename: "client/b.ts" }],
      ]),
      FAKE_GH_CHANGED_FILES: "3",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).not.toBe(2);
  });
});

describe("todo-automerge-guard.sh (STRUCTURAL ROW COUNT mismatch arm actually fires)", () => {
  // The real jq filter can never emit an "N" row that disagrees with the raw "F" row count —
  // that's what the B sentinel guarantees (an arm that cannot be reached through production
  // code is one this suite can only exercise by lying in the stub). FAKE_GH_N_ROW makes the
  // fake `gh`'s emitted N row diverge from the true file count, which is the one way to prove
  // the `-ne` comparison actually fires rather than being dead code — "an arm that cannot fail
  // pins nothing."
  it("ERRORs (exit 2) when the emitted N row disagrees with the raw 'F' row count", () => {
    const { status, stdout } = runGuardRaw({
      FAKE_GH_DIFF_FILES: [ARCHIVE_PATH, "client/a.ts"].join("\n"),
      FAKE_GH_N_ROW: "5",
      FAKE_GH_CHANGED_FILES: "2",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).toBe(2);
    expect(stdout).toContain("does not match the count row");
  });

  it("control — the same files with NO N-row override are gated normally, so the ERROR above is attributable to the lying N row alone", () => {
    const { status } = runGuardRaw({
      FAKE_GH_DIFF_FILES: [ARCHIVE_PATH, "client/a.ts"].join("\n"),
      FAKE_GH_CHANGED_FILES: "2",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).not.toBe(2);
  });
});

describe("todo-automerge-guard.sh (a duplicate destination cannot MASK a truncated file list)", () => {
  // Sibling of the rename-source masking above, one layer down: there the padding line was a
  // SOURCE, here it is the same DESTINATION returned twice — possible across a `--paginate` page
  // boundary. A raw `grep -c '^F '` counts it twice, so D duplicates mask D files truncated away
  // and the short list is gated as if complete. Counting DISTINCT destinations is what closes it.
  it("ERRORs (exit 2) when a repeated destination pads the count up to the declared total", () => {
    const { status, stdout } = runGuardRaw({
      FAKE_GH_PR_FILES_JSON: JSON.stringify([
        { filename: ARCHIVE_PATH },
        { filename: "client/a.ts" },
        { filename: "client/a.ts" },
      ]),
      FAKE_GH_CHANGED_FILES: "3",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).toBe(2);
    expect(stdout).toContain("truncated");
  });

  it("control — three DISTINCT destinations against the same declared total are gated normally, so the ERROR above is attributable to the duplicate", () => {
    const { status } = runGuardRaw({
      FAKE_GH_PR_FILES_JSON: JSON.stringify([
        { filename: ARCHIVE_PATH },
        { filename: "client/a.ts" },
        { filename: "client/b.ts" },
      ]),
      FAKE_GH_CHANGED_FILES: "3",
      FAKE_GH_FRONTMATTER: GENERIC_LOW_TODO,
    });
    expect(status).not.toBe(2);
  });
});
