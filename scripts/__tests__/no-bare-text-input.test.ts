// Structural guard: client code must not render a bare react-native /
// gorhom TextInput — every text-entry surface goes through a shared primitive
// that carries the focus feedback (eslint.config.js, no-restricted-imports).
import path from "node:path";
import { createRequire } from "node:module";
import { describe, it, expect, beforeAll } from "vitest";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, "../..");

async function lint(code: string, file: string) {
  process.env.ESLINT_NO_TYPE_AWARE = "1";
  const { ESLint } = require("eslint");
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, {
    filePath: path.join(ROOT, file),
  });
  return (result.messages as { ruleId: string | null }[]).filter(
    (m) => m.ruleId === "@typescript-eslint/no-restricted-imports",
  );
}

describe("no bare TextInput in client code", () => {
  beforeAll(() => {
    process.env.ESLINT_NO_TYPE_AWARE = "1";
  });

  it("rejects a value import of TextInput from react-native", async () => {
    const hits = await lint(
      'import { TextInput } from "react-native";\nexport const X = TextInput;\n',
      "client/screens/Fake.tsx",
    );
    expect(hits).toHaveLength(1);
  });

  it("rejects an aliased import", async () => {
    const hits = await lint(
      'import { TextInput as RNTextInput } from "react-native";\nexport const X = RNTextInput;\n',
      "client/screens/Fake.tsx",
    );
    expect(hits).toHaveLength(1);
  });

  it("rejects BottomSheetTextInput from @gorhom/bottom-sheet", async () => {
    const hits = await lint(
      'import { BottomSheetTextInput } from "@gorhom/bottom-sheet";\nexport const X = BottomSheetTextInput;\n',
      "client/components/Fake.tsx",
    );
    expect(hits).toHaveLength(1);
  });

  it("allows type-only imports (refs)", async () => {
    const hits = await lint(
      'import type { TextInput } from "react-native";\nimport { type TextInput as T2 } from "react-native";\nexport type X = TextInput | T2;\n',
      "client/screens/Fake.tsx",
    );
    expect(hits).toHaveLength(0);
  });

  it("allows the shared primitives to import the raw input", async () => {
    for (const file of [
      "client/components/TextInput.tsx",
      "client/components/FocusTextInput.tsx",
    ]) {
      const hits = await lint(
        'import { TextInput } from "react-native";\nexport const X = TextInput;\n',
        file,
      );
      expect(hits).toHaveLength(0);
    }
  });
});
