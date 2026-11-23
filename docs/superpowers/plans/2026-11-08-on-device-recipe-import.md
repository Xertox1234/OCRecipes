# On-device Recipe Import Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the server can't import a recipe URL, the phone loads the page in a hidden WebView, extracts its JSON-LD and the server validates it; if that fails too, the user can sign in in a visible in-app browser and import from there.

**Architecture:** Server gains `POST /api/meal-plan/recipes/parse-page`, which runs the same JSON-LD → `ImportedRecipeData` pipeline `parse-url` uses (extracted into one shared function). The client adds `react-native-webview` with one locked-down import configuration, used hidden (automatic fallback inside `RecipeImportScreen`) and visible (new `RecipeImportBrowser` screen). A tiny local Expo module clears the WebView's cookie/storage, called from `clearDurableLocalState`.

**Tech Stack:** Express + Zod (server), Expo SDK 58 / React Native, `react-native-webview`, local Expo module (Swift/Kotlin), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-08-on-device-recipe-import-design.md`

## Global Constraints

- New native dependency → ships in a **new native build** (iOS + Android); never by OTA alone. Expo CNG: never hand-edit `ios/` or `android/`.
- Server never fetches on the `parse-page` path. Server fetch user-agent stays unchanged.
- Device WebView user-agent: **default, unchanged.** Task 1 (2026-11-08) passed on iOS 26.6.2 and Android 17 with the default UA (owner's ruling allowing an adjustment stays on file but wasn't needed).
- `parse-page` limits: `ldJson` ≤ **20** strings, total ≤ **1,000,000** bytes (UTF-8); `url` reuses `importUrlSchema` rules (http/https, ≤ 1024 chars).
- `parse-page` gets its own limiter `pageImportRateLimit` (60 s window, max 5, same message as `urlImportRateLimit`).
- Same error codes/messages and post-processing as `parse-url` (no-ingredients-and-no-instructions 422, `normalizeRecipeFields`).
- Device fallback triggers only on `ApiError.code` ∈ {`FETCH_FAILED`, `NO_RECIPE_DATA`, `TIMEOUT`, `PARSE_ERROR`}; never on 400 validation, `RATE_LIMITED`, `RESPONSE_TOO_LARGE`, or network/auth errors.
- Hidden extraction timeout: **15,000 ms**.
- WebView: only `http:`/`https:` navigation; no new windows (`setSupportMultipleWindows={false}`), no file access, no downloads; third-party cookies off (`thirdPartyCookiesEnabled={false}`); one shared persistent store for hidden and visible.
- The bridge accepts one message shape: `{ type: "ldjson", blocks: string[] }`, capped as above on receipt.
- `sourceUrl` = the page the recipe was extracted from (WebView's current URL), not the pasted link.
- Sheet copy (exact): title "We couldn't read this recipe", body "The site may need you to sign in. Open it here, sign in, and we'll import it.", buttons "Open site and sign in" / "Use a photo or paste instead".
- Recipe-found bar copy: "✓ Recipe found" + action "Import". Manual control label: "Import".
- Site data wiped in `clearDurableLocalState` (covers logout, session expiry, account deletion); a failed wipe sets `ok = false` like the other steps.
- Styling within `client/constants/theme.ts` only (owner ruling: keep current design).
- Strict TDD: failing test first. Pure logic lives in `*-utils.ts` files Vitest can cover.

## Review Focus

1. **A site that redirects** (http→https, short links, `amp` → canonical): hidden mode must follow and send the _final_ URL as `url`. → test in Task 4 (`resolveImportedUrl`).
2. **A page with several JSON-LD blocks, some invalid JSON or non-Recipe** (`@graph`, `BreadcrumbList`, broken block): one bad block must not hide the recipe. → test in Task 2.
3. **The user leaves the screen while the hidden fallback runs**: no navigation to `RecipeCreate` from an unmounted screen, no stuck spinner on return. → test in Task 5.
4. **A hostile page posting junk or oversized messages** (wrong `type`, non-string blocks, 21 blocks, 2 MB): ignored on the device, rejected by the server. → tests in Task 3 (server) and Task 4 (`parseExtractorMessage`).
5. **Tapping Import on a sign-in page or a page with no recipe**: tell the user and keep browsing; never call the server with zero blocks. → test in Task 6.

---

### Task 1: Go/no-go spike — do People Inc. sites let a device WebView through? ✅ DONE 2026-11-08 — GO

Result (default UA, JSON-LD read, no block page): iPhone 16 Pro Max / iOS 26.6.2 and Galaxy SM-A376B / Android 17 (WebView Chrome 156, UA includes `; wv`) — Allrecipes 11 ingredients, Serious Eats 11, Simply Recipes 16, on both. Spike branch `spike/webview-people-inc` (worktree on U34Bolt) — never merge. Side finding folded into Task 4: without a navigation handler the WebView handed an iframe's `about:srcdoc` to `Linking.openURL`.

Throwaway. Branch `spike/webview-people-inc`, **never merged**. No tests.

**Files:** temporary only (a dev-only screen reachable by deep link, e.g. `ocrecipes://spike-webview`).

