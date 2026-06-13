import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { RULES_DOMAINS } from "../path-domains";

describe("RULES_DOMAINS invariant", () => {
  it("has exactly the 13 known rules-domains", () => {
    expect([...RULES_DOMAINS].sort()).toEqual([
      "accessibility",
      "ai-prompting",
      "api",
      "architecture",
      "client-state",
      "database",
      "design-system",
      "hooks",
      "performance",
      "react-native",
      "security",
      "testing",
      "typescript",
    ]);
  });

  it("every rules-domain has a docs/rules/<domain>.md file", () => {
    for (const d of RULES_DOMAINS) {
      const p = path.resolve("docs/rules", `${d}.md`);
      expect(fs.existsSync(p), `${p} must exist`).toBe(true);
    }
  });
});
