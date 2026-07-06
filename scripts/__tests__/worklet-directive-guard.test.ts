import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  scanFileForWorkletOffenders,
  type ScanFsAdapter,
  type AliasRoots,
} from "../worklet-directive-guard";

// ── Unit tests: synthetic in-memory fixtures ─────────────────────────────────
// These exercise the scanner in isolation from the real repo so we can prove
// both directions: a regression (directive removed) is caught, and the
// known-good shape (directive present) is not a false positive. No real
// filesystem access — the "imported module" content is supplied inline.

function memoryFs(files: Record<string, string>): ScanFsAdapter {
  return {
    readFile(absPath: string) {
      return Object.prototype.hasOwnProperty.call(files, absPath)
        ? files[absPath]
        : null;
    },
  };
}

const NO_ALIASES: AliasRoots = {};

describe("scanFileForWorkletOffenders (unit, synthetic fixtures)", () => {
  it("flags a cross-file imported function called in runOnUI without a worklet directive (regression case)", () => {
    const memfs = memoryFs({
      "/virtual/util.ts": `export function badFn(x: number) { return x + 1; }`,
    });
    const source = `
      import { runOnUI } from "react-native-reanimated";
      import { badFn } from "./util";
      function onPress() {
        runOnUI(() => {
          "worklet";
          badFn(1);
        })();
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toMatchObject({
      calleeName: "badFn",
      workletKind: "runOnUI",
      resolvedFile: "/virtual/util",
    });
  });

  it("does not flag when the imported function carries the worklet directive (known-good precedent shape)", () => {
    const memfs = memoryFs({
      "/virtual/util.ts": `export function goodFn(x: number) { "worklet"; return x + 1; }`,
    });
    const source = `
      import { runOnUI } from "react-native-reanimated";
      import { goodFn } from "./util";
      function onPress() {
        runOnUI(() => {
          "worklet";
          goodFn(1);
        })();
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toEqual([]);
  });

  it("does not flag Reanimated worklet built-ins or Math.* calls inside a worklet", () => {
    const memfs = memoryFs({});
    const source = `
      import { runOnUI, measure, scrollTo, withTiming } from "react-native-reanimated";
      function onPress(ref: unknown) {
        runOnUI(() => {
          "worklet";
          const m = measure(ref);
          scrollTo(ref, 0, Math.max(0, m.height), true);
          withTiming(1);
        })();
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller2.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toEqual([]);
  });

  it("flags a same-file, module-scope helper called inside a worklet that lacks its own directive (Babel does NOT auto-workletize it, same-file or not)", () => {
    const memfs = memoryFs({});
    const source = `
      import { runOnUI } from "react-native-reanimated";
      function localHelper(x: number) { return x + 1; }
      function onPress() {
        runOnUI(() => {
          "worklet";
          localHelper(1);
        })();
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller3.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toMatchObject({
      calleeName: "localHelper",
      resolvedFile: "/virtual/caller3.ts",
    });
  });

  it("does not flag a same-file helper that carries its own worklet directive", () => {
    const memfs = memoryFs({});
    const source = `
      import { runOnUI } from "react-native-reanimated";
      function localHelper(x: number) { "worklet"; return x + 1; }
      function onPress() {
        runOnUI(() => {
          "worklet";
          localHelper(1);
        })();
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller3b.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toEqual([]);
  });

  it("does not flag a same-file bare call with no matching top-level declaration (a genuine global/built-in, e.g. parseInt)", () => {
    const memfs = memoryFs({});
    const source = `
      import { runOnUI } from "react-native-reanimated";
      function onPress() {
        runOnUI(() => {
          "worklet";
          parseInt("1", 10);
        })();
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller3c.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toEqual([]);
  });

  it("resolves a directive-less TOP-LEVEL export even when a nested, shadowed declaration of the same name DOES carry the directive (module-scope-only resolution — must not be fooled by nested decoys)", () => {
    const memfs = memoryFs({
      "/virtual/nested-decoy-good.ts": `
        function outer() {
          function badFn(x: number) { "worklet"; return x; } // nested decoy, directived
        }
        export function badFn(x: number) { return x + 1; } // real top-level export, NOT directived
      `,
    });
    const source = `
      import { runOnUI } from "react-native-reanimated";
      import { badFn } from "./nested-decoy-good";
      function onPress() {
        runOnUI(() => {
          "worklet";
          badFn(1);
        })();
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller-nested-decoy-good.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toHaveLength(1);
    expect(offenders[0].calleeName).toBe("badFn");
  });

  it("does not misreport a directived TOP-LEVEL export as an offender when a nested, shadowed declaration of the same name lacks the directive (module-scope-only resolution — must not false-positive on nested decoys)", () => {
    const memfs = memoryFs({
      "/virtual/nested-decoy-bad.ts": `
        function outer() {
          function goodFn(x: number) { return x; } // nested decoy, NOT directived
        }
        export function goodFn(x: number) { "worklet"; return x + 1; } // real top-level export, directived
      `,
    });
    const source = `
      import { runOnUI } from "react-native-reanimated";
      import { goodFn } from "./nested-decoy-bad";
      function onPress() {
        runOnUI(() => {
          "worklet";
          goodFn(1);
        })();
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller-nested-decoy-bad.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toEqual([]);
  });

  it('recognizes the worklet directive when it isn\'t literally the first statement (a leading `"use strict";` before it is still a valid directive prologue)', () => {
    const memfs = memoryFs({
      "/virtual/use-strict-first.ts": `export function goodFn(x: number) { "use strict"; "worklet"; return x + 1; }`,
    });
    const source = `
      import { runOnUI } from "react-native-reanimated";
      import { goodFn } from "./use-strict-first";
      function onPress() {
        runOnUI(() => {
          "worklet";
          goodFn(1);
        })();
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller-use-strict.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toEqual([]);
  });

  it("resolves a `@/` aliased import and flags a directive-less function used in useAnimatedStyle", () => {
    const memfs = memoryFs({
      "/abs/client/lib/aliased-util.ts": `export function scale(v: number) { return v; }`,
    });
    const source = `
      import { useAnimatedStyle } from "react-native-reanimated";
      import { scale } from "@/lib/aliased-util";
      function useStyle(v: { value: number }) {
        return useAnimatedStyle(() => ({ transform: [{ scale: scale(v.value) }] }));
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/abs/client/screens/Foo.tsx",
      source,
      memfs,
      { "@": "/abs/client" },
    );
    expect(offenders).toHaveLength(1);
    expect(offenders[0].calleeName).toBe("scale");
  });

  it("scans the object-handler form of useAnimatedScrollHandler and flags an offending onScroll body", () => {
    const memfs = memoryFs({
      "/virtual/track.ts": `export function trackScroll(y: number) { return y; }`,
    });
    const source = `
      import { useAnimatedScrollHandler } from "react-native-reanimated";
      import { trackScroll } from "./track";
      function useHandler() {
        return useAnimatedScrollHandler({
          onScroll: (event) => {
            trackScroll(event.contentOffset.y);
          },
        });
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller4.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toHaveLength(1);
    expect(offenders[0].workletKind).toBe("useAnimatedScrollHandler.onScroll");
  });

  it("scans a Gesture builder chain (.onUpdate/.onEnd) and flags an offending callback", () => {
    const memfs = memoryFs({
      "/virtual/gesture-util.ts": `export function clampX(x: number) { return x; }`,
    });
    const source = `
      import { Gesture } from "react-native-gesture-handler";
      import { clampX } from "./gesture-util";
      function useGesture(shared: { value: number }) {
        return Gesture.Pan()
          .onUpdate((e) => {
            shared.value = clampX(e.translationX);
          })
          .onEnd((e) => {
            shared.value = 0;
          });
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller5.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toHaveLength(1);
    expect(offenders[0].workletKind).toBe("Gesture.onUpdate");
    expect(offenders[0].calleeName).toBe("clampX");
  });

  it("does not flag a call passed to runOnJS (dispatches back to the JS thread, not a worklet)", () => {
    const memfs = memoryFs({
      "/virtual/js-thread-fn.ts": `export function updateState(v: boolean) { return v; }`,
    });
    const source = `
      import { runOnUI, runOnJS } from "react-native-reanimated";
      import { updateState } from "./js-thread-fn";
      function onPress() {
        runOnUI(() => {
          "worklet";
          runOnJS(updateState)(true);
        })();
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller6.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toEqual([]);
  });

  it("skips (does not flag) when the imported module can't be resolved on disk", () => {
    const memfs = memoryFs({}); // nothing readable
    const source = `
      import { runOnUI } from "react-native-reanimated";
      import { mystery } from "./does-not-exist";
      function onPress() {
        runOnUI(() => {
          "worklet";
          mystery();
        })();
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller7.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toEqual([]);
  });

  it("does not flag a locally-shadowed name that happens to match an import (a same-named local helper wins over the import)", () => {
    const memfs = memoryFs({
      "/virtual/external.ts": `export function helper(x: number) { return x + 1; }`, // no directive
    });
    const source = `
      import { runOnUI } from "react-native-reanimated";
      import { helper } from "./external";
      function onPress() {
        runOnUI(() => {
          "worklet";
          function helper(x: number) { return x; } // shadows the import
          helper(1);
        })();
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller8.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toEqual([]);
  });

  it("does not flag when the shadow is the worklet callback's OWN parameter", () => {
    const memfs = memoryFs({
      "/virtual/external-param.ts": `export function badFn(x: number) { return x + 1; }`, // no directive
    });
    const source = `
      import { runOnUI } from "react-native-reanimated";
      import { badFn } from "./external-param";
      function onPress() {
        runOnUI((badFn: (x: number) => number) => {
          "worklet";
          badFn(1);
        })();
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller8b.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toEqual([]);
  });

  it("does not flag when the shadow is a catch-clause binding", () => {
    const memfs = memoryFs({
      "/virtual/external-catch.ts": `export function parse(x: number) { return x; }`, // no directive
    });
    const source = `
      import { runOnUI } from "react-native-reanimated";
      import { parse } from "./external-catch";
      function onPress() {
        runOnUI(() => {
          "worklet";
          try {
            doSomething();
          } catch (parse) {
            parse(1);
          }
        })();
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller8c.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toEqual([]);
  });

  it("does not flag when the shadow is a for-loop declaration", () => {
    const memfs = memoryFs({
      "/virtual/external-loop.ts": `export function step(x: number) { return x; }`, // no directive
    });
    const source = `
      import { runOnUI } from "react-native-reanimated";
      import { step } from "./external-loop";
      function onPress() {
        runOnUI(() => {
          "worklet";
          for (let step = 0; step < 3; step++) {
            step(step);
          }
        })();
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller8d.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toEqual([]);
  });

  it("still flags a genuine cross-file offender when an UNRELATED local variable is nearby (shadow check must not over-suppress)", () => {
    const memfs = memoryFs({
      "/virtual/external-unrelated.ts": `export function badFn(x: number) { return x + 1; }`, // no directive
    });
    const source = `
      import { runOnUI } from "react-native-reanimated";
      import { badFn } from "./external-unrelated";
      function onPress() {
        runOnUI(() => {
          "worklet";
          const unrelated = 42;
          badFn(unrelated);
        })();
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller8e.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toHaveLength(1);
    expect(offenders[0].calleeName).toBe("badFn");
  });

  it("resolves a renamed import (`import { badFn as x }`) using the original exported name", () => {
    const memfs = memoryFs({
      "/virtual/renamed-src.ts": `export function badFn(x: number) { return x + 1; }`, // no directive
    });
    const source = `
      import { runOnUI } from "react-native-reanimated";
      import { badFn as renamed } from "./renamed-src";
      function onPress() {
        runOnUI(() => {
          "worklet";
          renamed(1);
        })();
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller9.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toHaveLength(1);
    expect(offenders[0].calleeName).toBe("renamed");
  });

  it("does not track a type-only named import (`import type { Foo }` / `import { type Foo }`)", () => {
    const memfs = memoryFs({}); // nothing readable — a type import can't resolve to a value anyway
    const source = `
      import { runOnUI } from "react-native-reanimated";
      import type { helper } from "./types-only";
      import { type otherHelper } from "./also-types-only";
      function onPress() {
        runOnUI(() => {
          "worklet";
          helper(1);
          otherHelper(1);
        })();
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/virtual/caller10.ts",
      source,
      memfs,
      NO_ALIASES,
    );
    expect(offenders).toEqual([]);
  });

  it("resolves a `@shared/` aliased import and flags a directive-less function", () => {
    const memfs = memoryFs({
      "/abs/shared/lib/shared-util.ts": `export function sharedFn(v: number) { return v; }`,
    });
    const source = `
      import { runOnUI } from "react-native-reanimated";
      import { sharedFn } from "@shared/lib/shared-util";
      function onPress() {
        runOnUI(() => {
          "worklet";
          sharedFn(1);
        })();
      }
    `;
    const offenders = scanFileForWorkletOffenders(
      "/abs/client/screens/Bar.tsx",
      source,
      memfs,
      { "@": "/abs/client", "@shared": "/abs/shared" },
    );
    expect(offenders).toHaveLength(1);
    expect(offenders[0].resolvedFile).toBe("/abs/shared/lib/shared-util");
  });
});

// ── Integration test: scan the real client/ tree ─────────────────────────────
// Proves the known-good precedents in the actual repo (glideToTopOffset,
// volumeToScale) pass, and that no new regression has crept in anywhere else.

const CLIENT_ROOT = path.join(process.cwd(), "client");
const SHARED_ROOT = path.join(process.cwd(), "shared");
const REAL_ALIASES: AliasRoots = { "@": CLIENT_ROOT, "@shared": SHARED_ROOT };

const realFs: ScanFsAdapter = {
  readFile(absPath: string) {
    try {
      return fs.readFileSync(absPath, "utf8");
    } catch {
      return null;
    }
  },
};

function listClientSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      out.push(...listClientSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue;
    if (entry.name.endsWith(".d.ts")) continue;
    out.push(full);
  }
  return out;
}

describe("every imported function called inside a worklet has a worklet directive (static guard)", () => {
  const files = listClientSourceFiles(CLIENT_ROOT);

  it("scans a sane number of files (a broken walker must not pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("no offenders across the real client/ tree", () => {
    const offenders = files.flatMap((file) =>
      scanFileForWorkletOffenders(
        file,
        fs.readFileSync(file, "utf8"),
        realFs,
        REAL_ALIASES,
      ),
    );
    expect(
      offenders.map(
        (o) =>
          `${path.relative(process.cwd(), o.file)}:${o.line} calls ${o.calleeName} (${o.workletKind}) — missing "worklet" directive in ${path.relative(process.cwd(), o.resolvedFile)}`,
      ),
    ).toEqual([]);
  });
});
