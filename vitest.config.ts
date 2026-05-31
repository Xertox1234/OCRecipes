import { defineConfig } from "vitest/config";
import path from "path";
import os from "node:os";

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
      // `include` makes coverage count source files no test imports as 0% so the
      // headline is honest (without it, untested files vanish from the
      // denominator and inflate the number). In Vitest 4 `coverage.all` was
      // removed — defining `include` is now the supported way to pull in
      // uncovered files. The glob keeps instrumentation scoped to app source;
      // configs, mocks, and type-only files stay out.
      include: ["client/**/*.{ts,tsx}", "server/**/*.ts", "shared/**/*.ts"],
      reporter: ["text", "text-summary", "json", "html"],
      exclude: [
        "node_modules",
        "server_dist",
        "**/*.test.ts",
        "**/*.test.tsx",
        "test/mocks/**",
        "test/setup.ts",
        "test/global-teardown.ts",
        // Operational CLI scripts (backfills, seeds, migrations) — run by hand,
        // not part of app runtime; excluded so they don't skew the floor.
        "server/scripts/**",
      ],
      // Hard floor — set below current measured baseline (as of 2026-05-23,
      // with the `include` glob above so untested files count as 0%:
      // lines 53.05%, statements 52.66%, functions 46.66%, branches 44.24%)
      // to leave room for normal variance. Ratchet up over time;
      // see docs/legacy-patterns/testing.md → "Coverage Threshold Ratcheting".
      thresholds: {
        // autoUpdate must stay false — never let CI rewrite this config.
        // Set in config (not CLI) so it cannot be parsed as the truthy string "false".
        autoUpdate: false,
        lines: 49,
        functions: 42,
        statements: 48,
        branches: 40,
      },
    },
    pool: "forks",
    // Locally, cap workers below the core count so they keep CPU headroom
    // under machine load — without it, worker starvation makes timing-sensitive
    // DB tests trip testTimeout nondeterministically. CI runs unconstrained:
    // isolated runners don't hit the contention, and a static cap would
    // oversubscribe smaller runners. See docs/legacy-patterns/testing.md.
    maxWorkers: process.env.CI ? undefined : Math.max(1, os.cpus().length - 3),
    testTimeout: 10000,
    // Retry failed tests up to 2x (3 attempts total). The route-test suite has a
    // probabilistic flake under full-suite parallel CPU contention: a rotating ~1
    // test per ~2 runs intermittently times out or returns a wrong status, yet
    // passes on re-run and in isolation (investigation:
    // todos/archive/2026-05-23-test-isolation-401-vs-403-flakiness.md). There is
    // no deterministic root cause to fix. A genuine failure fails all 3 attempts
    // and is still reported; only contention flakes are absorbed.
    retry: 2,
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
      "@react-native-community/netinfo": path.resolve(
        __dirname,
        "./test/mocks/react-native-community-netinfo.ts",
      ),
    },
  },
});
