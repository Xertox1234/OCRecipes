# Widen the Todo Auto-Merge Path Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Post-implementation note (2026-07-08):** this plan's 4 tasks shipped as designed, but two
> post-Task-4 corrections changed the final `server/routes/` behavior described below — it was
> widened here, then reverted to HOLD-by-default after a final review found real auth-security
> logic slipping through untouched, and two `client/` files (`query-client.ts`, `reporter.ts`)
> were separately closed by the same review. This plan's embedded code blocks are NOT updated to
> match — they're the as-designed record, not the as-shipped one. For the final, shipped state
> and the incident narrative, see the spec's "Incident" sections and the actual commit range
> `48a374d2..50075931` on `worktree-widen-todo-automerge-path-gate` (PR #549).

**Goal:** Let low/medium-priority `/todo` PRs touching `server/routes/` and `server/storage/` auto-merge (they currently HOLD purely because those directories were never allowlisted), while adding a second, independent safety layer (a sensitive-domain keyword check on the todo's own title/frontmatter) so no path-pattern gap can silently expose auth/session/admin/IAP/health work.

**Architecture:** One bash script (`scripts/todo-automerge-guard.sh`) owns two gates: a PATH gate (`SAFE_ALLOWLIST` + `SENSITIVE_OVERRIDE`) and a TODO gate (priority + `security` label + the new `SENSITIVE_INTENT_KEYWORDS` check). Both `.claude/agents/todo-executor.md` and `docs/todo-automation-runbook.md` describe this script's behavior in prose and must be kept in sync; `todo-executor.md` additionally sources `SENSITIVE_OVERRIDE` (and will now also source `SENSITIVE_INTENT_KEYWORDS`) at runtime for its own unrelated research-delegation skip-gate, so these two constants are single-sourced in the guard script.

**Tech Stack:** Bash (the guard script itself), Vitest + Node's `child_process`/`fs` (new test harness that spawns the real script with a stubbed `gh` on `PATH`), Markdown (the two docs).

## Global Constraints

- Never commit or push directly to `main`; do this work on a feature branch and open a PR for review (`CLAUDE.md` → Git Workflow). This branch is a direct, interactively-authored change to the guard script itself — it does not go through the `/todo` executor pipeline, and if it ever did, `scripts/` changes always HOLD by the guard's own design, so it always gets individual human review regardless.
- Strict TDD: write the failing test, then implement, then verify all tests pass (`CLAUDE.md` → Development Process). For the handful of cases that test _unchanged_ existing behavior (regression tests), "failing" isn't applicable — write them, run them, and confirm they already pass against the _current_ script; that's the correct TDD checkpoint for a refactor/extension, not a defect.
- Do not run `npm run test:run`, `check:types`, or `lint` ad hoc mid-session — CI and the push-time fast gate are the source of truth (`CLAUDE.md` → Workflow Standards). Run the new test file directly via `npx vitest run scripts/__tests__/todo-automerge-guard.test.ts` for local iteration instead.
- Spec: `docs/superpowers/specs/2026-07-08-todo-automerge-path-gate-widening-design.md` (gitignored local scratch — not part of the commit).

---

### Task 1: Guard script — test harness, full test suite, and implementation

**Files:**

- Create: `scripts/__tests__/todo-automerge-guard.test.ts`
- Modify: `scripts/todo-automerge-guard.sh` (full rewrite of the constants + one new check; existing gate logic and comments elsewhere are preserved verbatim)

**Interfaces:**

- Consumes: nothing from other tasks (this is the first task).
- Produces: the guard script's three regex constants (`SAFE_ALLOWLIST`, `SENSITIVE_OVERRIDE`, `SENSITIVE_INTENT_KEYWORDS`) that Task 2 will source by name (`grep -m1 '^SENSITIVE_OVERRIDE='` / `'^SENSITIVE_INTENT_KEYWORDS='` against this same file, unchanged extraction mechanism). Task 2 and Task 3 also rely on the exact HOLD/OK exit-code semantics (0 = eligible, 1 = HOLD, 2 = tooling error) being unchanged — they are.

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b chore/widen-todo-automerge-path-gate
```

- [ ] **Step 2: Write the test harness and full test suite**

Create `scripts/__tests__/todo-automerge-guard.test.ts`:

```typescript
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
    "client/components/SessionExpiryBridge.tsx",
    "client/screens/VerifyEmailScreen.tsx",
    "server/routes/store-webhooks.ts",
    "server/routes/_admin.ts",
    "server/routes/admin-api-keys.ts",
    "client/context/PremiumContext.tsx",
    "client/hooks/usePremiumFeatures.ts",
    "client/screens/LoginScreen.tsx",
    "server/storage/api-keys.ts",
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
    "Add health score to recipe card",
    "Improve healthy-recipe filter",
    "Show health insights on dashboard",
  ])(
    "does NOT HOLD a generic allowlisted file for the ordinary recipe-domain title %j (session/verif/receipt/secret/health deliberately excluded from SENSITIVE_INTENT_KEYWORDS — they collide with this app's own vocabulary; see spec's calibration table)",
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
```

- [ ] **Step 3: Run the suite against the current (unmodified) script and confirm the expected split**

```bash
npx vitest run scripts/__tests__/todo-automerge-guard.test.ts
```

Expected: the four `describe` blocks split as follows —

- `(regression — behavior unchanged by this widening)`: **all PASS** (this is the current script's existing, correct behavior — these tests exist to prove Step 5's implementation doesn't regress it).
- `(new: widened path allowlist)`: **all FAIL** (`server/routes/`, `server/storage/`, and bare `client/hooks/` aren't on today's allowlist yet).
- `(new: expanded sensitive-path override)`: **all FAIL** (none of these files are on today's allowlist at all yet, so they already HOLD today for the _wrong_ reason — via gate 1, "not on allowlist" — rather than gate 3, the sensitive override; the test only asserts the exit code, which happens to already be 1, so a subset of these may in fact already PASS today. That's fine — after Step 5 they must _still_ be 1, but via the override, not by omission. Don't worry about which ones already pass; just confirm none now report exit 0.)
- `(new: sensitive-intent keyword gate)`: **all FAIL** (the `SENSITIVE_INTENT_KEYWORDS` check doesn't exist yet, so nothing HOLDs on title content).

If the split doesn't roughly match this, stop and re-check the harness (a bad fake-`gh` stub or a malformed frontmatter fixture is far more likely than the guard script itself being wrong at this point).

- [ ] **Step 4: Rewrite the guard script**

Replace the full contents of `scripts/todo-automerge-guard.sh` with:

```bash
#!/usr/bin/env bash
# todo-automerge-guard.sh — FAIL-CLOSED batch-merge eligibility check for /todo PRs.
#
# MODEL (2026-07-06 restored — see docs/todo-automation-runbook.md): a guard-OK PR gets
# GitHub's native `gh pr merge --auto` armed by the /todo executor immediately, so it
# lands on its own once CI is green. This script only CLASSIFIES eligibility — it never
# merges anything itself. A /todo PR is eligible ONLY if BOTH gates pass:
#   1. TODO GATE — the archived todo riding the PR (todos/archive/<slug>.md) has
#      priority low|medium, no `security` mention, and no sensitive-intent keyword
#      (auth/session/admin/etc. — see SENSITIVE_INTENT_KEYWORDS) in its frontmatter.
#      This lives here, not only in the executor, because a fresh morning session
#      re-running this guard has no overnight MERGE_ELIGIBLE report — the guard is the
#      one artifact every merge path re-runs, so it must enforce the whole policy itself.
#   2. PATH GATE — EVERY changed file is on the known-safe ALLOWLIST and none hits the
#      sensitive override.
# Anything else HOLDs for individual human review — an unanticipated path, the whole
# server/middleware/ directory, .github/ (the CI gates), scripts/ (incl. this guard),
# migrations, shared/schema.ts, secrets/certs, plus explicit sensitive files named in
# SENSITIVE_OVERRIDE that live inside the otherwise-open client/, server/routes/, and
# server/storage/ roots.
#
# To widen the pass: ADD a known-safe prefix to SAFE_ALLOWLIST. If you allowlist a dir
# that also holds a sensitive file (e.g. server/services holds the IAP services), add
# that file to SENSITIVE_OVERRIDE so it still HOLDs. A missed allowlist entry only costs
# a manual merge; never the other way around.
#
# Usage:  scripts/todo-automerge-guard.sh <pr-number>
# Exit 0 = eligible for the user's batch-merge (MERGE_ELIGIBLE: yes) — NOT a merge command
# Exit 1 = HOLD: needs individual review — a changed file is sensitive / not on the
#          allowlist, or the TODO gate failed (no archived todo in the diff, an archive
#          file absent from the PR head, priority not low/medium, 'security' in its
#          frontmatter, or a sensitive-intent keyword in its frontmatter)
# Exit 2 = ERROR: could not evaluate (gh failure / empty diff) — fail-closed, treat as HOLD
# The caller distinguishes a real HOLD (1) from a tooling error (2): a HOLD means the PR
# needs individual review; an error means eligibility couldn't be decided (e.g. gh unauth).
# Nothing in this script merges anything; the user batch-merges eligible PRs themselves.
set -euo pipefail

PR="${1:?usage: todo-automerge-guard.sh <pr-number>}"

# Known-safe surfaces. A file is batch-merge-eligible only if it matches one of these:
# all of client/ (UI, hooks, context, lib, screens, navigation, constants, ...), all of
# server/routes/ and server/storage/ (minus the sensitive files named in
# SENSITIVE_OVERRIDE below), business-logic services, shared pure modules (types /
# zod-schemas / constants / lib), any test, an extracted *-utils file, and docs/todos/
# markdown. NOTE: server/middleware/, migrations/, shared/schema.ts, .github/, scripts/,
# certs, .env are deliberately ABSENT — they HOLD in full, not file-by-file.
SAFE_ALLOWLIST='^client/|^server/routes/|^server/storage/|^server/services/|^shared/types/|^shared/schemas/|^shared/constants/|^shared/lib/|(^|/)__tests__/|\.test\.[jt]sx?$|\.spec\.[jt]sx?$|(-|\.)utils\.tsx?$|^docs/|^todos/|\.md$'

# Sensitive files that DO live inside an allowlisted dir and must HOLD anyway: the IAP /
# billing surfaces (receipt-validation, store-notification, store-webhook, subscription-*,
# entitlement, Premium*), the health-PII onboarding screens (client/**Health*), and the
# auth/session/admin surfaces now exposed by opening client/, server/routes/, and
# server/storage/ as whole roots — server/middleware/ (whole dir, defense-in-depth for
# todo-executor.md's separate skip-gate, which sources this constant), server/routes/auth,
# token-storage, AuthContext, useAuth, VerifyEmailScreen (the ONE real auth-adjacent
# "verification" surface — deliberately NOT a broad *verif*-named match: server/routes/
# verification.ts, server/storage/verification.ts, and VerificationBadge are the Verified
# Product API, a barcode/nutrition-data feature with nothing to do with auth, confirmed
# by reading their imports; a broad pattern here would have permanently blocked that
# entire feature area), server/storage/users.ts (content-sensitive role/mass-assignment
# surface, not name-sensitive), sessions.ts (auth session storage — anchored so it does
# NOT match the unrelated CookSession/QuickLogSession feature), SessionExpiryBridge,
# admin*, and Login*. Grocery "receipt" OCR (receipt.ts, Receipt*Screen) and
# push-notification tokens (push-tokens.ts, push-token-registration) are NOT sensitive
# and must pass.
SENSITIVE_OVERRIDE='receipt-validation|store-notification|store-webhook|(^|/)subscription|(^|/)iap[./-]|apple-?iap|google-?(iap|play)|app-store-server|in-app-purchase|entitlement|(^|/)[Hh]ealth|(^|/)server/middleware/|(^|/)server/routes/auth|token-storage|AuthContext|useAuth|VerifyEmailScreen|(^|/)server/storage/users\.ts$|(^|/)sessions\.ts$|SessionExpiryBridge|admin|Premium|[Ll]ogin|api-key|secret|credential'

# Sensitive-domain keywords for the TODO gate's intent check (below): HOLDs any todo
# whose own title/frontmatter names a sensitive domain, regardless of which file it ends
# up touching — the backstop for a future sensitive file whose name gives no signal (see
# server/storage/users.ts in SENSITIVE_OVERRIDE above for why this matters). Deliberately
# narrower than SENSITIVE_OVERRIDE: session/verif/receipt/secret/health are excluded here
# even though they (or their path form) appear above, because as FREE-TEXT TITLE WORDS
# (not file paths) they collide with this app's own routine vocabulary — "secret
# ingredient", "grocery receipt OCR", "cook session", "barcode verification", "health
# score on recipe card" are all ordinary, non-sensitive todo titles that would otherwise
# HOLD for no reason. The specific files those words protect by path (sessions.ts,
# SessionExpiryBridge, VerifyEmailScreen, receipt-validation, Health*.tsx) are already
# covered above and don't need duplicate coverage here. Dropping health from THIS list has
# a small residual cost (health-PII in an innocuously named file, e.g. profile-hub.ts,
# isn't path-covered by name) accepted because the false-HOLD rate is large and certain
# while CI + review remain as backstops — see the spec's calibration section. Sourced at
# runtime by todo-executor.md's research-delegation skip-gate too — one definition.
SENSITIVE_INTENT_KEYWORDS='auth|jwt|login|password|admin|premium|subscription|iap|api-key|credential'

files="$(gh pr diff "$PR" --name-only)" || {
  echo "guard: ERROR PR #$PR — could not read changed files (gh error). Fail-closed."
  exit 2
}
if [ -z "$files" ]; then
  echo "guard: ERROR PR #$PR — no file changes (nothing to evaluate)"
  exit 2
fi

# ── TODO GATE ─────────────────────────────────────────────────────────────────
# The todo's priority and labels ride the PR as todos/archive/<slug>.md frontmatter —
# the PR itself carries no GitHub label. Parse it from the PR head. Fail-closed at
# every step: no archived todo in the diff, unreadable content, or a priority other
# than low/medium ⇒ HOLD. Any mention of "security" ANYWHERE in the frontmatter
# (labels, title, …) HOLDs — deliberately broad; a false-positive HOLD only costs a
# manual review, never the other way around.
todo_files="$(printf '%s\n' "$files" | grep -E '^todos/archive/.+\.md$' || true)"
if [ -z "$todo_files" ]; then
  echo "guard: HOLD PR #$PR — no todos/archive/*.md in the diff; cannot verify the todo's priority/labels (fail-closed)"
  echo "Needs individual review; exclude from the batch-merge."
  exit 1
fi
while IFS= read -r tf; do
  [ -z "$tf" ] && continue
  # Capture stderr too: a 404 (file listed in the diff but absent from the PR head) is a
  # policy HOLD — the archive can't be verified, so the PR can't be eligible. Any other
  # failure stays exit 2 (tooling error), with the gh error echoed instead of discarded.
  # On SUCCESS, stray stderr noise (e.g. a gh update banner) can land in $raw — harmless:
  # the frontmatter awk below only reads lines between the first pair of --- markers.
  if ! raw="$(gh api -H "Accept: application/vnd.github.raw" "repos/{owner}/{repo}/contents/${tf}?ref=refs/pull/${PR}/head" 2>&1)"; then
    if grep -qE '\bHTTP 404\b|"status": *"404"' <<< "$raw"; then
      echo "guard: HOLD PR #$PR — ${tf} is listed in the diff but absent from the PR head (deleted?); cannot verify frontmatter"
      echo "Needs individual review; exclude from the batch-merge."
      exit 1
    fi
    echo "guard: ERROR PR #$PR — could not read ${tf} from the PR head (gh error). Fail-closed."
    printf '%s\n' "$raw"
    exit 2
  fi
  # Frontmatter = lines between the first pair of --- markers. Here-strings, not
  # `printf | …` pipes: under pipefail a producer-pipe into an early-exiting consumer
  # can fail open via SIGPIPE (see docs/solutions: pipefail-echo-grep-condition).
  fm="$(awk '/^---[[:space:]]*$/{n++; next} n==1' <<< "$raw")"
  # Single awk (prints the first match, then exits itself) — the previous `sed | head -n1`
  # form is a consumer-kills-producer pipe that can die 141 under pipefail when head
  # closes the pipe early. Same SIGPIPE family as the here-string note above.
  prio="$(awk '/^priority:/{sub(/^priority:[[:space:]]*/,""); print; exit}' <<< "$fm" | tr -d "[:space:]\"'" | tr '[:upper:]' '[:lower:]')"
  case "$prio" in
    low|medium) : ;;
    *)
      echo "guard: HOLD PR #$PR — ${tf} has priority '${prio:-<missing>}'; only low/medium todos are batch-merge-eligible"
      echo "Needs individual review; exclude from the batch-merge."
      exit 1 ;;
  esac
  if grep -qi 'security' <<< "$fm"; then
    echo "guard: HOLD PR #$PR — ${tf} frontmatter mentions 'security'; always individual review"
    echo "Needs individual review; exclude from the batch-merge."
    exit 1
  fi
  if grep -qiE "$SENSITIVE_INTENT_KEYWORDS" <<< "$fm"; then
    echo "guard: HOLD PR #$PR — ${tf} frontmatter/title mentions a sensitive-domain keyword (auth/session/admin/etc.); always individual review"
    echo "Needs individual review; exclude from the batch-merge."
    exit 1
  fi
