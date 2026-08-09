---
name: verify-ui
description: Use after editing an iOS UI or content screen to visually verify it renders correctly in the iOS Simulator. Launches the app at the target screen (deep link), captures a screenshot + accessibility snapshot, asserts expected elements/no error state, and reports a verdict. iOS Simulator only; complements Maestro (not a regression suite). NOT for the live camera capture view — the simulator has no camera.
---

# verify-ui — in-session visual verification (iOS Simulator)

Confirm that an iOS screen you just edited actually renders correctly — layout, expected
elements, no error/empty state — by driving the iOS Simulator and capturing a screenshot plus
an accessibility snapshot. This is an **inner-loop, on-demand** check. It complements the
Maestro e2e suite (`e2e/flows/*`); it does not replace it and writes no committed flows.

## When to use / not use

- USE after editing a content/results/error screen (recipe detail, meal plan, profile,
  post-scan nutrition results, empty/error states).
- DO NOT use to verify the live camera capture view — the iOS Simulator has no camera, so the
  Scan screen only shows the no-device fallback. (You can still verify that fallback renders.)
- Android is out of scope (XcodeBuildMCP is Apple-only); cross-platform regression stays with
  Maestro/CI.

## Inputs (gather before starting)

- **Target screen** — a deep-link path if one exists (see `client/navigation/linking.ts`),
  e.g. `recipe/<id>`, `nutrition/<barcode>`, `conversation-list`, `scan`. Otherwise, the
  tap/swipe steps to reach it from the home screen.
- **Assertions** — the specific text/elements that prove the screen rendered (e.g. the recipe
  title, an ingredients list, a specific button).

## Project facts (hard-coded)

- Xcode workspace: `ios/OCRecipes.xcworkspace` · build scheme: `OCRecipes`
- Bundle id: `com.williamtower.ocrecipes`
- Deep-link URL scheme: `ocrecipes://` (distinct from the Xcode build scheme)
- Test account for auth-gated screens: `demo` / `demo123`

## Prerequisites

- **XcodeBuildMCP UI-automation tools** (`tap`, `type_text`, `swipe`, `gesture`, `button`) are
  needed for any step that _interacts_ with the app: logging in, tapping through to a screen with
  no deep link, or dismissing a system modal. They live in the separate `ui-automation` workflow
  and are **not registered unless it is explicitly enabled**.

  **Check first, don't assume.** The `ToolSearch` preload in the Tools section below doubles as
  the check: if `mcp__XcodeBuildMCP__tap` is missing from its result, `ui-automation` is not
  enabled and you are capture-only. The server also logs `Registered N tools from workflows: ...`
  at startup.

  Two mechanisms enable it, and **the project file wins over the env var** (config resolution
  order is overrides → project file → env → default — the reverse of the usual convention):
  1. **Project-local** `.xcodebuildmcp/config.yaml` at the repo root:

     ```yaml
     enabledWorkflows:
       - simulator
       - ui-automation
     ```

     This repo has one, but it is **git-excluded** (`.git/info/exclude`), so it is absent from a
     fresh clone and from every worktree. The lookup is `<cwd>/.xcodebuildmcp/config.yaml` with
     **no parent-directory walk** (`getConfigDir` in `utils/project-config.js` is a plain
     `path.join`), read once at startup. So a session launched inside a worktree gets no
     `ui-automation` even though the worktree sits under the main checkout — nesting does not
     help. A session launched from the main checkout keeps the tools after entering a worktree,
     because the server already loaded its config.

     To give worktree-launched sessions the tools, prefer the env var in (2) — it has no cwd
     dependency at all. `XCODEBUILDMCP_CWD=<main checkout>` also works (it `chdir`s at bootstrap,
     so the lookup always resolves the main checkout), but **mind its blast radius**:
     XcodeBuildMCP is typically registered once in the top-level `mcpServers` of `~/.claude.json`,
     which makes that variable pin the server's cwd for _every_ Apple project on the machine —
     another project's own `.xcodebuildmcp/config.yaml` would then never resolve, and its
     relative paths would resolve inside this repo. Only reach for it if you work in one Apple
     project.

  2. **User-level** `XCODEBUILDMCP_ENABLED_WORKFLOWS=simulator,ui-automation` in the
     XcodeBuildMCP server's `env` block in `~/.claude.json`. This is the durable fix — it needs
     no cwd and survives a clone. (Measured: from a directory with no `.xcodebuildmcp/`, the
     server registers 24 tools without it and 36 with it, adding `ui-automation`.)

     Because the project file wins wherever it exists, the env var only takes effect where there
     is **no** `.xcodebuildmcp/config.yaml`. Keep the two lists in sync — otherwise adding a
     workflow to only one of them makes the same repo expose different tool sets depending on
     which directory Claude was launched from.

  Either way, config changes only take effect **after a Claude restart**. Without the tools the
  skill still runs **capture-only** — set defaults, launch, deep-link, screenshot, snapshot —
  enough for any target reachable without interaction (an already-authenticated deep-link
  screen, or the login screen itself). Reference: https://xcodebuildmcp.com/docs/configuration

