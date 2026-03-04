// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const eslintPluginPrettierRecommended = require("eslint-plugin-prettier/recommended");
const nutriscanPlugin = require("./eslint-plugin-nutriscan");

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
      nutriscan: nutriscanPlugin,
    },
    rules: {
      "nutriscan/no-bare-error-response": "error",
      "nutriscan/no-parseint-req": "error",
      "nutriscan/no-as-string-req": "error",
    },
  },
]);
