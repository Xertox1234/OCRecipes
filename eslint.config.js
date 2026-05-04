// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const eslintPluginPrettierRecommended = require("eslint-plugin-prettier/recommended");
const ocrecipesPlugin = require("./eslint-plugin-ocrecipes");

module.exports = defineConfig([
  expoConfig,
  eslintPluginPrettierRecommended,
  {
    ignores: ["dist/*", "server_dist/*", ".claude/worktrees/**"],
  },
  {
    // Native RN packages resolved at link time (not by Node) produce false-positive
    // import/no-unresolved errors even when TypeScript resolves them correctly.
    // Add packages here only when they have valid TS types but non-standard entry points.
    rules: {
      "import/no-unresolved": [
        "error",
        { ignore: ["react-native-vision-camera-ocr-plus"] },
      ],
    },
  },
  {
    files: ["server/**/*.ts"],
    rules: {
      "no-console": "error",
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAsExpression > TSNeverKeyword",
          message:
            "Do not use 'as never' in tests. Use typed mock factories from server/__tests__/factories instead.",
        },
      ],
    },
  },
  {
    files: ["server/routes/**/*.ts"],
    plugins: {
      ocrecipes: ocrecipesPlugin,
    },
    rules: {
      "ocrecipes/no-bare-error-response": "error",
      "ocrecipes/no-parseint-req": "error",
      "ocrecipes/no-as-string-req": "error",
    },
  },
]);