done <<< "$todo_files"

# ── PATH GATE ─────────────────────────────────────────────────────────────────

# A file passes only if (1) it is on the allowlist and (2) — unless it is a doc/todo/
# markdown file, which is never sensitive CODE — it does not hit the sensitive override.
# ANY other outcome HOLDs: not allowlisted, sensitive, or a grep regex ERROR (rc >= 2).
# Exit codes are captured explicitly so a broken regex (rc 2) can never look like a clean
# "no match" (rc 1) — a typo fails CLOSED, never silently passes as eligible.
unsafe=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  # 1) must be on the allowlist
  if ! printf '%s' "$f" | grep -qE "$SAFE_ALLOWLIST"; then
    unsafe="${unsafe}  ${f}"$'\n'; continue
  fi
  # 2) docs / todos / markdown are never sensitive code — they pass on the allowlist alone
  #    (a todo slug like subscription-tier-ui.md must not trip the override)
  if printf '%s' "$f" | grep -qE '^(docs|todos)/|\.md$'; then
    continue
  fi
  # 3) an allowlisted CODE file that hits the sensitive override HOLDs. rc 1 (clean no-match)
  #    is the ONLY pass; rc 0 (sensitive) and rc >= 2 (regex error) both HOLD.
  rc_sens=0; printf '%s' "$f" | grep -qE "$SENSITIVE_OVERRIDE" || rc_sens=$?
  if [ "$rc_sens" -ne 1 ]; then
    unsafe="${unsafe}  ${f}"$'\n'
  fi
