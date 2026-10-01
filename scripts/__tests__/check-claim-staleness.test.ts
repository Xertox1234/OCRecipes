import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

const script = path.resolve(__dirname, "..", "check-claim-staleness.js");

/**
 * Every case runs the REAL script over a fixture file in `--all` mode, because the
 * ratchet's other mode reads a staged git diff and would make each case depend on a
 * repository state rather than on the rule under test.
 *
 * FROZEN-DIFF exists to catch a sentence asserting a git command's OUTPUT, which is a
 * property of two moving trees rather than of the file it is written in. Getting that
 * rule's WIDTH right took three attempts, and each rejected attempt is pinned below as a
 * must-not-fire case, because a lint with no test is a lint whose false positives are
 * found by a human or not at all — which is exactly how the second attempt shipped.
 */
const tmpDirs: string[] = [];

function runOn(line: string): { code: number; out: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "staleness-"));
  tmpDirs.push(dir);
  const file = path.join(dir, "fixture.md");
  fs.writeFileSync(file, line + "\n");
  const r = spawnSync("node", [script, "--all", file], { encoding: "utf8" });
  return { code: r.status ?? -1, out: (r.stdout || "") + (r.stderr || "") };
}

const fires = (line: string) => runOn(line).code === 1;

afterEach(() => {
  while (tmpDirs.length)
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("FROZEN-DIFF", () => {
  it("fires when the emptiness is the command's own predicate", () => {
    expect(fires("that diff `git diff main...HEAD` is empty")).toBe(true);
    expect(fires("`git rev-list HEAD` returns nothing")).toBe(true);
  });

  it("fires through a PREPOSITIONAL qualifier of the command", () => {
    // A qualifier narrows WHAT WAS RUN; it does not introduce a new subject. This is the
    // tree's one genuine legacy hit, and an earlier anchored rule lost it — trading a false
    // positive for a false negative, which the legacy count caught and the rule text did not.
    expect(
      fires(
        "byte-identical with `main` (`git diff` on `guard-outward-cli.sh` is empty).",
      ),
    ).toBe(true);
  });

  it("does NOT fire when an intervening SUBJECT owns the emptiness", () => {
    // Attempt 2 used a 40-character proximity window after the command. Both of these sit
    // inside that window and are false: the emptiness belongs to a build cache and to an
    // upload queue, not to any command's output. Raw character distance cannot tell whose
    // emptiness it is; predication can.
    expect(fires("run `git log` shows the cache is empty")).toBe(false);
    expect(fires("after `git status` the upload queue returns nothing")).toBe(
      false,
    );
  });

  it("does NOT fire on co-occurrence across the line", () => {
    // Attempt 1 ANDed the two patterns anywhere on one line.
    expect(
      fires("run `npm run build`; the cache is empty, then check `git status`"),
    ).toBe(false);
  });

  it("does NOT fire on a git command with no emptiness claim", () => {
    expect(
      fires("derive it with `git diff --name-only af0e27b2..origin/main`"),
    ).toBe(false);
  });

  it("leaves the PRE-POSED spelling as a deliberate false negative", () => {
    // Narrow-and-truthful beats broad-and-switched-off; this one is documented, not missed.
    expect(fires("that diff is empty: `git diff main...HEAD`")).toBe(false);
  });
});

describe("POSITIONAL-REF", () => {
  it("fires on a COUNTED offset, which a merge silently invalidates", () => {
    expect(
      fires("the header two bullets up asserted that every decision did"),
    ).toBe(true);
    expect(fires("see the note ~150 lines above")).toBe(true);
  });

  it("does NOT fire on a bare directional reference, which degrades gracefully", () => {
    expect(
      fires("See the `THE COMMAND-POSITION PREFIX IS AN AXIS` bullet below"),
    ).toBe(false);
  });
});

describe("escape hatch", () => {
  it("suppresses a line that is about the pattern itself", () => {
    expect(fires("the header two bullets up asserted it [staleness-ok]")).toBe(
      false,
    );
  });
});
