import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { ESLint, Linter, RuleTester } from "eslint";
import * as tsParser from "@typescript-eslint/parser";

/**
 * Real eslint passes an ABSOLUTE filename; RuleTester passes whatever you give
 * it, and every case here would otherwise pass a repo-relative one. That
 * difference is not cosmetic — it is the only input that exercises the
 * repo-root anchoring, and a mutation run proved the suite could not tell a
 * rooted `toRepoRelative` from an unrooted one until these cases existed.
 */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const abs = (p: string) => path.join(REPO_ROOT, p);

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
//
// EVERY case below imports the constructor it uses, and that is load-bearing,
// not boilerplate. The rule resolves `RouteProp` through its import BINDING and
// deliberately does not match the bare name, so a case with no import exercises
// nothing at all. An earlier revision of this suite omitted the imports; a
// mutation run (delete the rule's name-match fallback, re-run) showed 11 of the
// invalid cases were passing through that fallback rather than through scope
// resolution — i.e. asserting the match-the-characters behaviour the rule was
// written to replace. The fallback is now gone; these imports are what keeps
// the suite honest about which mechanism it proves.
const RP = 'import type { RouteProp } from "@react-navigation/native";';
const NSSP =
  'import type { NativeStackScreenProps } from "@react-navigation/native-stack";';
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
          RP,
          CANONICAL_IMPORT,
          'type ScreenRoute = RouteProp<RootStackParamList, "LabelAnalysis">;',
        ].join("\n"),
      },
      // The `@/types/navigation` barrel re-exports every ParamList and is the
      // documented convention home, so importing from it must not error.
      {
        code: [
          RP,
          'import type { MealPlanStackParamList } from "@/types/navigation";',
          'type R = RouteProp<MealPlanStackParamList, "RecipeCreate">;',
        ].join("\n"),
      },
      // Relative form, used inside client/navigation/ itself
      // (linking.ts, navigationRef.ts). The `filename` is load-bearing now:
      // a specifier is resolved against the importing file, so `./X` is
      // canonical here and NOT canonical from a screen directory.
      {
        filename: "client/navigation/linking.ts",
        code: [
          RP,
          'import type { RootStackParamList } from "./RootStackNavigator";',
          'type R = RouteProp<RootStackParamList, "Scan">;',
        ].join("\n"),
      },
      // A deep relative path that climbs back to the real navigator directory
      // is equally canonical — the test is where it LANDS, not how it is spelt.
      {
        filename: "client/screens/meal-plan/RecipeCreateScreen.tsx",
        code: [
          RP,
          'import type { MealPlanStackParamList } from "../../navigation/MealPlanStackNavigator";',
          'type R = RouteProp<MealPlanStackParamList, "RecipeCreate">;',
        ].join("\n"),
      },
      // BottomTabScreenProps takes a ParamList first and exposes
      // `route: RouteProp<P, K>`, so it is guarded like the stack variant.
      {
        filename: "client/screens/SomeTabScreen.tsx",
        code: [
          'import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";',
          'import type { MainTabParamList } from "@/navigation/MainTabNavigator";',
          'type Props = BottomTabScreenProps<MainTabParamList, "HomeTab">;',
        ].join("\n"),
      },
      // `CompositeScreenProps` must stay UNGUARDED: its first type argument is
      // another ScreenProps object, not a ParamList, so guarding it would
      // reject the correct composition below.
      {
        filename: "client/screens/SomeScreen.tsx",
        code: [
          NSSP,
          'import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";',
          'import type { CompositeScreenProps } from "@react-navigation/native";',
          CANONICAL_IMPORT,
          'import type { MainTabParamList } from "@/navigation/MainTabNavigator";',
          "type Props = CompositeScreenProps<",
          '  NativeStackScreenProps<RootStackParamList, "Scan">,',
          '  BottomTabScreenProps<MainTabParamList, "HomeTab">',
          ">;",
        ].join("\n"),
      },
      // ABSOLUTE filename — the shape real eslint actually passes. Without a
      // case like this the suite cannot distinguish a repo-root-anchored
      // resolution from an unanchored one, since every other filename here is
      // already repo-relative and `toRepoRelative` is an identity on those.
      {
        filename: abs("client/navigation/linking.ts"),
        code: [
          RP,
          'import type { RootStackParamList } from "./RootStackNavigator";',
          'type R = RouteProp<RootStackParamList, "Scan">;',
        ].join("\n"),
      },
      {
        filename: abs("client/navigation/RootStackNavigator.tsx"),
        code: [
          RP,
          "export type RootStackParamList = { Scan: { mode: string } };",
          'type R = RouteProp<RootStackParamList, "Scan">;',
        ].join("\n"),
      },
      // Negative control for the namespace branch's package check — the mirror
      // of the `./my-own-graph-helpers` control on the Identifier branch.
      // Without it, deleting `NAVIGATION_PACKAGE.test` from that branch killed
      // no test at all.
      {
        code: [
          'import * as Local from "./my-own-graph-helpers";',
          'type R = Local.RouteProp<{ Foo: { x: string } }, "Foo">;',
        ].join("\n"),
      },
      // …and for its member check: a @react-navigation namespace used with a
      // navigation-only constructor must stay out of scope (gap 3) through the
      // namespace path too.
      {
        code: [
          'import * as Nav from "@react-navigation/native";',
          "type LocalParams = { Foo: { x: string } };",
          "type N = Nav.NavigationProp<LocalParams>;",
        ].join("\n"),
      },
      // FavouriteRecipesScreen is registered in two navigators; its
      // ...NavigationProp already uses this intersection shape, so the route
      // side must be allowed to as well. Every member is canonical.
      {
        code: [
          RP,
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
          RP,
          'import type { RootStackParamList as RSP } from "@/navigation/RootStackNavigator";',
          'type R = RouteProp<RSP, "Scan">;',
        ].join("\n"),
      },
      // A namespace-imported ParamList is judged by the namespace's own binding.
      {
        code: [
          RP,
          'import * as Nav from "@/navigation/RootStackNavigator";',
          'type R = RouteProp<Nav.RootStackParamList, "Scan">;',
        ].join("\n"),
      },
      // A navigator declaring its own ParamList locally is the SOURCE of truth,
      // not a shadow. Discriminated by filename, not by `export` — `export`
      // cannot tell a navigator's declaration from a screen's (residual 2).
      // Note the `RP` import: without it the constructor is unrecognised and
      // this case would pass even if the rule did nothing whatsoever.
      {
        filename: "client/navigation/RootStackNavigator.tsx",
        code: [
          RP,
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
          RP,
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
          NSSP,
          CANONICAL_IMPORT,
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
      // Same point with no import at all: an unbound name is NOT guarded. This
      // pins the removal of the old name-match fallback, which flagged this
      // exact snippet and told the author to "import the ParamList from its
      // navigator" — advice about a library the file never mentions.
      {
        code: [
          "type RouteProp<P, K extends keyof P> = { params: P[K] };",
          'type R = RouteProp<{ Foo: { x: string } }, "Foo">;',
        ].join("\n"),
      },
    ],
    invalid: [
      // ── RESIDUAL 3 — the reason this rule exists ──────────────────────────
      // A shadow extracted to a shared module ("let's not repeat this type")
      // and imported back in. `scripts/check-route-params.js` could not see
      // this: the declaration is in another file. The rule sees it because it
      // asks where the identifier is BOUND, not what the text near it looks
      // like — and the import statement is right here.
      {
        code: [
          RP,
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
          RP,
          'import type { ScreenParams } from "@/navigation/routeShapes";',
          'type R = RouteProp<ScreenParams, "Scan">;',
        ].join("\n"),
        errors: [
          {
            messageId: "shadowedParamList",
            data: {
              constructor: "RouteProp",
              detail:
                '`ScreenParams`, imported from "@/navigation/routeShapes"',
            },
          },
        ],
      },
      // ── The allowlist tests LOCATION, not spelling ────────────────────────
      // "Extract the shadow to a shared file" is the mutation residual 3 is
      // named after, and an earlier revision of this rule accepted it whenever
      // the extracted file happened to be called `*Navigator` — because the
      // allowlist pattern-matched the specifier TEXT with nothing anchoring it
      // to where the module actually lives. All three cases below passed
      // silently then; the first was reproduced against the real tree.
      {
        filename: "client/screens/EvilScreen.tsx",
        code: [
          RP,
          'import type { EvilParams } from "./FakeNavigator";',
          'type R = RouteProp<EvilParams, "Foo">;',
        ].join("\n"),
        errors: [
          {
            messageId: "shadowedParamList",
            data: {
              constructor: "RouteProp",
              detail: '`EvilParams`, imported from "./FakeNavigator"',
            },
          },
        ],
      },
      {
        filename: "client/screens/EvilScreen.tsx",
        code: [
          RP,
          'import type { EvilParams } from "@/screens/nested/navigation/EvilNavigator";',
          'type R = RouteProp<EvilParams, "Foo">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      // The two cases the FIRST location fix still let through, because its
      // pattern was `(?:^|\/)client\/navigation\/…` — matching wherever a slash
      // precedes — against a path never anchored to the repo root. Both were
      // reproduced against the real eslint CLI with real planted files before
      // being fixed; the case just above does NOT cover them, since it lacks
      // the doubled `client/` segment that exploits the boundary tolerance.
      {
        filename: "client/screens/EvilScreen.tsx",
        code: [
          RP,
          'import type { EvilParams } from "@/screens/vendor/client/navigation/EvilNavigator";',
          'type R = RouteProp<EvilParams, "Foo">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      // …and a specifier that climbs clean out of the repository.
      {
        filename: "client/screens/EvilScreen.tsx",
        code: [
          RP,
          'import type { EvilParams } from "../../../../evil-sibling/client/navigation/FooNavigator";',
          'type R = RouteProp<EvilParams, "Foo">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      // The file-side half of the allowlist needs the same anchoring: a real
      // file at this path must not be trusted to declare its own ParamList.
      {
        filename: "client/screens/vendor/client/navigation/FooNavigator.tsx",
        code: [
          RP,
          "export type RootStackParamList = { Scan: { mode: string } };",
          'type R = RouteProp<RootStackParamList, "Scan">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      // …and at the absolute path shape real eslint passes, for consistency
      // with the accept-direction rows.
      //
      // This row adds NO detection power, and saying otherwise would be the
      // mistake this whole rule keeps making. A reject-direction case is
      // insensitive to rooting: an unrooted path fails the start-anchored
      // pattern just as a correctly-rooted foreign one does, so "still
      // rejected" is the answer either way. Verified — reducing
      // `toRepoRelative` to a passthrough leaves both this row and its relative
      // sibling green. Rooting for the FILE-side check is pinned by the
      // accept-direction case above, `abs("client/navigation/RootStackNavigator.tsx")`,
      // which is what actually turns red.
      {
        filename: abs(
          "client/screens/vendor/client/navigation/FooNavigator.tsx",
        ),
        code: [
          RP,
          "export type RootStackParamList = { Scan: { mode: string } };",
          'type R = RouteProp<RootStackParamList, "Scan">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      // The types-barrel half is spoofable the same way, and was only ever
      // checked by a tail match until a mutation run showed nothing covered it.
      {
        filename: "client/screens/EvilScreen.tsx",
        code: [
          RP,
          'import type { EvilParams } from "@/screens/vendor/client/types/navigation";',
          'type R = RouteProp<EvilParams, "Foo">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      // A BARE package specifier is never canonical, even when spelled exactly
      // like the real navigator path — nothing resolves it into this repo.
      {
        filename: "client/screens/EvilScreen.tsx",
        code: [
          RP,
          'import type { EvilParams } from "client/navigation/RootStackNavigator";',
          'type R = RouteProp<EvilParams, "Foo">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      // Absolute-filename counterpart of the sibling-shadow case, so the
      // rejecting direction is exercised under real-eslint path shapes too.
      {
        filename: abs("client/screens/EvilScreen.tsx"),
        code: [
          RP,
          'import type { EvilParams } from "./FakeNavigator";',
          'type R = RouteProp<EvilParams, "Foo">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      // A bare package specifier can never be canonical, however it is named.
      {
        filename: "client/screens/EvilScreen.tsx",
        code: [
          RP,
          'import type { EvilParams } from "some-pkg/navigation/EvilNavigator";',
          'type R = RouteProp<EvilParams, "Foo">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      // ── Form 1 — the inline object literal (PR #742's actual defect) ──────
      {
        code: [
          RP,
          'const route = useRoute<RouteProp<{ params: RouteParams }, "params">>();',
        ].join("\n"),
        errors: [
          {
            messageId: "shadowedParamList",
            data: {
              constructor: "RouteProp",
              detail: "an inline object literal",
            },
          },
        ],
      },
      // Prettier owns formatting here and may commit the construct already
      // wrapped — ItemDetailScreen was. An AST rule is indifferent to where
      // the line breaks fall, which is the whole point of leaving text behind.
      {
        code: [
          RP,
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
          RP,
          "type LocalParams = {",
          "  LabelAnalysis: { imageUri: string };",
          "};",
          'type ScreenRoute = RouteProp<LocalParams, "LabelAnalysis">;',
        ].join("\n"),
        errors: [
          {
            messageId: "shadowedParamList",
            data: {
              constructor: "RouteProp",
              detail: "the locally declared type `LocalParams`",
            },
          },
        ],
      },
      {
        code: [
          RP,
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
          RP,
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
          RP,
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
          RP,
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
        code: [
          RP,
          'type R = RouteProp<Readonly<{ Foo: { x: string } }>, "Foo">;',
        ].join("\n"),
        errors: [
          {
            messageId: "shadowedParamList",
            data: {
              constructor: "RouteProp",
              detail: "`Readonly`, which resolves to no import in this file",
            },
          },
        ],
      },
      // ── RESIDUAL 4 — a same-line comment defeated the line anchor ─────────
      {
        code: [
          RP,
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
        // `constructor` is the EXPORTED name, not the local alias — the
        // diagnostic should name the thing the reader can look up.
        errors: [
          {
            messageId: "shadowedParamList",
            data: {
              constructor: "RouteProp",
              detail: "the locally declared type `LocalParams`",
            },
          },
        ],
      },
      // …and reached through a namespace import, which `shadowDetail` already
      // handled on the ParamList side. Without the matching walk in
      // guardedConstructor the rule judged the argument but not the
      // constructor, and this went unreported.
      {
        code: [
          'import * as Nav from "@react-navigation/native";',
          "type LocalParams = { Foo: { x: string } };",
          'type R = Nav.RouteProp<LocalParams, "Foo">;',
        ].join("\n"),
        // `constructor` must be the MEMBER name, not the namespace binding's
        // local name — reporting "`Nav`'s ParamList argument is…" is a broken
        // diagnostic, and a messageId-only assertion here let that mutant live.
        errors: [
          {
            messageId: "shadowedParamList",
            data: {
              constructor: "RouteProp",
              detail: "the locally declared type `LocalParams`",
            },
          },
        ],
      },
      // The tab variant of the props constructor — same first-argument shape,
      // same silent param drop.
      {
        code: [
          'import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";',
          "type LocalParams = { HomeTab: { filter: string } };",
          'type Props = BottomTabScreenProps<LocalParams, "HomeTab">;',
        ].join("\n"),
        errors: [
          {
            messageId: "shadowedParamList",
            data: {
              constructor: "BottomTabScreenProps",
              detail: "the locally declared type `LocalParams`",
            },
          },
        ],
      },
      // Same defect through the props-object constructor.
      {
        code: [
          NSSP,
          "type LocalParams = { VerifyEmail: { token: string } };",
          'type Props = NativeStackScreenProps<LocalParams, "VerifyEmail">;',
        ].join("\n"),
        errors: [{ messageId: "shadowedParamList" }],
      },
      // An intersection is only as canonical as its weakest member.
      {
        code: [
          RP,
          'import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";',
          "type LocalParams = { FavouriteRecipes: { id: number } };",
          'type R = RouteProp<MealPlanStackParamList & LocalParams, "FavouriteRecipes">;',
        ].join("\n"),
        errors: [
          {
            messageId: "shadowedParamList",
            data: {
              constructor: "RouteProp",
              detail: "the locally declared type `LocalParams`",
            },
          },
        ],
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

// ─── Specifier resolution, enumerated ──────────────────────────────────────
//
// Four separate defects in this rule's history were all one mistake: a check
// that CORRELATED with "does this ParamList live in a navigator module" instead
// of testing it. Each was fixed by sampling — someone thought of one bad input,
// added one case. The fix for the third contained the fourth.
//
// This table exists to stop sampling. It enumerates the specifier/filename
// space in one place — alias and relative forms, absolute and repo-relative
// filenames, and every spoof shape found so far — so that a future change to
// `resolveSpecifier`/`toRepoRelative` has to satisfy the whole space at once
// rather than the one example its author happened to picture.
//
// Add a row here before changing either function. A row is cheaper than a round.
describe("no-shadowed-route-paramlist — specifier resolution", () => {
  const linter = new Linter();

  /** Lint one import shape and report whether the ParamList was accepted. */
  const accepts = (specifier: string, filename: string): boolean => {
    const code = [
      'import type { RouteProp } from "@react-navigation/native";',
      `import type { P } from "${specifier}";`,
      'type R = RouteProp<P, "Foo">;',
    ].join("\n");
    const messages = linter.verify(
      code,
      [
        {
          files: ["**/*.{ts,tsx}"],
          languageOptions: {
            parser: tsParser,
            parserOptions: { ecmaVersion: "latest", sourceType: "module" },
          },
          plugins: { ocrecipes: plugin },
          rules: { "ocrecipes/no-shadowed-route-paramlist": "error" },
        },
      ],
      filename,
    );
    // A config that matches nothing yields a message with a null ruleId and
    // would otherwise read as "accepted" — the harness lying rather than the
    // rule passing. Fail loudly instead.
    const unmatched = messages.find((m: Linter.LintMessage) => !m.ruleId);
    if (unmatched)
      throw new Error(`harness misconfigured: ${unmatched.message}`);
    return messages.length === 0;
  };

  const SCREEN = "client/screens/EvilScreen.tsx";
  const NESTED_SCREEN = "client/screens/meal-plan/RecipeCreateScreen.tsx";
  const NAV = "client/navigation/linking.ts";

  const CANONICAL: [string, string, string][] = [
    ["alias to a navigator", "@/navigation/RootStackNavigator", SCREEN],
    ["alias to the types barrel", "@/types/navigation", SCREEN],
    ["relative, inside navigation/", "./RootStackNavigator", NAV],
    [
      "relative, climbing back to navigation/",
      "../../navigation/MealPlanStackNavigator",
      NESTED_SCREEN,
    ],
    [
      "absolute filename, alias",
      "@/navigation/RootStackNavigator",
      abs(SCREEN),
    ],
    ["absolute filename, relative specifier", "./RootStackNavigator", abs(NAV)],
  ];

  const SHADOWS: [string, string, string][] = [
    ["sibling file named like a navigator", "./FakeNavigator", SCREEN],
    [
      "nested client/navigation segment (alias)",
      "@/screens/vendor/client/navigation/EvilNavigator",
      SCREEN,
    ],
    [
      "nested client/navigation segment (relative)",
      "./vendor/client/navigation/EvilNavigator",
      SCREEN,
    ],
    [
      "nested client/types/navigation segment",
      "@/screens/vendor/client/types/navigation",
      SCREEN,
    ],
    [
      "climbs out of the repository",
      "../../../../evil-sibling/client/navigation/FooNavigator",
      SCREEN,
    ],
    [
      "bare package spelled like the navigator path",
      "client/navigation/RootStackNavigator",
      SCREEN,
    ],
    [
      "bare package, navigator-ish tail",
      "some-pkg/navigation/XNavigator",
      SCREEN,
    ],
    [
      "extra segment under navigation/",
      "@/navigation/sub/RootStackNavigator",
      SCREEN,
    ],
    ["a screen, not a navigator", "@/screens/SomeScreen", SCREEN],
    ["the shared workspace", "@shared/schema", SCREEN],
    // Landing on the types BARREL's directory is not landing on the barrel.
    ["the types directory itself", "@/types", SCREEN],
    // The table's other rows vary the SPECIFIER against a screen filename;
    // these two vary the FILENAME to a canonical one while keeping a shadow
    // specifier — the axis nothing else crosses.
    //
    // Being a navigator buys a file the right to declare its OWN ParamList,
    // nothing more: importing someone else's restatement is still a shadow.
    // The distinction is that `selfIsCanonical` gates only the
    // local-declaration branch of `shadowDetail`, never the import branch. That
    // holds today, but nothing pinned it, and the regression it invites is this
    // rule's exact recurring shape — a plausible "navigators can't shadow
    // themselves" simplification that short-circuits on `selfIsCanonical` would
    // turn all seven navigator modules into laundering paths with no red test.
    [
      "shadow specifier imported BY a navigator file",
      "./route-types",
      "client/navigation/RootStackNavigator.tsx",
    ],
    [
      "…same, at real-eslint absolute path shape",
      "./route-types",
      abs("client/navigation/RootStackNavigator.tsx"),
    ],
  ];

  it.each(CANONICAL)("accepts %s", (_label, specifier, filename) => {
    expect(accepts(specifier, filename)).toBe(true);
  });

  it.each(SHADOWS)("rejects %s", (_label, specifier, filename) => {
    expect(accepts(specifier, filename)).toBe(false);
  });
});

// ─── The rules are actually WIRED ──────────────────────────────────────────
//
// RuleTester proves a rule's logic and nothing about whether the repo runs it.
// A rule enabled under a `files:` glob that stops matching is unenforced and
// silent — CI stays green because zero files were ever checked. That is the
// same defect as a sweep that scans zero inputs
// (docs/solutions/code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md).
//
// The scanner this replaced guarded that property itself, by hard-failing a
// whole-tree run that matched no files. Deleting it would have dropped the
// property, so it moves here — and lands more precisely, since it pins the
// GLOB rather than a file count that a shrinking tree could satisfy.
describe("eslint.config.js wiring", () => {
  const resolveRule = async (filePath: string) => {
    const config = await new ESLint({}).calculateConfigForFile(filePath);
    return config.rules?.["ocrecipes/no-shadowed-route-paramlist"] ?? null;
  };

  it("enables no-shadowed-route-paramlist as an error for client sources", async () => {
    // Screens are the defect's home, but the rule is registered for all of
    // client/ — client/hooks/useHistoryData.ts also takes a RouteProp.
    expect(await resolveRule("client/screens/ScanScreen.tsx")).toEqual([2]);
    expect(await resolveRule("client/hooks/useHistoryData.ts")).toEqual([2]);
  });

  it("leaves server sources alone", async () => {
    // The negative side matters: a config edit that widened the glob to the
    // whole repo would still pass the assertion above.
    expect(await resolveRule("server/index.ts")).toBeNull();
  });
});