done <<< "$files"

if [ -n "$unsafe" ]; then
  echo "guard: HOLD PR #$PR — changed files not on the batch-merge allowlist (or sensitive):"
  printf '%s' "$unsafe"
  echo "Needs individual review; exclude from the batch-merge."
  exit 1
fi

echo "guard: OK PR #$PR — every changed file is on the safe allowlist"
exit 0
```

- [ ] **Step 5: Run the suite again and confirm every test passes**

```bash
npx vitest run scripts/__tests__/todo-automerge-guard.test.ts
```

Expected: all four `describe` blocks fully PASS.

- [ ] **Step 6: Sanity-check the script still parses cleanly**

```bash
bash -n scripts/todo-automerge-guard.sh
```

Expected: no output, exit code 0 (pure syntax check — catches a stray unmatched quote in the long regex edits before it ever runs against a real PR).

- [ ] **Step 7: Commit**

```bash
git add scripts/todo-automerge-guard.sh scripts/__tests__/todo-automerge-guard.test.ts
git commit -m "feat(todo): widen automerge guard allowlist to server/routes and server/storage, add sensitive-intent keyword gate"
```

---

### Task 2: Sync `.claude/agents/todo-executor.md`

**Files:**

- Modify: `.claude/agents/todo-executor.md:92-101` (research-delegation skip-gate)
- Modify: `.claude/agents/todo-executor.md:541` (merge-eligibility HOLD prose)

**Interfaces:**

- Consumes: `SENSITIVE_OVERRIDE` and `SENSITIVE_INTENT_KEYWORDS` from `scripts/todo-automerge-guard.sh` (Task 1), sourced at runtime by `grep -m1 '^<NAME>=' scripts/todo-automerge-guard.sh | cut -d= -f2- | tr -d "'"` — same extraction mechanism already used for `SENSITIVE_OVERRIDE` today, now applied to both constants.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Simplify the research-delegation skip-gate**

In `.claude/agents/todo-executor.md`, replace:

````markdown
**Skip gate — no delegation, keep all reads inline** when ANY of: the todo's `labels` include `security`; the todo title or labels mention auth, JWT, login, session, token, IAP, receipt, or subscription; or any affected file is sensitive — it matches the `SENSITIVE_OVERRIDE` regex sourced at runtime from `scripts/todo-automerge-guard.sh` (an IAP/health keyword override for the automerge guard's allowlist — NOT a general sensitivity detector, which is why the auth surfaces are appended explicitly in the alternation) or an auth-surface pattern:

```bash
SENS=$(grep -m1 '^SENSITIVE_OVERRIDE=' scripts/todo-automerge-guard.sh | cut -d= -f2- | tr -d "'")
if [ -z "$SENS" ]; then
  echo "SKIP — SENSITIVE_OVERRIDE extraction failed, failing closed"
