// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const eslintPluginPrettierRecommended = require("eslint-plugin-prettier/recommended");
const ocrecipesPlugin = require("./eslint-plugin-ocrecipes");

module.exports = defineConfig([
  expoConfig,
  eslintPluginPrettierRecommended,
  {
    ignores: ["dist/*", "server_dist/*"],
  },
  {
    files: ["server/**/*.ts"],
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
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
