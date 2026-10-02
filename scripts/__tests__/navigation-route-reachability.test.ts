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
// components or hooks it renders (e.g. CoachChat's navigate calls).

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

/**
 * Known-unresolved edges, kept equal to what the tree produces (a ratchet in
 * both directions). These are the root-modal copies the Coach still opens
 * (CoachChat → "*Modal"): their inner links target Plan-stack-only routes.
 * Shrink this list when those paths are fixed; never grow it to make a new
 * dropped navigation pass.
 */
const KNOWN_UNRESOLVED = [
  "RootStackNavigator:CookbookListModal -> CookbookCreate",
  "RootStackNavigator:CookbookListModal -> CookbookDetail",
  "RootStackNavigator:CookbookListModal -> FavouriteRecipes",
  "RootStackNavigator:GroceryListsModal -> GroceryList",
];

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
    const tiles = navigationTargets(
      "client/components/profile/library-config.ts",
    );
    expect(tiles.length).toBe(7);
    const problems: string[] = [];
    for (const tile of tiles) {
      // Resolve the tile the way React Navigation does: nearest navigator
      // first, walking up from the Profile stack.
      let reg: Registration | undefined;
      for (
        let n: string | null = "ProfileStackNavigator";
        n && !reg;
        n = NAVIGATOR_PARENT[n]
      ) {
        reg = registrations.find((r) => r.navigator === n && r.name === tile);
      }
      if (!reg) problems.push(`tile -> ${tile}: not reachable from Profile`);
      else problems.push(...unresolvedEdges(reg));
    }
    expect(problems).toEqual([]);
  });

  it("app-wide, the only unresolved links are the known Coach-only modal copies", () => {
    const unresolved = [
      ...new Set(registrations.flatMap(unresolvedEdges)),
    ].sort();
    expect(unresolved).toEqual([...KNOWN_UNRESOLVED].sort());
  });
});
