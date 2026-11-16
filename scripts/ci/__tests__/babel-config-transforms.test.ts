// Guards babel.config.js against a dependency change that stops Metro bundling.
//
// CI never bundles the app, so a Babel plugin that throws on every file is
// invisible to it: the E2E nightlies of 2026-11-15/16 failed every flow at
// launch because the `glob@^9.0.0` -> `^14.0.2` override (#1858) handed
// babel-plugin-module-resolver a glob with no default export, and its `root`
// option reads `glob.default.hasMagic`. Metro then failed on line 1 of
// client/index.js ("Cannot read properties of undefined (reading 'hasMagic')").
//
// This runs the real config through Babel, as Metro does, on one import per
// alias. It fails if any plugin in the config throws, or an alias stops
// resolving.
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
// @babel/core ships no types; this is the one call the test makes.
const babel: {
  transformSync(
    code: string,
    options: Record<string, unknown>,
  ): { code?: string | null } | null;
} = require("@babel/core");

const projectRoot = path.resolve(__dirname, "../../..");

function transform(platform: "ios" | "android"): string {
  // What Metro passes; babel-preset-expo reads `bundler` and `platform`.
  const caller = { name: "metro", bundler: "metro", platform };
  const result = babel.transformSync(
    'import a from "@/lib/query-client";\n' +
      'import b from "@shared/schema";\n' +
      "export default [a, b];\n",
    {
      cwd: projectRoot,
      filename: path.join(projectRoot, "client/index.js"),
      configFile: path.join(projectRoot, "babel.config.js"),
      babelrc: false,
      caller,
    },
  );
  return result?.code ?? "";
}

describe("babel.config.js", () => {
  it.each(["ios", "android"] as const)(
    "transforms a client file and resolves both aliases (%s)",
    (platform) => {
      const code = transform(platform);
      expect(code).toContain("./lib/query-client");
      expect(code).toContain("../shared/schema");
      expect(code).not.toContain("@/lib/query-client");
      expect(code).not.toContain("@shared/schema");
    },
  );
});