- [ ] **Step 1:** On the spike branch, `npx expo install react-native-webview`; add a dev-only screen that loads a URL in a `WebView` and injects the extractor (count JSON-LD blocks, find `@type` Recipe, post `{found, ingredients}`), showing the result on screen.
- [ ] **Step 2:** Build dev clients for iOS and Android (`npx expo run:ios --device`, Android dev build per `reference_android_build_on_u34bolt`).
- [ ] **Step 3:** On the owner's iPhone and Android phone, load each and record found/ingredient count:
  - `https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/`
  - `https://www.seriouseats.com/the-food-lab-best-chocolate-chip-cookie-recipe`
  - one Simply Recipes recipe URL from its homepage
- [ ] **Step 4:** If any platform is blocked (402 page / no Recipe), retry with an adjusted `userAgent` (Android: default UA with the `; wv` token removed; iOS: append `Version/<major> Mobile/15E148 Safari/604.1` to the default). Record which UA passed.
- [ ] **Step 5: Decision.** Write the results table into the spec under "Open risks" (commit on the feature branch, not the spike). **Pass** (both platforms pass with default or adjusted UA) → continue; record the UA rule for Task 4. **Fail** on a platform → stop and report to the owner before Task 2.

---

### Task 2: Server — shared JSON-LD → recipe function

**Files:**

- Modify: `server/services/recipe-import.ts` (split `importRecipeFromUrl` at the cheerio step, ~line 488)
- Test: `server/services/__tests__/recipe-import.test.ts`

**Interfaces:**

- Produces: `export function parseRecipeFromLdJson(blocks: string[], sourceUrl: string): ImportResult` — `JSON.parse` each block (skip invalid), `findRecipeInLdJson`, `schemaOrgRecipeSchema.safeParse`, map to `ImportedRecipeData` exactly as today. Returns `NO_RECIPE_DATA` / `PARSE_ERROR` as today.
- `importRecipeFromUrl` keeps its signature; after fetching it collects the `script[type="application/ld+json"]` texts with cheerio and returns `parseRecipeFromLdJson(texts, url)`.

- [ ] **Step 1: Write failing tests** in a new `describe("parseRecipeFromLdJson")`:
  - `returns the recipe from the first block containing one` — blocks `['{"@type":"BreadcrumbList"}', '{"@graph":[{"@type":"Recipe","name":"Pie","recipeIngredient":["1 egg"]}]}']` → `success: true`, `data.title === "Pie"`, `data.ingredients.length === 1`, `data.sourceUrl === "https://x.test/pie"`.
  - `skips invalid JSON blocks` — `['{not json', <valid recipe block>]` → `success: true`.
  - `returns NO_RECIPE_DATA when no block has a Recipe` — `['{"@type":"Article"}']`.
  - `returns NO_RECIPE_DATA for an empty array`.
  - `returns PARSE_ERROR when the Recipe fails the schema` — reuse a fixture the existing PARSE_ERROR test uses.