- Auth-gated screens need the backend up (`npm run server:dev`) and Metro running.

## Tools

This skill drives the **XcodeBuildMCP** server plus one `xcrun simctl` Bash command. The
XcodeBuildMCP tools are deferred — load their schemas first, e.g.
`ToolSearch("select:mcp__XcodeBuildMCP__session_show_defaults,mcp__XcodeBuildMCP__session_set_defaults,mcp__XcodeBuildMCP__list_sims,mcp__XcodeBuildMCP__boot_sim,mcp__XcodeBuildMCP__launch_app_sim,mcp__XcodeBuildMCP__build_run_sim,mcp__XcodeBuildMCP__screenshot,mcp__XcodeBuildMCP__snapshot_ui,mcp__XcodeBuildMCP__tap")`,
before calling them.

## Procedure

### 1. Set session defaults (once per session)

- Call `mcp__XcodeBuildMCP__session_show_defaults`.
- If scheme/simulator are not set, call `mcp__XcodeBuildMCP__list_sims` to pick a booted or
  available iPhone simulator, then `mcp__XcodeBuildMCP__session_set_defaults` with:
  - `workspacePath`: `ios/OCRecipes.xcworkspace`
  - `scheme`: `OCRecipes`
  - `bundleId`: `com.williamtower.ocrecipes`
  - `simulatorName`: the chosen device (e.g. `iPhone 16`)
  - `configuration`: `Debug`

### 2. Ensure the app is installed and running

- `mcp__XcodeBuildMCP__boot_sim`, then `mcp__XcodeBuildMCP__open_sim` (both idempotent).
- Try `mcp__XcodeBuildMCP__launch_app_sim`.
  - If it launches straight into the app, you are done here. JS/UI edits are picked up via Metro
    fast-refresh — **no rebuild needed** for the debug build attached to `expo run:ios`.
  - **Dev-client build:** if launch lands on the expo-dev-client _launcher_ (a "Development
    servers" list, not your app), connect it to Metro with one Bash call —
    `xcrun simctl openurl booted "ocrecipes://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"` —
    then wait for the JS bundle to finish building (watch the Metro log) before navigating.
  - If the app is not installed, OR you changed native code/modules, run
    `mcp__XcodeBuildMCP__build_run_sim`. **Tell the user this is the slow (~minutes) native
    build path** so it is never a surprise. (A release/standalone build also won't pull new JS
    on relaunch — assume the debug+Metro build.)
- Auth-gated screens need the backend: if you see network errors, ask the user to start
  `npm run server:dev`.

### 3. Navigate to the target screen

- **Deep link (preferred):** run via Bash:
  `xcrun simctl openurl booted ocrecipes://<path>`
  This foregrounds or cold-launches the app and hands the URL to React Navigation's linking
  handler.
- **No deep link:** call `mcp__XcodeBuildMCP__snapshot_ui` to read the current screen's
  elementRefs, then `mcp__XcodeBuildMCP__tap` through to the target screen.
- **If it lands on the login screen** (JWT not persisted across relaunch): log in with `demo`
  / `demo123` (snapshot_ui → tap the username/password fields → type → submit), then re-run
  the deep link. (Needs the UI-automation tools from Prerequisites.)
- **System modal overlay:** a SpringBoard alert (e.g. an Apple-ID re-verify prompt) can sit on
  top of the app. While present, `snapshot_ui` returns only the modal's elements — the app is
  hidden from the accessibility tree — so dismiss it first by tapping its button (e.g. "Not
  Now"). This also needs the UI-automation tools.

### 4. Capture

- `mcp__XcodeBuildMCP__screenshot` with `returnFormat: path` — view the image to eyeball
  layout, contrast, and obvious render problems.
- `mcp__XcodeBuildMCP__snapshot_ui` — read the accessibility tree (it returns elementRef
  targets). If the first snapshot comes back empty, call it once more — a cold first call can
  return nothing (same warm-up quirk as the LSP server).

### 5. Assert and report

- Confirm each expected element/text from your inputs is present in the snapshot.
- Check there is no error-boundary, empty-state, or stuck-loading condition.
- Report a verdict to the user:
  - **PASS** — "<screen> renders correctly" + the screenshot path + which assertions matched.
  - **ISSUES** — list what is wrong (missing element, error state, layout) + the screenshot
    path.
- This skill never blocks a commit; it only reports.
