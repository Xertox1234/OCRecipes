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

// ─── no-shadowed-route-paramlist ───────────────────────────────────────────
//
// The rule this suite pins replaced `scripts/check-route-params.js`, a
// single-file TEXT scanner whose documented residuals are all exercised below.
// The key one is `cross-module` — a shadow declared elsewhere and imported. A
// text scanner cannot reach it; scope analysis can, because the *import
// statement* is in the same file even though the *declaration* is not.
//
// A canonical ParamList is one bound to an import from a navigator module
// (`@/navigation/<X>Navigator`, `./<X>Navigator`) or the `@/types/navigation`
// re-export barrel. Anything else — inline literal, local alias, foreign
// import, unresolved global — is a shadow.
const CANONICAL_IMPORT =
  'import type { RootStackParamList } from "@/navigation/RootStackNavigator";';

tester.run(
  "no-shadowed-route-paramlist",
  plugin.rules["no-shadowed-route-paramlist"],
  {
    valid: [
      // The shape every screen actually uses today.
      {
        code: [
          CANONICAL_IMPORT,
          'type ScreenRoute = RouteProp<RootStackParamList, "LabelAnalysis">;',
        ].join("\n"),
      },
      // The `@/types/navigation` barrel re-exports every ParamList and is the
      // documented convention home, so importing from it must not error.
      {
        code: [
          'import type { MealPlanStackParamList } from "@/types/navigation";',
          'type R = RouteProp<MealPlanStackParamList, "RecipeCreate">;',
        ].join("\n"),
      },
      // Relative form, used inside client/navigation/ itself
      // (linking.ts, navigationRef.ts).
      {
        code: [
          'import type { RootStackParamList } from "./RootStackNavigator";',
          'type R = RouteProp<RootStackParamList, "Scan">;',
        ].join("\n"),
      },
      // FavouriteRecipesScreen is registered in two navigators; its
      // ...NavigationProp already uses this intersection shape, so the route
      // side must be allowed to as well. Every member is canonical.
      {
        code: [
          'import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";',
          'import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";',
          "type R = RouteProp<",
          "  MealPlanStackParamList & ProfileStackParamList,",
          '  "FavouriteRecipes"',
          ">;",
        ].join("\n"),
      },
      // Renaming the canonical import does not make it non-canonical — the
      // binding still resolves to a navigator module.
      {
        code: [
          'import type { RootStackParamList as RSP } from "@/navigation/RootStackNavigator";',
          'type R = RouteProp<RSP, "Scan">;',
        ].join("\n"),
      },
      // A navigator declaring its own ParamList locally is the SOURCE of truth,
      // not a shadow. Discriminated by filename, not by `export` — `export`
      // cannot tell a navigator's declaration from a screen's (residual 2).
      {
        filename: "client/navigation/RootStackNavigator.tsx",
        code: [
          "export type RootStackParamList = {",
          "  Scan: { mode: string };",
          "};",
          'type R = RouteProp<RootStackParamList, "Scan">;',
        ].join("\n"),
      },
      // A `RouteParams` alias DERIVED from the canonical list is exactly what
      // the convention asks for. The rule is structural, never nominal.
      {
        code: [
          CANONICAL_IMPORT,
          'type RouteParams = RootStackParamList["LabelAnalysis"];',
          'type R = RouteProp<RootStackParamList, "LabelAnalysis">;',
        ].join("\n"),
      },
      {
        code: "export function Foo() { return null; }",
      },
      // NativeStackScreenProps takes a ParamList in the same first-argument
      // position and leaks route params through `props.route.params`, so it is
      // the same defect surface. VerifyEmailScreen/CoachChatScreen use this.
      {
        code: [
          CANONICAL_IMPORT,
          'import type { NativeStackScreenProps } from "@react-navigation/native-stack";',
          'type Props = NativeStackScreenProps<RootStackParamList, "VerifyEmail">;',
        ].join("\n"),
      },
      // Precision: a `RouteProp` that is not react-navigation's is not this
      // rule's business, however suspicious its type argument looks.
      {
        code: [
          'import type { RouteProp } from "./my-own-graph-helpers";',
          "type R = RouteProp<{ a: 1 }, 2>;",
        ].join("\n"),
      },
    ],
    invalid: [
      // ── RESIDUAL 3 — the reason this rule exists ──────────────────────────
      // A shadow extracted to a shared module ("let's not repeat this type")
      // and imported back in. `scripts/check-route-params.js` could not see
      // this in principle: the declaration is in another file. The rule sees
      // it because it asks where the identifier is BOUND, not what the text
      // near it looks like.
      {
        code: [
          'import type { RouteProp } from "@react-navigation/native";',
          'import type { ScreenParams } from "./route-types";',
          'type R = RouteProp<ScreenParams, "LabelAnalysis">;',
        ].join("\n"),
        // Assert the DATA, not just the messageId: the diagnostic has to name
        // the offending module, or a reader who has never seen this defect
        // cannot tell what "canonical" means. A messageId-only assertion would
        // still pass if the detail collapsed to a generic string.
        errors: [
          {
            messageId: "shadowedParamList",
            data: {
              constructor: "RouteProp",
              detail: '`ScreenParams`, imported from "./route-types"',
            },
          },
        ],
      },
      // A module under client/navigation/ that is not a navigator is not a
      // source of truth either — the allowlist is the `…Navigator` modules and
      // the types barrel, not the folder.
      {
        code: [
          'import type { ScreenParams } from "@/navigation/routeShapes";',
          'type R = RouteProp<ScreenParams, "Scan">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      // ── Form 1 — the inline object literal (PR #742's actual defect) ──────
      {
        code: 'const route = useRoute<RouteProp<{ params: RouteParams }, "params">>();',
        errors: [{ messageId: "shadowedParamList" }],
      },
      // Prettier owns formatting here and may commit the construct already
      // wrapped — ItemDetailScreen was. An AST rule is indifferent to where
      // the line breaks fall, which is the whole point of leaving text behind.
      {
        code: [
          "const route = useRoute<",
          "  RouteProp<",
          "    { params: SomeLongerAliasNameForRouteParams },",
          '    "params"',
          "  >",
          ">();",
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      // ── Form 2 — extract-variable refactor of form 1 ──────────────────────
      {
        code: [
          "type LocalParams = {",
          "  LabelAnalysis: { imageUri: string };",
          "};",
          'type ScreenRoute = RouteProp<LocalParams, "LabelAnalysis">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      {
        code: [
          "declare type LocalParams = {",
          "  LabelAnalysis: { imageUri: string };",
          "};",
          'type ScreenRoute = RouteProp<LocalParams, "LabelAnalysis">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      // ── RESIDUAL 2 — an EXPORTED alias inside a screen ────────────────────
      // The text scanner excused every `export`ed alias, because that was its
      // only way to avoid flagging navigators' own declarations. Here the
      // navigator carve-out is by filename, so `export` buys a screen nothing.
      {
        filename: "client/screens/LabelAnalysisScreen.tsx",
        code: [
          "export type RootStackParamList = {",
          "  LabelAnalysis: { imageUri: string };",
          "};",
          'type R = RouteProp<RootStackParamList, "LabelAnalysis">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      // ── RESIDUAL 1a — a type-parameter list breaks `type <Name> = {` ──────
      // Evades the text scanner even when the parameter is unused and the RHS
      // is a plain object literal, because the cause was the adjacency.
      {
        code: [
          "type LocalParams<Unused = void> = {",
          "  LabelAnalysis: { imageUri: string };",
          "};",
          'type R = RouteProp<LocalParams, "LabelAnalysis">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      // ── RESIDUAL 1b — a non-object-literal RHS ────────────────────────────
      {
        code: [
          "type LocalParams = Readonly<{",
          "  LabelAnalysis: { imageUri: string };",
          "}>;",
          'type R = RouteProp<LocalParams, "LabelAnalysis">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      // …and the same wrapper applied inline, where the ParamList argument
      // resolves to no binding at all (`Readonly` is a global).
      {
        code: 'type R = RouteProp<Readonly<{ Foo: { x: string } }>, "Foo">;',
        errors: [{ messageId: "shadowedParamList" }],
      },
      // ── RESIDUAL 4 — a same-line comment defeated the line anchor ─────────
      {
        code: [
          "/* keep in sync */ type LocalParams = { Foo: { x: string } };",
          'type R = RouteProp<LocalParams, "Foo">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      // The constructor itself may be renamed on import. Resolving the binding
      // rather than matching the spelling is what closes this; the sibling
      // no-dead-apiRequest-guard rule documents the same gap left OPEN, so the
      // difference is deliberate.
      {
        code: [
          'import type { RouteProp as RP } from "@react-navigation/native";',
          "type LocalParams = { Foo: { x: string } };",
          'type R = RP<LocalParams, "Foo">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      // Same defect through the props-object constructor.
      {
        code: [
          'import type { NativeStackScreenProps } from "@react-navigation/native-stack";',
          "type LocalParams = { VerifyEmail: { token: string } };",
          'type Props = NativeStackScreenProps<LocalParams, "VerifyEmail">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      // An intersection is only as canonical as its weakest member.
      {
        code: [
          'import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";',
          "type LocalParams = { FavouriteRecipes: { id: number } };",
          'type R = RouteProp<MealPlanStackParamList & LocalParams, "FavouriteRecipes">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
    ],
  },
);

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
