import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  RULES_DOMAINS,
  rulesDomainsForPath,
  routingLabelsForPath,
} from "../path-domains";

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

describe("rulesDomainsForPath", () => {
  const cases: [string, string[]][] = [
    ["server/routes/recipe-catalog.ts", ["api", "architecture", "security"]],
    ["server/storage/recipes.ts", ["architecture", "database", "security"]],
    ["shared/schema.ts", ["architecture", "database", "security"]],
    ["migrations/0002_add_table.sql", ["architecture", "database", "security"]],
    ["server/middleware/auth.ts", ["api", "security"]],
    ["server/services/goal-calculator.ts", ["architecture"]],
    ["server/services/nutrition-coach.ts", ["ai-prompting", "architecture"]],
    // 18-set fix: a service the old 4-entry shell list missed.
    [
      "server/services/voice-transcription.ts",
      ["ai-prompting", "architecture"],
    ],
    [
      "client/screens/HomeScreen.tsx",
      ["accessibility", "design-system", "react-native"],
    ],
    [
      "client/screens/ScanScreen.tsx",
      ["accessibility", "design-system", "react-native"],
    ],
    [
      "client/components/Button.tsx",
      ["accessibility", "design-system", "performance", "react-native"],
    ],
    ["client/navigation/RootNavigator.tsx", ["accessibility", "react-native"]],
    // D6 union: hooks keeps react-native + accessibility (matches the shell).
    [
      "client/hooks/useFoo.ts",
      ["accessibility", "client-state", "hooks", "react-native"],
    ],
    ["client/context/AuthContext.tsx", ["client-state"]],
    ["client/lib/format.ts", ["client-state", "typescript"]],
    ["client/constants/theme.ts", ["design-system"]],
    ["design_guidelines.md", ["design-system"]],
    ["evals/runner.ts", ["ai-prompting", "testing"]],
    [".github/workflows/ci.yml", ["architecture", "testing"]],
    ["vitest.config.ts", ["testing", "typescript"]],
    ["eslint.config.js", ["testing", "typescript"]],
    // Anchored test-exclusion preserved for server/routes + server/storage.
    ["server/routes/__tests__/recipe-catalog.test.ts", ["testing"]],
    ["server/storage/__tests__/recipes.test.ts", ["testing"]],
    ["README.md", []],
  ];
  it.each(cases)("%s", (input, expected) => {
    expect(rulesDomainsForPath(input).sort()).toEqual(expected);
  });

  it("unions screen + test for a non-excluded dir's test file", () => {
    expect(
      rulesDomainsForPath(
        "client/screens/__tests__/HomeScreen.test.tsx",
      ).sort(),
    ).toEqual(["accessibility", "design-system", "react-native", "testing"]);
  });

  it("never returns the routing-only camera label", () => {
    expect(rulesDomainsForPath("client/screens/ScanScreen.tsx")).not.toContain(
      "camera",
    );
  });
});

describe("routingLabelsForPath", () => {
  it("adds camera for Scan screens on top of rules-domains", () => {
    expect(
      routingLabelsForPath("client/screens/ScanScreen.tsx").sort(),
    ).toEqual(["accessibility", "camera", "design-system", "react-native"]);
  });
  it("adds camera for client/components/camera files", () => {
    expect(
      routingLabelsForPath("client/components/camera/CameraView.tsx"),
    ).toContain("camera");
  });
  it("matches rulesDomainsForPath for non-camera paths (incl. D6 hooks)", () => {
    expect(routingLabelsForPath("client/hooks/useFoo.ts").sort()).toEqual([
      "accessibility",
      "client-state",
      "hooks",
      "react-native",
    ]);
  });
});