- [ ] **Step 2:** `npx vitest run server/services/__tests__/recipe-import.test.ts` → new tests FAIL (`parseRecipeFromLdJson is not a function`).
- [ ] **Step 3:** Implement `parseRecipeFromLdJson` and make `importRecipeFromUrl` call it.
- [ ] **Step 4:** Same command → all tests in the file PASS (existing `importRecipeFromUrl` tests unchanged).
- [ ] **Step 5:** Commit `refactor(recipe-import): shared parseRecipeFromLdJson for URL and on-device import`.

---

### Task 3: Server — `POST /api/meal-plan/recipes/parse-page`

**Files:**

- Modify: `shared/schemas/recipe.ts` (add `parsePageSchema`)
- Modify: `server/routes/_rate-limiters.ts` (add `pageImportRateLimit` next to `urlImportRateLimit`, line ~417)
- Modify: `server/routes/recipe-import.ts` (extract the parse-url success/failure tail into a local helper; add the route)
- Test: `server/routes/__tests__/recipe-import.test.ts`, `shared/schemas/__tests__/` (existing location for recipe schema tests if present; else alongside route tests)

**Interfaces:**

- Consumes: `parseRecipeFromLdJson` (Task 2).
- Produces: `parsePageSchema = z.object({ url: <importUrlSchema.shape.url>, ldJson: z.array(z.string()).min(1).max(20) }).refine(total UTF-8 bytes ≤ 1_000_000)`; type `ParsePageParams`. Route returns the same 200 `ImportedRecipeData` body / 422 error shape as `parse-url`.
- Local helper in the route file: `function sendParsedImport(res: Response, result: ImportResult): void` used by both `parse-url` and `parse-page`.

- [ ] **Step 1: Write failing route tests** in `describe("POST /api/meal-plan/recipes/parse-page")`, mirroring the parse-url block's setup (mocked auth, mocked service):
  - `returns 400 when ldJson is missing`, `returns 400 when ldJson is empty`, `returns 400 with 21 blocks`, `returns 400 when total ldJson exceeds 1,000,000 bytes`, `returns 400 for an ftp:// url`, `returns 400 when a block is not a string`.
  - `returns 200 with parsed data and does not persist` — mock `parseRecipeFromLdJson` success; assert storage create not called; assert it was called with `(body.ldJson, body.url)`.
  - `returns 422 NO_RECIPE_DATA when no recipe found` — same message as parse-url.
  - `returns 422 when recipe has neither ingredients nor instructions`.
  - `never fetches` — assert `importRecipeFromUrl` mock not called.
  - `does NOT require premium`.
- [ ] **Step 2:** `npx vitest run server/routes/__tests__/recipe-import.test.ts` → new tests FAIL (404).
- [ ] **Step 3:** Add schema, limiter, helper and route (`requireAuth`, `pageImportRateLimit`, `handleRouteError(res, error, "parse recipe from page")` in catch).
- [ ] **Step 4:** Same command → PASS, including the unchanged parse-url tests.
- [ ] **Step 5:** Commit `feat(recipe-import): parse-page endpoint for recipe data extracted on device`.

---

### Task 4: Client — import WebView rules and extractor (pure + config)

**Files:**

- Create: `client/lib/import-browser/import-browser-utils.ts`
- Create: `client/lib/import-browser/ImportWebView.tsx` (the one shared, locked-down `WebView` wrapper)
- Modify: `package.json` / `package-lock.json` via `npx expo install react-native-webview`
- Test: `client/lib/import-browser/__tests__/import-browser-utils.test.ts`

**Interfaces:**

