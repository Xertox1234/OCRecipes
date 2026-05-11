import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  test: {
    globals: true,
    environment: "node",
    // @ts-expect-error — environmentMatchGlobs exists at runtime in vitest but is missing from InlineConfig type
    environmentMatchGlobs: [["client/components/**/*.test.tsx", "jsdom"]],
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: [
      "node_modules",
      "server_dist",
      ".expo",
      ".claude/worktrees",
      ".worktrees",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json", "json-summary", "html"],
      exclude: [
        "node_modules",
        "server_dist",
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/__tests__/**",
        "**/__mocks__/**",
        "test/**",
        "e2e/**",
        "scripts/**",
        "evals/runner*.ts",
        "**/*.d.ts",
        "**/index.ts",
        "vitest.config.ts",
        "drizzle.config.ts",
      ],
      // Per-directory floors. Tuned conservatively below current actuals so the
      // first CI run passes; ratchet upward as gaps are filled. A failure here
      // means coverage in that area dropped — investigate the diff, don't lower
      // the floor.
      thresholds: {
        // Global safety net for paths not matched below.
        lines: 40,
        functions: 40,
        branches: 50,
        statements: 40,

        "server/services/**": { lines: 65, functions: 65, branches: 60, statements: 65 },
        "server/storage/**": { lines: 55, functions: 55, branches: 55, statements: 55 },
        "server/routes/**": { lines: 60, functions: 60, branches: 55, statements: 60 },
        "server/middleware/**": { lines: 60, functions: 60, branches: 55, statements: 60 },
        "server/lib/**": { lines: 60, functions: 60, branches: 55, statements: 60 },
        "shared/**": { lines: 50, functions: 50, branches: 50, statements: 50 },
        "client/lib/**": { lines: 65, functions: 65, branches: 60, statements: 65 },
        "client/hooks/**": { lines: 50, functions: 50, branches: 50, statements: 50 },
        "client/context/**": { lines: 50, functions: 50, branches: 50, statements: 50 },
        "client/components/**": { lines: 35, functions: 35, branches: 40, statements: 35 },
        // Known gap — screen logic is rarely extracted to *-utils. Bar is a
        // placeholder; raise as logic is extracted and tested.
        "client/screens/**": { lines: 5, functions: 5, branches: 10, statements: 5 },
        "client/camera/**": { lines: 40, functions: 40, branches: 40, statements: 40 },
      },
    },
    pool: "forks",
    testTimeout: 10000,
    setupFiles: ["./test/setup.ts"],
    globalSetup: ["./test/global-teardown.ts"],
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "./shared"),
      "@": path.resolve(__dirname, "./client"),
      "react-native": path.resolve(__dirname, "./test/mocks/react-native.ts"),
      "react-native-reanimated": path.resolve(
        __dirname,
        "./test/mocks/react-native-reanimated.ts",
      ),
      "react-native-safe-area-context": path.resolve(
        __dirname,
        "./test/mocks/react-native-safe-area-context.ts",
      ),
      "react-native-gesture-handler/ReanimatedSwipeable": path.resolve(
        __dirname,
        "./test/mocks/react-native-gesture-handler-reanimated-swipeable.ts",
      ),
      "react-native-gesture-handler": path.resolve(
        __dirname,
        "./test/mocks/react-native-gesture-handler.ts",
      ),
      "@expo/vector-icons": path.resolve(
        __dirname,
        "./test/mocks/expo-vector-icons.ts",
      ),
      "@gorhom/bottom-sheet": path.resolve(
        __dirname,
        "./test/mocks/gorhom-bottom-sheet.ts",
      ),
      "expo-haptics": path.resolve(__dirname, "./test/mocks/expo-haptics.ts"),
      "expo-blur": path.resolve(__dirname, "./test/mocks/expo-blur.ts"),
      "expo-linear-gradient": path.resolve(
        __dirname,
        "./test/mocks/expo-linear-gradient.ts",
      ),
    },
  },
});
