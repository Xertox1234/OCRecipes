import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "fs";
import * as path from "path";
import {
  RULES_DOMAINS,
  rulesDomainsForPath,
  routingLabelsForPath,
  compileToRegExp,
  compileToBashConditions,
  runCli,
  PATH_TO_DOMAINS,
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

// Model bash `[[ "$f" == GLOB ]]`: `*` matches any run (incl. '/'); all else literal.
function bashGlobToRegExp(glob: string): RegExp {
  const re = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${re}$`);
}

const PARITY_CORPUS = [
  "server/routes/x.ts",
  "x/server/routes/x.ts",
  "server/routes/__tests__/x.test.ts",
  "server/storage/__tests__/y.test.ts",
  "shared/schema.ts",
  "abs/shared/schema.ts",
  "migrations/1.sql",
  "server/middleware/auth.ts",
  "server/services/recipe-chat.ts",
  "client/screens/HomeScreen.tsx",
  "client/screens/ScanScreen.tsx",
  "client/components/camera/CameraView.tsx",
  "client/navigation/Root.tsx",
  "client/hooks/useX.ts",
  "client/context/X.tsx",
  "client/lib/x.ts",
  "client/constants/theme.ts",
  "design_guidelines.md",
  "evals/r.ts",
  "a/__tests__/b.test.ts",
  "x.test.tsx",
  "y.spec.ts",
  ".github/workflows/ci.yml",
  "vitest.config.ts",
  "eslint.config.js",
  "README.md",
];

describe("regex<->bash-glob parity", () => {
  it.each(PARITY_CORPUS)("rule-match set matches for %s", (p) => {
    PATH_TO_DOMAINS.forEach((rule) => {
      const tsMatch = compileToRegExp(rule.match).test(p);
      const shMatch = compileToBashConditions(rule.match).some((g) =>
        bashGlobToRegExp(g).test(p),
      );
      // Documented asymmetry (D14): for the two historically-anchored server
      // dirs, TS excludes __tests__ descendants while the shell includes them.
      const isTestExcludingServerDir =
        rule.match.kind === "recursive-dir" &&
        (rule.match.dir === "server/routes" ||
          rule.match.dir === "server/storage");
      if (shMatch === tsMatch) {
        expect(shMatch).toBe(tsMatch); // symmetric (the common case)
      } else {
        // The ONLY permitted mismatch: TS excludes a __tests__ descendant under
        // the two anchored server dirs, while the generated shell includes it.
        expect(
          isTestExcludingServerDir &&
            p.includes("/__tests__/") &&
            shMatch &&
            !tsMatch,
        ).toBe(true);
      }
    });
  });
});

describe("runCli", () => {
  it("prints the sorted rules-domains union for the given files", () => {
    const out: string[] = [];
    const code = runCli(["server/routes/x.ts", "client/hooks/useX.ts"], (s) =>
      out.push(s),
    );
    expect(code).toBe(0);
    // hooks contributes its D6 union (rn + a11y) alongside routes' domains.
    expect(out.join("")).toBe(
      "accessibility, api, architecture, client-state, hooks, react-native, security",
    );
  });

  it("--routing includes the camera routing label", () => {
    const out: string[] = [];
    runCli(["--routing", "client/screens/ScanScreen.tsx"], (s) => out.push(s));
    expect(out.join("")).toBe(
      "accessibility, camera, design-system, react-native",
    );
  });

  it("prints nothing for unmapped files", () => {
    const out: string[] = [];
    expect(runCli(["README.md"], (s) => out.push(s))).toBe(0);
    expect(out.join("")).toBe("");
  });
});

describe("LLM_TOUCHING_SERVICES drift detection", () => {
  it("matches the empirical grep result", () => {
    // Re-run the grep that seeded the constant. If a new service imports an LLM
    // client without being added to LLM_TOUCHING_SERVICES, this test fails and
    // forces the developer to update the constant. (Relocated from
    // delegate-copilot-issue.test.ts when PATH_TO_DOMAINS moved here.)
    const result = execSync(
      `grep -l "openai\\|OpenAI\\|gpt-\\|completions\\|anthropic" server/services/*.ts || true`,
      { encoding: "utf8" },
    );
    const empirical = result
      .split("\n")
      .filter(Boolean)
      .filter((p: string) => !p.includes("/__tests__/"))
      .map((p: string) => p.replace(/^server\/services\//, ""))
      .sort();

    const nonAiPromptingServices = empirical.filter(
      (basename: string) =>
        !rulesDomainsForPath(`server/services/${basename}`).includes(
          "ai-prompting",
        ),
    );

    expect(nonAiPromptingServices).toEqual([]);
    expect(empirical.length).toBeGreaterThan(0); // sanity — we have LLM services
  });
});

describe("routing-only rules (camera)", () => {
  it("camera rules carry empty domains so they don't render in doc/shell", () => {
    const cameraRules = PATH_TO_DOMAINS.filter((r) =>
      r.routingLabels?.includes("camera"),
    );
    expect(cameraRules.length).toBeGreaterThan(0);
    for (const r of cameraRules) {
      // The parent client/screens|components rule supplies the rules-domains;
      // these contribute ONLY the camera routing label.
      expect(r.domains).toEqual([]);
    }
  });

  it("every rule contributes something (rules-domains or routing labels)", () => {
    for (const r of PATH_TO_DOMAINS) {
      const contributes =
        r.domains.length > 0 || (r.routingLabels?.length ?? 0) > 0;
      expect(contributes, `rule "${r.description}" contributes nothing`).toBe(
        true,
      );
    }
  });
});
