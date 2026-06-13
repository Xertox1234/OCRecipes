import { describe, it, expect } from "vitest";
import { matchesAnyGlob, globToRegExp } from "../lib/globs";

describe("globToRegExp (bash [[ == ]] semantics)", () => {
  it("matches an exact path", () => {
    expect(
      matchesAnyGlob("client/lib/offline-queue-drain.ts", [
        "client/lib/offline-queue-drain.ts",
      ]),
    ).toBe(true);
  });
  it("treats * as spanning slashes within a segment-required pattern", () => {
    expect(matchesAnyGlob("client/a/b/Foo.tsx", ["client/**/*.tsx"])).toBe(
      true,
    );
    expect(matchesAnyGlob("client/a/Foo.tsx", ["client/**/*.tsx"])).toBe(true);
  });
  it("does NOT match zero intermediate segments (mirrors bash, required literal /)", () => {
    expect(matchesAnyGlob("client/Foo.tsx", ["client/**/*.tsx"])).toBe(false);
  });
  it("does not match a different extension", () => {
    expect(matchesAnyGlob("client/a/Foo.ts", ["client/**/*.tsx"])).toBe(false);
  });
  it("escapes regex metacharacters in literal parts", () => {
    expect(
      globToRegExp("server/routes/_helpers.ts").test(
        "server/routes/_helpers.ts",
      ),
    ).toBe(true);
    expect(
      globToRegExp("server/routes/_helpers.ts").test(
        "server/routesXhelpersZts",
      ),
    ).toBe(false);
  });
  it("returns false when applies_to is empty", () => {
    expect(matchesAnyGlob("anything.ts", [])).toBe(false);
  });
});