elif printf '%s\n' <affected files> |
  grep -qE "$SENS|(^|/)server/middleware/|(^|/)server/routes/auth|verification-token|token-storage|AuthContext|useAuth"; then
  echo "SKIP — sensitive files, no delegation"
fi
```
````

````

with:

```markdown
   **Skip gate — no delegation, keep all reads inline** when ANY of: the todo's `labels` include `security`; the todo title or labels match `SENSITIVE_INTENT_KEYWORDS` sourced at runtime from `scripts/todo-automerge-guard.sh` (auth, jwt, login, password, admin, premium, subscription, iap, api-key, credential — the same sensitive-domain list the automerge guard's TODO gate HOLDs on; deliberately narrower than the file-path override below — session/verif/receipt/secret/health are excluded here because as free-text title words they collide with this app's own recipe/nutrition vocabulary); or any affected file is sensitive — it matches the `SENSITIVE_OVERRIDE` regex, also sourced at runtime from the same script (a full path/filename denylist covering auth, session, email-verification, admin, premium, api-key/secret/credential, and IAP/health surfaces — no separate alternation needs appending here, unlike before this was folded into the guard's own constant):

   ```bash
   SENS=$(grep -m1 '^SENSITIVE_OVERRIDE=' scripts/todo-automerge-guard.sh | cut -d= -f2- | tr -d "'")
   INTENT=$(grep -m1 '^SENSITIVE_INTENT_KEYWORDS=' scripts/todo-automerge-guard.sh | cut -d= -f2- | tr -d "'")
   if [ -z "$SENS" ] || [ -z "$INTENT" ]; then
     echo "SKIP — SENSITIVE_OVERRIDE/SENSITIVE_INTENT_KEYWORDS extraction failed, failing closed"
   elif printf '%s\n' <affected files> | grep -qE "$SENS"; then
     echo "SKIP — sensitive files, no delegation"
   elif printf '%s\n' <todo title/labels> | grep -qiE "$INTENT"; then
     echo "SKIP — sensitive-domain todo, no delegation"
   fi
````

````

- [ ] **Step 2: Update the merge-eligibility HOLD example paths**

In `.claude/agents/todo-executor.md`, replace:

```markdown
   - **`rc` 1 — guard HOLD**, via either gate: the PATH gate (a changed file is sensitive or not on the allowlist — e.g. `server/storage`, `server/routes`, `server/middleware`, `.github/`, `scripts/`, `migrations`, `shared/schema.ts`, secrets) or the TODO gate (no `todos/archive/*.md` in the diff, an archive file absent from the PR head, priority not low/medium, or `security` in the frontmatter — so the `low`/`medium` label may be a mislabel). **Never call `gh pr merge` for a held PR.** Report `MERGE_ELIGIBLE: held (guard: <the guard's HOLD reason line — the first line of its output>)` so the report says WHICH gate held. **Do not add this to `DEFERRED_WARNINGS`** — `MERGE_ELIGIBLE: held` is the channel the orchestrator surfaces it on.
