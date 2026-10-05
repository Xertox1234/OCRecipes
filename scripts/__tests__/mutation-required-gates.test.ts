// scripts/__tests__/mutation-required-gates.test.ts
/**
 * mutation-non-excluded.yml and mutation-goal-safety.yml are required checks
 * that self-scope: Detect (`id: changed`) writes run=true or run=false, one
 * step runs on `== 'false'` and every working step on `== 'true'`. A typo in
 * that id, in one gate's `steps.changed`, or in the `run=true` / `run=false`
 * line Detect writes leaves the output empty or unmatched, so neither
 * comparison holds, every step skips, and the required check reports success
 * having run nothing. Nothing runs actionlint, so these pins read the
 * workflow text and fail here instead. The `== 'true'` polarity is deliberate
 * (mutation-on-diff.yml, advisory, gates the other way): a required gate must
 * not run every Stryker target on every PR over a missing output.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const WORKFLOWS = path.resolve(__dirname, "..", "..", ".github", "workflows");

// `gated`: one `== 'true'` per step that needs the install — setup-node,
// install, each Stryker target and the report upload.
const GATES = [
  { file: "mutation-non-excluded.yml", gated: 12 },
  { file: "mutation-goal-safety.yml", gated: 4 },
] as const;

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

describe.each(GATES)("$file", ({ file, gated }) => {
  const workflow = readFileSync(path.join(WORKFLOWS, file), "utf8");

  it("defines the detect step the gates read, once, as `changed`", () => {
    expect(count(workflow, /^\s+id: changed$/gm)).toBe(1);
  });

  it("writes the run output the gates compare, once per branch", () => {
    expect(count(workflow, /echo "run=true" >> "\$GITHUB_OUTPUT"/g)).toBe(1);
    expect(count(workflow, /echo "run=false" >> "\$GITHUB_OUTPUT"/g)).toBe(1);
  });

  it("self-scopes on one explicit false and gates every working step on an explicit true", () => {
    expect(
      count(workflow, /if: steps\.changed\.outputs\.run == 'false'/g),
    ).toBe(1);
    expect(count(workflow, /if: steps\.changed\.outputs\.run == 'true'/g)).toBe(
      gated,
    );
    expect(workflow).not.toContain("!= 'false'");
  });
});
