// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const eslintPluginPrettierRecommended = require("eslint-plugin-prettier/recommended");
const ocrecipesPlugin = require("./eslint-plugin-ocrecipes");
const tseslint = require("typescript-eslint");
const path = require("path");

module.exports = defineConfig([
  expoConfig,
  eslintPluginPrettierRecommended,
  {
    ignores: [
      "dist/*",
      "server_dist/*",
      ".claude/worktrees/**",
      ".worktrees/**",
    ],
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
  // Type-aware async-safety rules. Omitted when ESLINT_NO_TYPE_AWARE is set
  // (pre-commit), so commits stay fast. CI runs npm run lint without the flag.
  ...(process.env.ESLINT_NO_TYPE_AWARE
    ? []
    : [
        {
          files: ["**/*.{ts,tsx}"],
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
              projectService: true,
              tsconfigRootDir: path.resolve("."),
            },
          },
          plugins: { "@typescript-eslint": tseslint.plugin },
          rules: {
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-misused-promises": [
              "error",
              { checksVoidReturn: { attributes: false } },
            ],
            "@typescript-eslint/await-thenable": "error",
            "@typescript-eslint/require-await": "error",
            "@typescript-eslint/no-implied-eval": "error",
            "@typescript-eslint/prefer-promise-reject-errors": "error",
          },
        },
      ]),
  ...(process.env.ESLINT_NO_TYPE_AWARE
    ? []
    : [
        {
          files: ["**/*.test.{ts,tsx}"],
          rules: { "@typescript-eslint/require-await": "off" },
        },
      ]),
]);