````

with:

```markdown
- **`rc` 1 — guard HOLD**, via either gate: the PATH gate (a changed file is sensitive or not on the allowlist — e.g. `server/middleware`, `.github/`, `scripts/`, `migrations`, `shared/schema.ts`, secrets, or a named-sensitive file inside the otherwise-open `client/`, `server/routes/`, `server/storage/` roots such as `users.ts`, `sessions.ts`, or an auth/verification/admin/premium/login surface) or the TODO gate (no `todos/archive/*.md` in the diff, an archive file absent from the PR head, priority not low/medium, `security` in the frontmatter, or a sensitive-domain keyword — auth/session/admin/premium/etc. — in the frontmatter, so the `low`/`medium` label may be a mislabel or the work may simply be sensitive by intent). **Never call `gh pr merge` for a held PR.** Report `MERGE_ELIGIBLE: held (guard: <the guard's HOLD reason line — the first line of its output>)` so the report says WHICH gate held. **Do not add this to `DEFERRED_WARNINGS`** — `MERGE_ELIGIBLE: held` is the channel the orchestrator surfaces it on.
```

- [ ] **Step 3: Verify no stale directory-exclusion prose remains**

```bash
grep -n "server/storage.*server/routes.*server/middleware\|verification-token" .claude/agents/todo-executor.md
```

Expected: no output (both the old three-directory grouping and the now-redundant `verification-token` reference are gone).

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/todo-executor.md
git commit -m "docs(todo-executor): sync sensitive-path/intent prose with the widened automerge guard"
```

---

### Task 3: Sync `docs/todo-automation-runbook.md`

**Files:**

- Modify: `docs/todo-automation-runbook.md:45-59` (safety-model item 3)

**Interfaces:**

- Consumes: nothing beyond the finished behavior of Task 1's script (this task only edits prose describing it).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the safety-model description**

In `docs/todo-automation-runbook.md`, replace:

```markdown
3. **`scripts/todo-automerge-guard.sh`** — the executor runs this on every `low`/`medium`
   PR to classify it. It is a **fail-CLOSED allowlist** with two gates: a TODO gate
   (the archived todo's frontmatter must say priority low/medium with no `security`
   mention — enforced by the script itself, so even a fresh session with no overnight
   report can't batch-merge a high/security PR) and a PATH gate: `MERGE_ELIGIBLE: yes`
   only when **every** changed file is a known-safe surface (UI, business services,
   shared pure modules, tests, docs/todos); it HOLDs for **anything sensitive or
   unrecognized** —
   the whole sensitive backend (`server/storage`, `server/routes`, `server/middleware`),
   `.github/`, `scripts/`, migrations, `shared/schema.ts`, secrets, plus the IAP/health
   files that live inside otherwise-safe dirs. An UNKNOWN path HOLDs — so a
   mislabeled-severity todo can't get itself onto your batch-merge list. (PR #465
   revised this to fail-closed after a review found the interim denylist fail-OPEN on
   whole layers; to widen the pass, add a known-safe prefix to the allowlist in the
   script.)
```

with:

```markdown
3. **`scripts/todo-automerge-guard.sh`** — the executor runs this on every `low`/`medium`
   PR to classify it. It is a **fail-CLOSED allowlist** with two gates: a TODO gate
   (the archived todo's frontmatter must say priority low/medium, with no `security`
   mention and no sensitive-domain keyword — auth/session/admin/premium/IAP/health/etc. —
   enforced by the script itself, so even a fresh session with no overnight report can't
   batch-merge a high/security/sensitive-intent PR) and a PATH gate: `MERGE_ELIGIBLE: yes`
   only when **every** changed file is a known-safe surface (all of `client/`, `server/routes/`
   and `server/storage/` minus their sensitive files, business services, shared pure
   modules, tests, docs/todos); it HOLDs for **anything sensitive or unrecognized** — the
   whole `server/middleware/` directory, `.github/`, `scripts/`, migrations,
   `shared/schema.ts`, secrets, plus named-sensitive files (auth/session/verification/
   admin/premium/login/api-key surfaces, IAP/health) that live inside the otherwise-open
   `client/`, `server/routes/`, and `server/storage/` roots. An UNKNOWN path HOLDs — so a
   mislabeled-severity todo can't get itself onto your batch-merge list. (PR #465
   revised this to fail-closed after a review found the interim denylist fail-OPEN on
   whole layers; a 2026-07-08 audit widened the allowlist from narrow subdirectories to
   whole roots and added the sensitive-intent keyword gate as a second, independent
   layer — see the script's own header comment for the full model; to widen the pass
   further, add a known-safe prefix to the allowlist in the script.)
```

- [ ] **Step 2: Verify no stale three-directory grouping remains**

```bash
grep -n "server/storage.*server/routes.*server/middleware" docs/todo-automation-runbook.md
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add docs/todo-automation-runbook.md
git commit -m "docs(todo-runbook): describe the widened automerge guard allowlist and intent gate"
```

---

### Task 4: Final verification and PR

**Files:** none (verification + handoff only)

**Interfaces:**

- Consumes: all commits from Tasks 1–3 on the current branch (originally planned as `chore/widen-todo-automerge-path-gate`; actually created as `worktree-widen-todo-automerge-path-gate` by the native EnterWorktree tool — use whatever `git branch --show-current` reports).
- Produces: an open PR for individual human review.

- [ ] **Step 1: Re-run the full guard test suite once more from a clean state**

```bash
npx vitest run scripts/__tests__/todo-automerge-guard.test.ts
```

Expected: all tests pass (confirms Task 2/3's doc-only edits didn't touch the script and nothing regressed).

- [ ] **Step 2: Confirm no other tracked file still references the old three-directory grouping**

```bash
grep -rn "server/storage.*server/routes.*server/middleware" --include="*.md" .
```

Expected: no output. If something turns up outside the three files this plan already covers, add a follow-up edit before opening the PR rather than leaving stale docs behind.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin "$(git branch --show-current)"
gh pr create --title "Widen todo auto-merge path gate to server/routes and server/storage" --body "$(cat <<'EOF'
## Summary
- Widens `scripts/todo-automerge-guard.sh`'s `SAFE_ALLOWLIST` from narrow subdirectories to whole roots (`client/`, `server/routes/`, `server/storage/`), so routine low/medium-priority todos touching those directories no longer HOLD purely because of which directory they touched.
- Expands `SENSITIVE_OVERRIDE` with every auth/session/verification/admin/premium/login/api-key file found by auditing the actual directory contents (including two pre-existing gaps unrelated to this widening: `LoginScreen.tsx` and `SessionExpiryBridge.tsx` were already eligible today under directories already on the old allowlist).
- Adds a second, independent `SENSITIVE_INTENT_KEYWORDS` gate that HOLDs any todo whose own title/frontmatter names a sensitive domain, regardless of which file it touches — the backstop for a future sensitive file whose name gives no signal (`server/storage/users.ts` was the proof case).
- Syncs `.claude/agents/todo-executor.md` and `docs/todo-automation-runbook.md`, which both described the old narrow allowlist.

Full rationale: `docs/superpowers/specs/2026-07-08-todo-automerge-path-gate-widening-design.md` (local, not part of this diff).

## Test plan
- [x] `scripts/__tests__/todo-automerge-guard.test.ts` — regression suite (unchanged behavior) + new-allowlist suite + new-override suite + new-intent-gate suite, all passing
- [x] `bash -n scripts/todo-automerge-guard.sh` — script parses cleanly
- [ ] CI green on this PR (lint/types/tests/coverage/mutation/CodeQL)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

This PR is **not** auto-merge-eligible by the guard's own design (it touches `scripts/`) — it needs your individual review and merge, same as any `high`/`critical`/`security` todo would.
