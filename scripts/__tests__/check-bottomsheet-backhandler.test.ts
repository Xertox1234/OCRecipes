import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

const scriptPath = path.resolve(
  __dirname,
  "..",
  "check-bottomsheet-backhandler.js",
);

/**
 * Run the BottomSheetModal/useSheetBackHandler wiring check against a given
 * file path. Returns the process exit code and stdout for assertions.
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
  const tmpBase = fs.mkdtempSync(
    path.join(os.tmpdir(), "bsm-backhandler-check-"),
  );
  tmpDirs.push(tmpBase);
  const file = path.join(tmpBase, "Screen.tsx");
  fs.writeFileSync(file, contents);
  return file;
}

describe("check-bottomsheet-backhandler.js", () => {
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 0 for a file with no BottomSheetModal at all", () => {
    const file = writeTsx(`
      export function Foo() {
        return <View />;
      }
    `);
    const { status } = runCheck(file);
    expect(status).toBe(0);
  });

  it("exits 0 when a BottomSheetModal is wired to useSheetBackHandler", () => {
    const file = writeTsx(`
      function Screen() {
        useSheetBackHandler(sheetRef, isOpen);
        return (
          <BottomSheetModal
            ref={sheetRef}
          >
            <Content />
          </BottomSheetModal>
        );
      }
    `);
    const { status } = runCheck(file);
    expect(status).toBe(0);
  });

  it("exits 1 when a BottomSheetModal has no useSheetBackHandler call in the file", () => {
    const file = writeTsx(`
      function Screen() {
        return (
          <BottomSheetModal
            ref={sheetRef}
          >
            <Content />
          </BottomSheetModal>
        );
      }
    `);
    const { status, stdout } = runCheck(file);
    expect(status).toBe(1);
    expect(stdout).toContain("useSheetBackHandler");
  });

  it("does not flag BottomSheetModalProvider (no hook required)", () => {
    const file = writeTsx(`
      function App() {
        return (
          <BottomSheetModalProvider>
            <Screen />
          </BottomSheetModalProvider>
        );
      }
    `);
    const { status } = runCheck(file);
    expect(status).toBe(0);
  });

  it("does not flag a useRef<BottomSheetModal> type annotation with no JSX render", () => {
    const file = writeTsx(`
      function useSomething() {
        const ref = useRef<BottomSheetModal>(null);
        return ref;
      }
    `);
    const { status } = runCheck(file);
    expect(status).toBe(0);
  });

  it("catches a self-closing BottomSheetModal with no children", () => {
    const file = writeTsx(`
      function Screen() {
        return <BottomSheetModal ref={sheetRef} />;
      }
    `);
    const { status } = runCheck(file);
    expect(status).toBe(1);
  });

  describe("aliased imports", () => {
    it("catches an unwired sheet rendered under an import alias", () => {
      const file = writeTsx(`
        import { BottomSheetModal as Sheet } from "@gorhom/bottom-sheet";

        function Screen() {
          return <Sheet ref={sheetRef} />;
        }
      `);
      const { status, stdout } = runCheck(file);
      expect(status).toBe(1);
      expect(stdout).toContain("useSheetBackHandler");
    });

    it("exits 0 when an alias-rendered sheet is wired to useSheetBackHandler", () => {
      const file = writeTsx(`
        import { BottomSheetModal as Sheet } from "@gorhom/bottom-sheet";

        function Screen() {
          useSheetBackHandler(sheetRef, isOpen);
          return <Sheet ref={sheetRef} />;
        }
      `);
      const { status } = runCheck(file);
      expect(status).toBe(0);
    });

    it("catches an unwired aliased sheet from a multi-line import specifier list", () => {
      const file = writeTsx(`
        import {
          BottomSheetBackdrop,
          BottomSheetModal as Sheet,
          BottomSheetView,
        } from "@gorhom/bottom-sheet";

        function Screen() {
          return (
            <Sheet
              ref={sheetRef}
            >
              <Content />
            </Sheet>
          );
        }
      `);
      const { status } = runCheck(file);
      expect(status).toBe(1);
    });

    it("catches an unwired aliased sheet from a default + named import", () => {
      const file = writeTsx(`
        import BottomSheet, { BottomSheetModal as Sheet } from "@gorhom/bottom-sheet";

        function Screen() {
          return <Sheet ref={sheetRef} />;
        }
      `);
      const { status } = runCheck(file);
      expect(status).toBe(1);
    });

    it("does not flag a type-only aliased import used only as a ref type argument", () => {
      const file = writeTsx(`
        import type { BottomSheetModal as SheetType } from "@gorhom/bottom-sheet";

        function useSomething() {
          const ref = useRef<SheetType>(null);
          return ref;
        }
      `);
      const { status } = runCheck(file);
      expect(status).toBe(0);
    });

    it("does not flag a specifier-level type-only alias inside a value import", () => {
      const file = writeTsx(`
        import { type BottomSheetModal as SheetType, BottomSheetView } from "@gorhom/bottom-sheet";

        function useSomething() {
          const ref = useRef<SheetType>(null);
          return ref;
        }
      `);
      const { status } = runCheck(file);
      expect(status).toBe(0);
    });

    it("does not treat an `as` type cast outside an import as an alias", () => {
      const file = writeTsx(`
        import { BottomSheetModal } from "@gorhom/bottom-sheet";

        const Mock = BottomSheetModal as unknown as typeof BottomSheetModal;

        export function helper() {
          return Mock;
        }
      `);
      const { status } = runCheck(file);
      expect(status).toBe(0);
    });

    it("does not flag a longer JSX tag that merely starts with the alias name", () => {
      const file = writeTsx(`
        import { BottomSheetModal as Sheet } from "@gorhom/bottom-sheet";

        function App() {
          return (
            <SheetProvider>
              <Screen />
            </SheetProvider>
          );
        }
      `);
      const { status } = runCheck(file);
      expect(status).toBe(0);
    });
  });
});
