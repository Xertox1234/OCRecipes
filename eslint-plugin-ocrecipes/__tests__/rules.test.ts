import { createRequire } from "node:module";
import { RuleTester } from "eslint";
import * as tsParser from "@typescript-eslint/parser";

const require = createRequire(import.meta.url);
const plugin = require("../index.js") as {
  rules: Record<string, import("eslint").Rule.RuleModule>;
};

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      ecmaFeatures: { jsx: true },
    },
  },
});

tester.run("no-error-message-in-ui", plugin.rules["no-error-message-in-ui"], {
  valid: [
    {
      code: '<Text>{error.code === "CONFLICT" ? "Already saved." : "Failed to add."}</Text>',
    },
    {
      code: "<Text>{notification.message}</Text>",
    },
    {
      code: 'toast.error("Something went wrong. Please try again.")',
    },
    {
      code: "<Widget helperText={error.message} />",
    },
  ],
  invalid: [
    {
      code: "<Text>{error.message}</Text>",
      errors: [{ messageId: "noErrorMessageInUi" }],
    },
    {
      code: "<Text>{err.message}</Text>",
      errors: [{ messageId: "noErrorMessageInUi" }],
    },
    {
      code: "<Text>{generateMutation.error.message}</Text>",
      errors: [{ messageId: "noErrorMessageInUi" }],
    },
    {
      code: [
        "AccessibilityInfo.announceForAccessibility(",
        '  error instanceof Error ? error.message : "Recipe generation failed"',
        ")",
      ].join("\n"),
      errors: [{ messageId: "noErrorMessageInUi" }],
    },
    {
      code: "<View>{uploadError.message}</View>",
      errors: [{ messageId: "noErrorMessageInUi" }],
    },
    {
      code: "setError(err.message)",
      errors: [{ messageId: "noErrorMessageInUi" }],
    },
    {
      code: "toast.error(err.message)",
      errors: [{ messageId: "noErrorMessageInUi" }],
    },
    {
      code: "toast.warning(uploadError.message)",
      errors: [{ messageId: "noErrorMessageInUi" }],
    },
    {
      code: "AccessibilityInfo.announceForAccessibility(error.message)",
      errors: [{ messageId: "noErrorMessageInUi" }],
    },
  ],
});

tester.run(
  "no-dead-apiRequest-guard",
  plugin.rules["no-dead-apiRequest-guard"],
  {
    valid: [
      {
        code: [
          "async function load() {",
          '  const res = await fetch("/api/items");',
          "  if (!res.ok) {",
          '    throw new Error("Request failed");',
          "  }",
          "}",
        ].join("\n"),
      },
      {
        code: [
          "async function load() {",
          '  const res = await apiRequest("GET", "/api/items");',
          "  if (res.data.length === 0) {",
          '    return "empty";',
          "  }",
          "}",
        ].join("\n"),
      },
      {
        code: [
          "async function load() {",
          '  const res = await fetch("/api/items");',
          "  const response = res;",
          "  if (!response.ok) {",
          '    throw new Error("Request failed");',
          "  }",
          "}",
        ].join("\n"),
      },
      // Known coverage gap: destructured `ok` binding. The guard is a bare Identifier
      // (`!ok`), not a MemberExpression (`!x.ok`), so getGuardedOkIdentifier returns
      // null and the visitor exits before scope resolution.
      {
        code: [
          "async function load() {",
          '  const { ok } = await apiRequest("GET", "/api/items");',
          "  if (!ok) {",
          '    throw new Error("Request failed");',
          "  }",
          "}",
        ].join("\n"),
      },
      // Known coverage gap: renamed import. isApiRequestAwait only matches the
      // callee name "apiRequest" literally, so an import alias (`apiRequest as
      // makeRequest`) is not recognised and the call is not flagged.
      {
        code: [
          'import { apiRequest as makeRequest } from "../lib/api";',
          "async function load() {",
          '  const res = await makeRequest("GET", "/api/items");',
          "  if (!res.ok) {",
          '    throw new Error("Request failed");',
          "  }",
          "}",
        ].join("\n"),
      },
    ],
    invalid: [
      {
        code: [
          "async function save(recipeId) {",
          '  const res = await apiRequest("POST", "/api/cookbooks/add", { recipeId });',
          "  if (!res.ok) {",
          '    throw new Error("Already in cookbook");',
          "  }",
          "}",
        ].join("\n"),
        errors: [{ messageId: "noDeadApiRequestGuard" }],
      },
      {
        code: [
          "async function save() {",
          '  const res = await apiRequest("GET", "/api/items");',
          "  if (res.ok === false) {",
          '    throw new Error("Request failed");',
          "  }",
          "}",
        ].join("\n"),
        errors: [{ messageId: "noDeadApiRequestGuard" }],
      },
      {
        code: [
          "async function save() {",
          "  let res;",
          '  res = await apiRequest("GET", "/api/items");',
          "  if (!res.ok) {",
          '    throw new Error("Request failed");',
          "  }",
          "}",
        ].join("\n"),
        errors: [{ messageId: "noDeadApiRequestGuard" }],
      },
      {
        code: [
          "async function save() {",
          '  const res = await apiRequest("GET", "/api/items");',
          "  const response = res;",
          "  if (!response.ok) {",
          '    throw new Error("Request failed");',
          "  }",
          "}",
        ].join("\n"),
        errors: [{ messageId: "noDeadApiRequestGuard" }],
      },
    ],
  },
);
