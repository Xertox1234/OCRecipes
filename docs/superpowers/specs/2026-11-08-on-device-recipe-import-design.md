# On-device recipe import fallback — design

Date: 2026-11-08 · Status: draft for owner approval

## Why

The URL importer is old: the server downloads the page itself (`safeFetch` + cheerio in
`server/services/recipe-import.ts`) and reads its schema.org `Recipe` JSON-LD. A probe on
2026-11-07 (laptop network, 19 real recipe pages) found 16 import fine and 3 fail:
**Allrecipes, Serious Eats, Simply Recipes** — all People Inc. sites, which answer any
non-browser request with a Cloudflare **HTTP 402** block page (it points scrapers to content
licensing). Changing the user-agent does not help; a fake browser user-agent made five other
sites return 403. Real desktop Chrome gets Allrecipes' full JSON-LD (11 ingredients, 9 steps).
Production fetches come from Railway's data-center IPs, so the real failure rate is likely
higher than measured.

Paywalled sites (NYT Cooking, America's Test Kitchen) imported fine — they publish JSON-LD for
Google. Pages behind a real login (members-only recipes) are the remaining gap.

The owner wants import to **work on blocked sites**, including ones that need the user to sign in.
The owner is aware People Inc. blocks automated access deliberately and chose to proceed: the
fetch happens on the user's phone, when the user asks for it.

## Goals

1. When the server import fails, the phone loads the page in a **hidden in-app browser**,
   extracts the recipe JSON-LD, and the server validates and returns it — the user sees one
   spinner.
2. When that also fails, the user can **open the page in a visible in-app browser, sign in, and
   import** from there.
3. Logins made in that browser **persist**, in storage separate from the app's own login, with
   a way to clear them.
4. Sites that work today behave exactly as before.

## Non-goals

- Share-sheet / share-extension import (separate project, later).
- The in-app browser as a general "browse for recipes" feature — it opens only from a failed
  import. _(Claude's call.)_
- Making Google or Facebook sign-in work inside the in-app browser — both providers refuse
  embedded browsers. _(Claude's call.)_
- Changing the server-side fetch (user-agent, proxies, headless browser on the server).
- The unused `useImportRecipeFromUrl` hook / `import-url` route: no client callers today. Leave
  it untouched (unused ≠ removable).

## Anti-goals (would be a failure even if it "works")

- Any path where a web page loaded in the import browser can reach the app's auth token, call
  app APIs, or open app deep links.
- The server trusting phone-supplied data more than it trusts a page it fetched itself.
- Ad networks able to follow users across recipe sites inside our app **through cookies**
  (third-party cookies off). _(Claude's call: blocking ads/trackers or fingerprinting is out of
  scope — `react-native-webview` has no clean sub-request blocking; it would need a native
  content blocker.)_
- A slower or different experience on the 16 sites that work today.

## Constraints

- `react-native-webview` is a new native dependency → **new native build** for iOS and Android;
  cannot ship by OTA. Expo CNG: no hand edits to `ios/`/`android/`.
- The app's auth token lives in `SecureStore` (`client/lib/token-storage.ts`), not web storage;
  keep it that way.
- Strict TDD; pure logic (JSON-LD finding on the device side, state machine) extracted to
  `*-utils.ts` so Vitest covers it.
- Ingestion-boundary validation rule (`docs/rules/typescript.md`): the existing lenient
  `schemaOrgRecipeSchema` is reused, not a stricter new schema.

## The flow (decided with the owner; mockup reviewed)

Entry point: `client/screens/meal-plan/RecipeImportScreen.tsx` (uses `useParseRecipeFromUrl` →
`POST /api/meal-plan/recipes/parse-url`).

1. **Importing.** Unchanged UI: one spinner. Server `parse-url` runs first.
2. **Hidden fallback.** If `parse-url` fails with `FETCH_FAILED`, `NO_RECIPE_DATA`, or
   `TIMEOUT`, the screen mounts an invisible WebView on the URL, waits for load, runs an injected
   script that collects the text of every `script[type="application/ld+json"]`, and posts it back.
   The client sends that to the new endpoint (below). Success → step 4.
   _(Claude's call: `PARSE_ERROR` / `RESPONSE_TOO_LARGE` also try the fallback only if cheap —
   builder decides; validation errors (400) never do.)_
3. **Both failed → sign-in sheet.** Copy: "We couldn't read this recipe. The site may need you to
   sign in." Buttons: **Open site and sign in** (primary), **Use a photo or paste instead**
   (routes to the existing `RecipePhotoImport` / `RecipeTextImport` flows). "May" is deliberate:
   the app can't tell a login wall from a block or a page with no recipe.
4. **Visible in-app browser** (owner chose option B with a backup): header with close ✕, site
   domain + lock, reload. After each page load the app runs the same extraction; when a recipe is
   found a bar slides in — **"✓ Recipe found · Import"**. A small manual **Import** control is
   always available as a backup (recipes rendered late by scripts); tapping it on a page with no
   recipe says so and lets the user keep browsing.
5. **Recipe preview.** The existing preview-and-save screen, fed the same `ImportedRecipeData`
   shape `parse-url` returns today.

## Server: new endpoint

`POST /api/meal-plan/recipes/parse-page` (name is the builder's call), `requireAuth` +
`urlImportRateLimit`.

- Body: `{ url: string (http/https), ldJson: string[] }` — the raw text of each JSON-LD block.
  Sending raw strings keeps **one** parser (server-side `findRecipeInLdJson` +
  `schemaOrgRecipeSchema`); the device does not interpret recipes.
- Limits: cap block count and total bytes (_Claude's call:_ ≤ 20 blocks, ≤ 1 MB total; builder may
  tune with a reason). Over-limit → 413/422, not a crash.
- Refactor `importRecipeFromUrl` so the post-fetch half (find recipe in JSON-LD → schema parse →
  map to `ImportedRecipeData`) is a shared function both routes call; then apply the same
  post-processing `parse-url` does today (no-ingredients-and-no-instructions check,
  `normalizeRecipeFields`). Same error codes and messages.
- No server fetch happens on this path. Image URLs in the result are as untrusted as they are
  today (they came from the site either way) — builder confirms nothing downstream fetches them
  without the existing SSRF guard.

## The in-app browser (both hidden and visible)

- One shared WebView configuration for import.
- **No JS bridge into the app** beyond a single message type carrying the JSON-LD strings;
  messages are size-capped and shape-checked on receipt. _(Claude's call:)_ a message is
  accepted from whatever http(s) page is currently shown — the bridge carries only untrusted
  JSON-LD text that the server validates, so origin filtering adds little.
- **Roaming** _(Claude's call):_ the visible browser may navigate to any http(s) page, so
  sign-in bounces through other domains (`auth.`, `myaccount.`, separate login sites) work, and
  following links to another recipe is fine. Hidden mode follows redirects the same way.
- **Which URL is imported** _(Claude's call):_ the `url` sent to the endpoint — and saved as
  the recipe's source — is the page the recipe was actually extracted from (after redirects /
  browsing), not necessarily the pasted link.
- Block navigation to non-http(s) schemes (`ocrecipes://`, `intent:`, `tel:`, app links), file
  URLs, and new windows; downloads off.
- **Hidden mode:** uses the **same persistent store** as the visible browser _(Claude's call)_,
  so a site the user signed in to last time imports silently next time instead of showing the
  sign-in sheet again. Timeout (_Claude's call:_ ~15 s), never shown.
- **Visible mode:** persistent cookies so sign-ins stick; third-party cookies off (platform
  default — keep it explicit). The system password autofill should work; verify on device.
- Separate from any future WebView in the app (if another is added, it must not share this
  cookie store — note in code).

## Saved site data

- One persistent cookie/storage store for the import browser (hidden and visible).
- **Settings → "Clear site data"** for the import browser.
- Wiped automatically whenever the app's local session is torn down — **sign-out, session
  expiry (401), and account deletion** — by hooking `clearDurableLocalState` in
  `client/hooks/useAuth.ts`, which both `logout` and `expireSession` call _(Claude's call: so the
  next account on the phone never inherits the last user's site logins)_.
- `parse-page` gets its own rate limiter rather than sharing `parse-url`'s, so the fallback
  doesn't double-count one import _(Claude's call)_.
- Privacy page gets a short line: recipe-site sign-ins made in the app are stored on the device,
  never sent to OCRecipes, and can be cleared.

## Success criteria

- On a real iPhone and a real Android phone: Allrecipes, Serious Eats and Simply Recipes import
  through the hidden fallback.
- The 16 sites that pass today still import via the server, with no visible change.
- **Sign-in test = Pinterest** (owner's account, email + password sign-in): sign in inside the
  visible browser, open a pin whose recipe lives on the linked site, tap through, see "Recipe
  found", import. Then re-import a pin later and confirm the saved sign-in is used. On each
  platform. Why Pinterest: a 2026-11-07 check found big paywalls (America's Test Kitchen 10/10,
  NYT Cooking) give full recipe data to logged-out requests, so a true login-only recipe site
  wasn't found; Pinterest exercises sign-in persistence, cross-site browsing and detection in
  one real flow. (One pin carried its own recipe data and imported server-side; another had
  none — its recipe is on the linked blog.)
- Unit tests: endpoint validation/limits, shared parse function, client fallback state machine,
  navigation-block rules, clear-on-logout.

## Left to the builder

- Endpoint and component names; where the WebView lives (screen-level vs. a reusable
  component); the exact fallback state machine.
- Whether the hidden WebView waits for `onLoadEnd` only or also a short settle delay.
- Exact copy beyond the sheet text above; styling within `theme.ts`.
- Which plugin/config entry adds `react-native-webview` under CNG.

## Open risks

- People Inc. may also block **WebViews** (Android WebView marks itself with `wv` in its
  user-agent). Desktop Chrome passed; device WebViews are untested — check this first, as a
  go/no-go spike before building the sign-in UI. **Owner ruling (2026-11-08):** if the WebView
  is blocked, the app **may** adjust the WebView's user-agent (e.g. drop the `wv` marker so it
  presents as the platform browser). Only the phone's WebView, never the server fetch; use the
  smallest change that passes.
  **RESOLVED 2026-11-08 — go/no-go spike PASSED, no UA change needed.** Default WebView UA,
  JSON-LD read, no block page:

  | Device                                                               | Allrecipes        | Serious Eats | Simply Recipes |
  | -------------------------------------------------------------------- | ----------------- | ------------ | -------------- |
  | iPhone 16 Pro Max, iOS 26.6.2 (WKWebView)                            | ✅ 11 ingredients | ✅ 11        | ✅ 16          |
  | Galaxy SM-A376B, Android 17 (WebView Chrome 156, UA includes `; wv`) | ✅ 11             | ✅ 11        | ✅ 16          |

  Side finding: with no navigation handler, react-native-webview passed an ad iframe's
  `about:srcdoc` to `Linking.openURL` — the import WebView must refuse non-http(s) top-frame
  navigations itself and allow `about:blank`/`about:srcdoc` only in subframes, never handing
  URLs to the OS.

- The sign-in path's value may be modest: logged-out requests already get full recipe data on
  the big paywalled sites. It still covers Cloudflare interactive challenges, sites that render
  recipes only for signed-in users, and browsing from a pin/link to the recipe.

## Possible follow-up (not in scope)

- Server-side: when a Pinterest pin has no recipe data, follow its outbound link and import
  from there. Noted, not designed.
- Interactive Cloudflare challenges (Turnstile) can't be solved in the hidden browser; the
  visible browser lets the user solve them.
