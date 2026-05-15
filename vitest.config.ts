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
      reporter: ["text", "text-summary", "json", "html"],
      exclude: [
        "node_modules",
        "server_dist",
        "**/*.test.ts",
        "**/*.test.tsx",
        "test/mocks/**",
        "test/setup.ts",
        "test/global-teardown.ts",
      ],
      // Hard floor — set below current measured baseline (as of 2026-05-15:
      // lines 83.92%, statements 83.14%, functions 81.54%, branches 74.02%)
      // to leave room for normal variance. Ratchet up over time;
      // see docs/patterns/testing.md → "Coverage Threshold Ratcheting".
      thresholds: {
        // autoUpdate must stay false — never let CI rewrite this config.
        // Set in config (not CLI) so it cannot be parsed as the truthy string "false".
        autoUpdate: false,
        lines: 80,
        functions: 78,
        statements: 80,
        branches: 70,
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
