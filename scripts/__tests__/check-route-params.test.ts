import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

const scriptPath = path.resolve(__dirname, "..", "check-route-params.js");

/**
 * Run the route-param shadow check against a given file path. Returns the
 * process exit code and stdout for assertions.
 */
function runCheck(targetFile: string): {
  status: number;
  stdout: string;
} {
  const result = spawnSync("node", [scriptPath, targetFile], {
    encoding: "utf8",
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
  };
}

/** Track temp dirs created during a test so we can clean them up. */
const tmpDirs: string[] = [];

function writeTsx(contents: string): string {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "route-params-check-"));
  tmpDirs.push(tmpBase);
  const file = path.join(tmpBase, "Screen.tsx");
  fs.writeFileSync(file, contents);
  return file;
}

describe("check-route-params.js", () => {
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 on the single-line inline-object RouteProp shadow", () => {
    const file = writeTsx(`
      type RouteParams = {
        imageUri: string;
      };

      export default function Screen() {
        const route = useRoute<RouteProp<{ params: RouteParams }, "params">>();
        return <View uri={route.params.imageUri} />;
      }
    `);
    const { status, stdout } = runCheck(file);
    expect(status).toBe(1);
    expect(stdout).toContain("RootStackParamList");
  });

  // The regression case for the `\s*` in the pattern. Prettier owns formatting
  // in this repo, so a violation can be COMMITTED already wrapped across lines
  // — which is how ItemDetailScreen escaped both greps used to bound the defect
  // class. A bare `RouteProp<{` literal match would pass this silently.
  //
  // Note there is no ordering guarantee to lean on: `prettier --write` lives in
  // the `*.{ts,tsx}` lint-staged entry and this check in `client/**/*.{ts,tsx}`,
  // and lint-staged runs separate glob entries concurrently. The pattern has to
  // tolerate both forms on its own merits.
  it("exits 1 on the Prettier-wrapped multi-line form", () => {
    const file = writeTsx(`
      type SomeLongerAliasNameForRouteParams = {
        imageUri: string;
      };

      export default function Screen() {
        const route = useRoute<
          RouteProp<
            { params: SomeLongerAliasNameForRouteParams },
            "params"
          >
        >();
        return <View uri={route.params.imageUri} />;
      }
    `);
    const { status, stdout } = runCheck(file);
    expect(status).toBe(1);
    // Assert the diagnostic too, not just the code: a MISSING or crashed script
    // also exits 1, so a status-only assertion here would pass for the wrong
    // reason — and this is the case guarding the `\s*` in the pattern.
    expect(stdout).toContain("RootStackParamList");
  });

  // Extracting the inline literal to a name is a two-line refactor that leaves
  // the shadow — and its silent param-drop — completely intact. A rule that only
  // knows the inline form is not a rule about the defect class.
  it("exits 1 when the ParamList argument is a NAMED local object-literal alias", () => {
    const file = writeTsx(`
      type LocalParams = {
        imageUri: string;
      };
      type ScreenRoute = RouteProp<LocalParams, "LabelAnalysis">;

      export default function Screen() {
        const route = useRoute<ScreenRoute>();
        return <View uri={route.params.imageUri} />;
      }
    `);
    const { status, stdout } = runCheck(file);
    expect(status).toBe(1);
    expect(stdout).toContain("LocalParams");
  });

  // The discriminator between "shadow" and "source of truth" is `export`: every
  // canonical ParamList in this repo is `export type <Name>ParamList = {` in its
  // navigator module. Without this carve-out the navigators would flag themselves.
  it("exits 0 when the named alias is EXPORTED (a navigator's own ParamList)", () => {
    const file = writeTsx(`
      export type ProfileStackParamList = {
        ItemDetail: { itemId: number };
      };
      type ScreenRoute = RouteProp<ProfileStackParamList, "ItemDetail">;

      export default function Screen() {
        const route = useRoute<ScreenRoute>();
        return <View id={route.params.itemId} />;
      }
    `);
    const { status } = runCheck(file);
    expect(status).toBe(0);
  });

  it("exits 0 when RouteProp indexes the canonical ParamList", () => {
    const file = writeTsx(`
      type ScreenRouteProp = RouteProp<RootStackParamList, "LabelAnalysis">;

      export default function Screen() {
        const route = useRoute<ScreenRouteProp>();
        return <View uri={route.params.imageUri} />;
      }
    `);
    const { status } = runCheck(file);
    expect(status).toBe(0);
  });

  // A `RouteParams` alias is only a defect when it RESTATES the param shape.
  // Deriving one from the canonical list is the thing we want people to write,
  // so a name-based ban would be wrong. The rule is structural, not nominal.
  it("exits 0 on a RouteParams alias DERIVED from the ParamList", () => {
    const file = writeTsx(`
      type RouteParams = RootStackParamList["LabelAnalysis"];

      export default function Screen() {
        const route = useRoute<RouteProp<RootStackParamList, "LabelAnalysis">>();
        const params: RouteParams = route.params;
        return <View uri={params.imageUri} />;
      }
    `);
    const { status } = runCheck(file);
    expect(status).toBe(0);
  });

  it("exits 0 for a file with no RouteProp at all", () => {
    const file = writeTsx(`
      export function Foo() {
        return <View />;
      }
    `);
    const { status } = runCheck(file);
    expect(status).toBe(0);
  });

  // A checker that scans zero inputs is green and meaningless. The count in the
  // success line is what distinguishes "checked and clean" from "checked nothing".
  it("reports how many files it actually scanned on success", () => {
    const file = writeTsx(`export function Foo() { return <View />; }`);
    const { status, stdout } = runCheck(file);
    expect(status).toBe(0);
    expect(stdout).toMatch(/1 file/);
  });
});
