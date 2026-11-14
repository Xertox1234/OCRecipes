import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Guards the Dependabot `expo` ignore boundary against going stale.
 *
 * The boundary exists so a security update can never drag expo across an SDK
 * major. It must sit exactly one major above the installed SDK: lower, and it
 * silently blocks every security patch for the SDK we run (it sat at ">=55"
 * through the SDK 58 upgrade); higher, and a CVE bump could cross an SDK major.
 */
const root = path.resolve(__dirname, "..", "..");

function installedExpoMajor(): number {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ) as { dependencies: Record<string, string> };
  const match = /(\d+)\./.exec(pkg.dependencies.expo ?? "");
  if (!match) throw new Error("package.json has no parsable expo dependency");
  return Number(match[1]);
}

function dependabotExpoBoundaryMajor(): number {
  const yml = fs.readFileSync(
    path.join(root, ".github", "dependabot.yml"),
    "utf8",
  );
  const match =
    /dependency-name:\s*"expo"\s*\n\s*versions:\s*\[\s*">=(\d+)\.0\.0"\s*\]/.exec(
      yml,
    );
  if (!match) throw new Error('dependabot.yml has no `expo` ">=N.0.0" ignore');
  return Number(match[1]);
}

describe("dependabot expo ignore boundary", () => {
  it("sits exactly one SDK major above the installed expo", () => {
    expect(dependabotExpoBoundaryMajor()).toBe(installedExpoMajor() + 1);
  });
});