- Produces (utils):
  - `export const EXTRACT_LD_JSON_SCRIPT: string` — injected JS: collects `script[type="application/ld+json"]` text, posts `JSON.stringify({ type: "ldjson", blocks })` via `window.ReactNativeWebView.postMessage`, ends with `true;`.
  - `export function parseExtractorMessage(raw: string): string[] | null` — null unless the shape is exact, every block is a string, ≤ 20 blocks, ≤ 1,000,000 bytes total.
  - `export function hasRecipeBlock(blocks: string[]): boolean` — cheap device-side check (any block parses and contains `@type` Recipe at top level, in an array, or in `@graph`) used only to show the "Recipe found" bar; the server stays the authority.
  - `export function shouldAllowNavigation(url: string, isTopFrame: boolean): boolean` — top frame: true only for `http:`/`https:`; subframes: also allow `about:blank` / `about:srcdoc` (ad and embed iframes use them — blocking breaks pages). Nothing is ever handed to `Linking`: `onShouldStartLoadWithRequest` returns false for anything else and does nothing further. (Spike 2026-11-08: with no handler, react-native-webview passed an iframe's `about:srcdoc` to `Linking.openURL` — pages can make the app try to open external URLs.)
  - `export function resolveImportedUrl(currentUrl: string | undefined, pastedUrl: string): string` — WebView's current http(s) URL, else the pasted URL.
  - ~~`importBrowserUserAgent`~~ — **dropped**: Task 1 (2026-11-08) passed on both platforms with the default WebView user-agent, so no UA override; do not pass `userAgent`.
- Produces (component): `ImportWebView` props `{ url: string; hidden?: boolean; onBlocks: (blocks: string[], currentUrl: string) => void; onLoadEnd?: () => void; onNavigationChange?: (url: string) => void; ref?: React.Ref<{ extract(): void; reload(): void; goBack(): void }> }`. Fixed props: `originWhitelist={["http://*","https://*"]}`, `onShouldStartLoadWithRequest` → `shouldAllowNavigation`, `setSupportMultipleWindows={false}`, `allowFileAccess={false}`, `thirdPartyCookiesEnabled={false}`, `sharedCookiesEnabled={false}`, `injectedJavaScript={EXTRACT_LD_JSON_SCRIPT}`, `onMessage` → `parseExtractorMessage` → `onBlocks` (drop nulls); no `userAgent` prop (default UA passed Task 1). Hidden mode renders it 1×1, `opacity: 0`, `pointerEvents="none"`, `importantForAccessibility="no-hide-descendants"`, `accessibilityElementsHidden`. Code comment: this cookie store must not be shared with any other WebView added later.

- [ ] **Step 1: Write failing tests** for each util:
  - `parseExtractorMessage`: accepts `{"type":"ldjson","blocks":["{}"]}`; returns null for invalid JSON, `type:"other"`, `blocks:[1]`, 21 blocks, a block of `"é".repeat(500_001)` (1,000,002 UTF-8 bytes — over the byte cap though only 500,001 characters), missing `blocks`; accepts `"é".repeat(500_000)` (exactly 1,000,000 bytes).
  - `hasRecipeBlock`: true for top-level, array, `@type: ["Recipe","Thing"]`, and `@graph` cases; false for Article-only and invalid JSON.
  - `shouldAllowNavigation`: top frame true for `https://a.test/x`, `http://a.test`; top frame false for `ocrecipes://x`, `intent://x`, `tel:1`, `file:///etc`, `javascript:alert(1)`, `about:blank`, `about:srcdoc`, `""`; subframe true for `about:blank`, `about:srcdoc`, `https://ads.test`; subframe false for `ocrecipes://x`, `intent://x`.
  - `resolveImportedUrl`: current https URL wins; `undefined` / `about:blank` / non-http fall back to pasted.
- [ ] **Step 2:** `npx vitest run client/lib/import-browser` → FAIL (module not found).
- [ ] **Step 3:** `npx expo install react-native-webview`; implement utils and `ImportWebView`. Add `react-native-webview` to the Vitest mock setup the way other native modules are mocked (check `test/` setup).
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(import-browser): locked-down import WebView and extractor utils`.

---

### Task 5: Client — hidden fallback in `RecipeImportScreen` + sign-in sheet

**Files:**

- Modify: `client/hooks/useMealPlanRecipes.ts` (add hook)
- Modify: `client/screens/meal-plan/recipe-import-utils.ts` (add decision fn)
- Modify: `client/screens/meal-plan/RecipeImportScreen.tsx` (state machine, hidden `ImportWebView`, sheet)
- Test: `client/screens/meal-plan/__tests__/recipe-import-utils.test.ts`, `client/screens/meal-plan/__tests__/RecipeImportScreen.test.tsx`

**Interfaces:**

- Consumes: `ImportWebView`, `resolveImportedUrl` (Task 4); `parse-page` (Task 3).
- Produces:
  - `export function useParseRecipeFromPage()` → mutation `({ url, ldJson }: ParsePageParams) => Promise<ImportedRecipeData>`, `meta: { silentError: true }`.
  - `export function shouldTryDeviceFallback(error: unknown): boolean` — true only for `ApiError` with the four codes in Global Constraints.
  - `ImportState = "idle" | "loading" | "device" | "needs-browser" | "error"`. `device` keeps the same spinner UI as `loading`. `needs-browser` shows the sheet (copy in Global Constraints). "Open site and sign in" → `navigation.navigate("RecipeImportBrowser", { url, returnToMealPlan, fromHome })`. "Use a photo or paste instead" → `navigation.navigate("RecipeEntryHub", { returnToMealPlan })` (route in `MealPlanStackNavigator.tsx:36`; the hub's import sheet offers photo and paste).

- [ ] **Step 1: Write failing tests.**
  - utils: `shouldTryDeviceFallback` true for each of the four codes; false for `RATE_LIMITED`, `RESPONSE_TOO_LARGE`, `VALIDATION_ERROR`, a plain `Error`, and `undefined`.
  - screen (mock `ImportWebView` to expose a test trigger for `onBlocks`):
    - `server success navigates to RecipeCreate without mounting the WebView`.
    - `FETCH_FAILED mounts the hidden WebView, blocks are sent to parse-page with the WebView's final URL, success navigates to RecipeCreate with prefill`.
    - `parse-page failure shows the sign-in sheet with the exact copy`.
    - `15 s with no blocks shows the sign-in sheet` (fake timers).
    - `RATE_LIMITED shows the existing error state, no WebView`.
    - `unmounting during device fallback does not navigate` (Review Focus 3).
- [ ] **Step 2:** `npx vitest run client/screens/meal-plan` → new tests FAIL.
- [ ] **Step 3:** Implement hook, decision fn and screen changes. Hidden `ImportWebView` renders only in `device` state; clear the timeout and ignore late results on unmount/state change.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(recipe-import): hidden on-device fallback and sign-in sheet`.

---

### Task 6: Client — visible `RecipeImportBrowser` screen

**Files:**

- Create: `client/screens/meal-plan/RecipeImportBrowserScreen.tsx`
- Modify: `client/navigation/MealPlanStackNavigator.tsx` (param list + `Stack.Screen`)
- Modify: `client/types/navigation.ts` (nav prop type, per `docs/rules/typescript.md` — no local params types)
- Test: `client/screens/meal-plan/__tests__/RecipeImportBrowserScreen.test.tsx`

**Interfaces:**

- Consumes: `ImportWebView`, `hasRecipeBlock`, `resolveImportedUrl` (Task 4); `useParseRecipeFromPage` (Task 5).
- Produces: route `RecipeImportBrowser: { url: string; returnToMealPlan?: { mealType: string; plannedDate: string }; fromHome?: boolean }`.
- UI: header with close ✕ (goBack), current domain + lock icon, reload; after each `onBlocks`, if `hasRecipeBlock` → slide in the "✓ Recipe found · Import" bar; always-visible small "Import" control that calls `ref.extract()` then imports. Import → `parse-page` with latest blocks and `resolveImportedUrl(current, url)` → `navigation.replace("RecipeCreate", { prefill, returnToMealPlan, fromHome })`. No recipe → inline message "No recipe on this page yet — sign in or open the recipe, then try again." and stay.

- [ ] **Step 1: Write failing tests:**
  - `shows the Recipe found bar only after blocks containing a Recipe arrive`.
  - `Import sends the latest blocks and the current page URL to parse-page and replaces to RecipeCreate`.
  - `manual Import on a page with no recipe shows the message and does not call parse-page` (Review Focus 5).
  - `parse-page 422 shows the message and stays on the screen`.
  - `close returns to the previous screen`.
  - `header and Import control have accessibility labels/roles`.
- [ ] **Step 2:** `npx vitest run client/screens/meal-plan/__tests__/RecipeImportBrowserScreen.test.tsx` → FAIL.
- [ ] **Step 3:** Implement screen + navigation registration.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(recipe-import): visible in-app browser for sign-in imports`.

---

### Task 7: Saved site data — native clear, sign-out wipe, Settings, privacy page

**Files:**

- Create: `modules/webview-site-data/` (copy the layout of `modules/google-sign-in/`: `expo-module.config.json`, `index.ts`, `src/`, `ios/WebviewSiteDataModule.swift`, `android/.../WebviewSiteDataModule.kt`, `__tests__/`)
- Modify: `client/hooks/auth-session.ts` (`clearDurableLocalState`, line ~168)
- Modify: `client/screens/SettingsScreen.tsx` (new row)
- Modify: `site/privacy/index.html` (one paragraph near the device-data section, line ~45)
- Test: `modules/webview-site-data/__tests__/`, `client/hooks/__tests__/` (existing auth-session tests), `client/screens/__tests__/SettingsScreen.test.tsx`

**Interfaces:**

- Produces: `export async function clearImportBrowserData(): Promise<boolean>` — never throws; false on failure. iOS: `WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)`. Android: `CookieManager.getInstance().removeAllCookies` + `flush()`, `WebStorage.getInstance().deleteAllData()`.
- Settings row label "Clear site data", subtitle "Sign-ins to recipe sites made in OCRecipes". Confirm alert, then `clearImportBrowserData()`, toast success/failure.
- Privacy copy (exact): "If you sign in to a recipe website inside OCRecipes to import a recipe, that sign-in is stored only on your device. It is never sent to us. You can remove it any time in Settings → Clear site data, and it is removed when you sign out or delete your account."

- [ ] **Step 1: Write failing tests:**
  - module JS wrapper: `returns false and does not throw when the native call rejects`; `returns true on success`.
  - `clearDurableLocalState calls clearImportBrowserData` and `returns false when clearImportBrowserData returns false` (mirror the existing step tests).
  - Settings: `Clear site data asks for confirmation, then calls clearImportBrowserData`.
- [ ] **Step 2:** Run those test files → FAIL.
- [ ] **Step 3:** Implement module, wire the wipe step (with a comment like its neighbours), Settings row, privacy paragraph.
- [ ] **Step 4:** Same tests → PASS.
- [ ] **Step 5:** Commit `feat(import-browser): clear saved site data on sign-out and from Settings`.

---

### Task 8: Device verification and PR

- [ ] **Step 1:** Fresh native dev builds on the owner's iPhone and Android phone (iOS: `npx expo run:ios --device`; Android per `reference_android_build_on_u34bolt`). Test against the live server via a preview build where required (`feedback_test_on_live_server_via_preview_build`).
- [ ] **Step 2:** Success criteria from the spec, each platform; record a pass/fail table in the PR:
  - Allrecipes, Serious Eats, Simply Recipes import via the hidden fallback.
  - A sample of today's 16 working sites (at least BBC Good Food, NYT Cooking, RecipeTin Eats, King Arthur) import with no WebView mounted.
  - Pinterest: sign in (email + password) in the visible browser → open a pin whose recipe is on the linked blog → tap through → "Recipe found" → import. Re-import a pin later: saved sign-in is used.
  - Settings → Clear site data, then Pinterest asks for sign-in again. Sign out → sign in → Pinterest asks again.
  - Password autofill offered on the sign-in form (note result; not blocking).
- [ ] **Step 3:** `npm run preflight:fast`; open the PR (feature branch, never `main`), label `security` (new WebView surface + new ingestion endpoint), body ending with the attribution line. Note in the PR: needs a new native build; not OTA-deliverable.
