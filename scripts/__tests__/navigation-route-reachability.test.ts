import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// React Navigation resolves a bare `navigate("X")` only in the caller's own
// navigator and its ANCESTORS — never in a sibling branch's nested stack — and
// drops the action silently in release builds when nothing matches (see
// docs/solutions/logic-errors/bare-navigate-cannot-descend-into-an-unrelated-nested-navigator-2026-09-29.md).
// Screen tests mock useNavigation, so no unit test can see a dropped action.
// This static check reads the navigator files and every registered screen's
// own source, and requires each literal navigate/push/replace("X") to name a
// route visible from where that screen is registered.
//
// Scope limit: only the screen's own file is scanned, not the child
// components or hooks it renders. The two library launchers (the Profile
// tiles and CoachChat's links) are checked by name below.

const ROOT = path.resolve(__dirname, "../..");
const NAV_DIR = "client/navigation";

/** navigator file → parent navigator file (null = the root). */
const NAVIGATOR_PARENT: Record<string, string | null> = {
  RootStackNavigator: null,
  OnboardingNavigator: "RootStackNavigator",
  MainTabNavigator: "RootStackNavigator",
  HomeStackNavigator: "MainTabNavigator",
  MealPlanStackNavigator: "MainTabNavigator",
  ChatStackNavigator: "MainTabNavigator",
  ProfileStackNavigator: "MainTabNavigator",
};

interface Registration {
  navigator: string;
  name: string;
  file: string | null;
}

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function resolveImport(spec: string): string | null {
  const base = spec.replace(/^@\//, "client/");
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    if (fs.existsSync(path.join(ROOT, base + ext))) return base + ext;
  }
  return null;
}

function parseNavigator(navigator: string): Registration[] {
  const src = readRepo(`${NAV_DIR}/${navigator}.tsx`);
  const imports: Record<string, string> = {};
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+"(@\/[^"]+)"/g)) {
    imports[m[1]] = m[2];
  }
  const regs: Registration[] = [];
  for (const block of src.split(/<(?:Stack|Tab)\.Screen\b/).slice(1)) {
    const name = block.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;
    const comp = block.match(/component=\{(\w+)\}/)?.[1];
    const spec = comp ? imports[comp] : undefined;
    regs.push({ navigator, name, file: spec ? resolveImport(spec) : null });
  }
  return regs;
}

function navigationTargets(file: string): string[] {
  const src = readRepo(file);
  return [...src.matchAll(/\.(?:navigate|push|replace)\(\s*"([A-Z]\w*)"/g)].map(
    (m) => m[1],
  );
}

const registrations = Object.keys(NAVIGATOR_PARENT).flatMap(parseNavigator);

function visibleRoutes(navigator: string): Set<string> {
  const routes = new Set<string>();
  for (let n: string | null = navigator; n; n = NAVIGATOR_PARENT[n]) {
    for (const r of registrations) if (r.navigator === n) routes.add(r.name);
  }
  return routes;
}

/** Edges whose target is not visible from the screen's registration. */
function unresolvedEdges(reg: Registration): string[] {
  if (!reg.file || reg.file.startsWith(NAV_DIR)) return [];
  const visible = visibleRoutes(reg.navigator);
  return navigationTargets(reg.file)
    .filter((t) => !visible.has(t))
    .map((t) => `${reg.navigator}:${reg.name} -> ${t}`);
}

/**
 * Problems for every route a launcher file opens from `host`: the route must
 * resolve the way React Navigation does (host first, then its ancestors), and
 * the screen it lands on must reach all of its own links.
 */
function launcherProblems(file: string, host: string): string[] {
  const problems: string[] = [];
  for (const target of new Set(navigationTargets(file))) {
    let reg: Registration | undefined;
    for (let n: string | null = host; n && !reg; n = NAVIGATOR_PARENT[n]) {
      reg = registrations.find((r) => r.navigator === n && r.name === target);
    }
    if (!reg) problems.push(`${file} -> ${target}: not reachable from ${host}`);
    else problems.push(...unresolvedEdges(reg));
  }
  return problems;
}

describe("navigation route reachability", () => {
  it("parses enough of the app to mean something (denominator + known-good control)", () => {
    const screens = registrations.filter(
      (r) => r.file && !r.file.startsWith(NAV_DIR),
    );
    const edges = screens.flatMap((r) => navigationTargets(r.file!));
    expect(screens.length).toBeGreaterThan(50);
    expect(edges.length).toBeGreaterThan(90);
    // Control: SavedItems (Profile stack) → FeaturedRecipeDetail (registered
    // on the ROOT stack) is a known-good edge that only resolves through the
    // ancestor walk — the property this whole check relies on.
    const savedItems = registrations.find(
      (r) => r.navigator === "ProfileStackNavigator" && r.name === "SavedItems",
    )!;
    expect(navigationTargets(savedItems.file!)).toContain(
      "FeaturedRecipeDetail",
    );
    expect(unresolvedEdges(savedItems)).toEqual([]);
  });

  it("every screen a Profile library tile opens can reach all of its own links", () => {
    const file = "client/components/profile/library-config.ts";
    expect(navigationTargets(file).length).toBe(7);
    expect(launcherProblems(file, "ProfileStackNavigator")).toEqual([]);
  });

  it("every screen the Coach's links open can reach all of its own links", () => {
    // CoachChat renders only inside CoachPro (Coach tab stack). Its "*Modal"
    // switch cases are the AI's screen names, not route names — they used to
    // open root-modal copies whose list/cookbook taps were dropped.
    const file = "client/components/coach/CoachChat.tsx";
    // Denominator: all 11 distinct switch targets, incl. root routes
    // (NutritionDetail) that resolve only through the ancestor walk.
    expect(new Set(navigationTargets(file)).size).toBe(11);
    expect(navigationTargets(file)).toContain("NutritionDetail");
    expect(launcherProblems(file, "ChatStackNavigator")).toEqual([]);
  });

  it("app-wide, no registered screen links to a route it cannot reach", () => {
    const unresolved = [
      ...new Set(registrations.flatMap(unresolvedEdges)),
    ].sort();
    expect(unresolved).toEqual([]);
  });
});
