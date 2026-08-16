import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

/**
 * The OTA publish guards live INLINE in package.json (`update:preview` /
 * `update:production` are `sh -c` one-liners) — there is no script file to
 * import. Layer A asserts the committed config text (precedent:
 * runtime-version-parity.test.ts); Layer B executes the real fragment against
 * a fake `eas` binary on PATH, so the guard behavior itself is pinned and the
 * riskiest edit in the repo (an inline shell string) is also its best-tested.
 */

const pkgPath = path.resolve(__dirname, "..", "..", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
  scripts: Record<string, string>;
};

const SCRIPTS = [
  { name: "update:preview", branch: "preview" },
  { name: "update:production", branch: "production" },
] as const;

function extractFragment(script: string): string {
  // The scripts have the shape `ENV=... sh -c '<fragment>' --`. The fragment
  // must stay single-quote-free or this extraction (and the sh -c embedding
  // itself) breaks.
  const match = script.match(/sh -c '(.+)' --$/s);
  if (!match) {
    throw new Error(`could not extract the sh -c fragment from: ${script}`);
  }
  return match[1];
}

const tmpDirs: string[] = [];

function makeFakeEasBin(): string {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "fake-eas-")),
  );
  tmpDirs.push(dir);
  const bin = path.join(dir, "eas");
  // Bracket each argv token individually: an unquoted `echo $@` collapses
  // token boundaries, making "one arg containing spaces" and "several args"
  // print identically — which would blind the suite to an unquoting
  // regression on the fragment's own `... "$@"` exec line.
  fs.writeFileSync(
    bin,
    '#!/usr/bin/env bash\nprintf "EAS_CALLED:"\nfor a in "$@"; do printf " [%s]" "$a"; done\nprintf "\\n"\nexit 0\n',
  );
  fs.chmodSync(bin, 0o755);
  return dir;
}

function runGuard(scriptName: string, userArgs: string[]) {
  const fragment = extractFragment(pkg.scripts[scriptName]);
  const binDir = makeFakeEasBin();
  const result = spawnSync("sh", ["-c", fragment, "--", ...userArgs], {
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("EAS update publish guards (package.json inline scripts)", () => {
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe.each(SCRIPTS)("$name — config text", ({ name, branch }) => {
    it("bakes in the three publish footguns and locks the platform", () => {
      const script = pkg.scripts[name];
      expect(script).toBeDefined();
      // CI=1 + inlined public env — the three footguns from the OTA runbook.
      expect(script.startsWith("CI=1 ")).toBe(true);
      expect(script).toContain("EXPO_PUBLIC_DOMAIN=https://api.ocrecipes.com");
      expect(script).toContain("EXPO_PUBLIC_SENTRY_DSN=");
      // Locked targets: both native platforms, correct branch, args forwarded.
      expect(script).toContain(`--branch ${branch}`);
      expect(script).toContain("--platform all");
      expect(script).toContain('"$@"');
      expect(script.endsWith("' --")).toBe(true);
    });
  });

  describe.each(SCRIPTS)("$name — guard behavior", ({ name, branch }) => {
    it("refuses a publish without --message", () => {
      const r = runGuard(name, []);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("--message is required");
    });

    it("forwards a labeled publish to eas with the locked platform/branch", () => {
      const r = runGuard(name, ["--message", "fix login"]);
      expect(r.status, r.stderr).toBe(0);
      // The message must arrive as ONE argv token — an unquoted `$@` in the
      // fragment's exec line would split it into [fix] [login].
      expect(r.stdout).toContain(
        `EAS_CALLED: [update] [--branch] [${branch}] [--platform] [all] [--message] [fix login]`,
      );
    });

    it("accepts the --message=value form", () => {
      const r = runGuard(name, ["--message=fix login"]);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("[--message=fix login]");
    });

    it("rejects a forwarded --platform (script owns the platform)", () => {
      const r = runGuard(name, ["--platform", "ios", "--message", "x"]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("do not pass --platform");
    });

    it("rejects --platform=value too", () => {
      const r = runGuard(name, ["--platform=ios", "--message", "x"]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("do not pass --platform");
    });

    it("still refuses the short -m form (never satisfied the guard; pinned)", () => {
      const r = runGuard(name, ["-m", "x"]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("--message is required");
    });

    it("REGRESSION: '--platform' INSIDE the message text must not trip the rejection", () => {
      // The old guard substring-matched "$*" (all args flattened into one
      // string), so a commit message mentioning --platform falsely refused a
      // legitimate publish. Tokens, not substrings.
      const r = runGuard(name, ["--message", "fix the --platform bug"]);
      expect(r.status, r.stderr).toBe(0);
      // And the whole message survives as one token, --platform text included.
      expect(r.stdout).toContain("[fix the --platform bug]");
    });

    it("REGRESSION: --messages must NOT satisfy the --message requirement", () => {
      // Same substring flattening in the other direction: "--messages foo"
      // contains "--message" as a substring, so an unlabeled publish slipped
      // through the refusal gate. This is the fail-open side.
      const r = runGuard(name, ["--messages", "foo"]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("--message is required");
    });
  });
});
