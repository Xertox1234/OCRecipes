import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// A gorhom BottomSheetModal portals to the NEAREST BottomSheetModalProvider.
// The app-wide one sits above NavigationContainer (client/App.tsx), so on iOS
// a sheet opened from a screen presented as a native modal (presentation
// "modal" / "fullScreenModal") renders under that modal's view controller:
// the sheet "opens" (isOpen flips, the screen behind is hidden from VoiceOver)
// but nobody can see or tap it. Observed on the simulator 2026-10-01 for
// CookSessionCapture (close X did nothing — the user is trapped) and
// CookSessionReview (Remove ingredient did nothing).
//
// Each such screen must give its sheets a provider inside the modal:
// `layout={withSheetProvider}` on its Stack.Screen. This static check walks
// each root screen's value imports (stopping at other screens and at
// navigation/) and requires that layout on every native-modal screen that can
// reach a BottomSheetModal. Screen render tests mock the sheet library, so no
// unit test can see this.

const ROOT = path.resolve(__dirname, "../..");
const NAV = "client/navigation/RootStackNavigator.tsx";

interface RootScreen {
  name: string;
  presentation: string | null;
  hasSheetLayout: boolean;
  file: string | null;
}

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function resolveFrom(fromRel: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join("client", spec.slice(2));
  else if (spec.startsWith(".")) base = path.join(path.dirname(fromRel), spec);
  else return null;
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    const abs = path.join(ROOT, base + ext);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return path.normalize(base + ext);
    }
  }
  return null;
}

function parseRootScreens(): RootScreen[] {
  const src = readRepo(NAV);
  const imports: Record<string, string> = {};
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+"([^"]+)"/g)) {
    imports[m[1]] = m[2];
  }
  // Split on the NEXT registration rather than matching to "/>": an options
  // callback can contain JSX (<HeaderTitle … />) before `presentation`.
  return src
    .split(/<Stack\.Screen\b/)
    .slice(1)
    .map((block) => {
      const comp = block.match(/component=\{(\w+)\}/)?.[1];
      const spec = comp ? imports[comp] : undefined;
      return {
        name: block.match(/name="([^"]+)"/)?.[1] ?? "?",
        presentation: block.match(/presentation:\s*"(\w+)"/)?.[1] ?? null,
        hasSheetLayout: /layout=\{withSheetProvider\}/.test(block),
        file: spec ? resolveFrom(NAV, spec) : null,
      };
    });
}

/** Value imports of a file, plus whether it imports BottomSheetModal itself. */
function scanFile(rel: string): { deps: string[]; usesSheet: boolean } {
  const src = readRepo(rel);
  const deps: string[] = [];
  let usesSheet = false;
  for (const m of src.matchAll(
    /import\s+(type\s+)?([\s\S]*?)\s+from\s+"([^"]+)"/g,
  )) {
    if (m[1]) continue;
    if (m[3] === "@gorhom/bottom-sheet" && /\bBottomSheetModal\b/.test(m[2])) {
      usesSheet = true;
    }
    const dep = resolveFrom(rel, m[3]);
    if (dep) deps.push(dep);
  }
  return { deps, usesSheet };
}

function reachesSheet(entry: string, screenFiles: Set<string>): boolean {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    const { deps, usesSheet } = scanFile(queue.shift()!);
    if (usesSheet) return true;
    for (const dep of deps) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      if (screenFiles.has(dep) || dep.startsWith("client/navigation/")) {
        continue;
      }
      queue.push(dep);
    }
  }
  return false;
}

const isNativeModal = (s: RootScreen) =>
  s.presentation !== null && s.presentation !== "card";

describe("native-modal screens give their bottom sheets a provider", () => {
  const screens = parseRootScreens();
  const screenFiles = new Set(
    screens.map((s) => s.file).filter((f): f is string => f !== null),
  );
  const sheetModals = screens
    .filter(isNativeModal)
    .filter((s) => s.file && reachesSheet(s.file, screenFiles))
    .map((s) => s.name);

  it("parses the root navigator (denominator + controls)", () => {
    expect(screens.length).toBeGreaterThan(30);
    expect(screens.filter((s) => s.file === null)).toEqual([]);
    expect(screens.filter(isNativeModal).length).toBeGreaterThan(25);
    // Positive controls: presentation set inside an options callback after
    // JSX, and a sheet reached only through a hook-returned component.
    expect(
      screens.find((s) => s.name === "GroceryListsModal")?.presentation,
    ).toBe("modal");
    expect(sheetModals).toContain("CookSessionCapture");
    // Negative control: the tab host is not a native modal.
    expect(screens.find((s) => s.name === "Main")?.presentation).toBeNull();
  });

  it("every native-modal screen that can open a sheet carries withSheetProvider", () => {
    const missing = screens
      .filter((s) => sheetModals.includes(s.name) && !s.hasSheetLayout)
      .map((s) => s.name);
    expect(missing).toEqual([]);
  });
});
