# verify-ui Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand `/verify-ui` project skill that visually verifies an iOS screen in the Simulator (deep-link → screenshot + accessibility snapshot → assert → verdict).

**Architecture:** A single instruction-only `SKILL.md` under `.claude/skills/verify-ui/` (matching the existing `audit`/`codify`/`todo` convention). It orchestrates the already-connected **XcodeBuildMCP** tools plus one inline `xcrun simctl openurl` command. No bespoke runtime, no npm/shell scripts, no hooks, no CI wiring.

**Tech Stack:** Claude Code skills (Markdown + YAML frontmatter), XcodeBuildMCP server, `xcrun simctl`, Expo/React Native iOS Simulator.

## Global Constraints

- **Platform:** iOS Simulator only. XcodeBuildMCP is Apple-only; Android is out of scope.
- **Trigger:** on-demand skill only. No auto-fire hook, no per-turn output.
- **Structure:** pure `SKILL.md` — no new committed npm/shell scripts; only existing MCP tools + inline `xcrun simctl`.
- **Non-blocking:** the skill reports findings; it never gates a commit or fails a build.
- **Verified project facts (2026-06-22), copy verbatim:**
  - Xcode workspace: `ios/OCRecipes.xcworkspace` · build scheme: `OCRecipes`
  - Bundle id: `com.williamtower.ocrecipes`
  - Deep-link URL scheme: `ocrecipes://` (distinct from the Xcode build scheme)
  - Test account (auth-gated screens): `demo` / `demo123`
- **Acceptance screen:** a content screen behind auth (`ocrecipes://recipe/<id>`), NOT the Scan capture view (simulator has no camera).
- **Note on testing:** skills and local settings are not unit-tested by Vitest. "Verification" here means structural checks (file location, valid frontmatter, skill is discoverable) plus the **live acceptance dry-run** in Task 2, which is the real end-to-end test. Do NOT invent Vitest tests for these artifacts.

## File Structure

- **Create:** `.claude/skills/verify-ui/SKILL.md` — the entire skill (frontmatter + procedure). One file, one responsibility.
- **Modify:** `.claude/settings.local.json` — add two `permissions.allow` entries so runs don't prompt (XcodeBuildMCP server + `xcrun simctl`). This file is local-only (gitignored); it will not be committed.

---

### Task 1: Author the `verify-ui` SKILL.md

**Files:**

- Create: `.claude/skills/verify-ui/SKILL.md`

**Interfaces:**

- Consumes: nothing (first task).
- Produces: the `verify-ui` skill, discoverable by the Skill tool as `verify-ui`. Its documented procedure references these XcodeBuildMCP tool names (load schemas via ToolSearch at run time): `session_show_defaults`, `session_set_defaults`, `list_sims`, `boot_sim`, `open_sim`, `launch_app_sim`, `build_run_sim`, `screenshot`, `snapshot_ui`, `tap`; plus the Bash command `xcrun simctl openurl booted ocrecipes://<path>`.

- [ ] **Step 1: Create the skill file with the exact content below**

Create `.claude/skills/verify-ui/SKILL.md` containing:

```markdown
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
  - If it launches, you are done here. JS/UI edits are picked up via Metro fast-refresh — **no
    rebuild needed** for the debug build attached to `expo run:ios`.
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
  the deep link.

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
```

- [ ] **Step 2: Verify the file exists at the right path with valid frontmatter**

Run:

```bash
test -f .claude/skills/verify-ui/SKILL.md && head -3 .claude/skills/verify-ui/SKILL.md
```

Expected: the file exists and prints the opening `---` / `name: verify-ui` frontmatter lines.

- [ ] **Step 3: Verify frontmatter has both required fields**

Run:

```bash
grep -E '^(name|description):' .claude/skills/verify-ui/SKILL.md
```

Expected: exactly one `name:` line (`name: verify-ui`) and one `description:` line.

- [ ] **Step 4: Confirm the skill is discoverable**

The Skill tool discovers `.claude/skills/*/SKILL.md` automatically — no registry edit needed.
Confirm `verify-ui` now appears in the available-skills list (it surfaces on the next skills
refresh / session). No command to run; this is a visual confirmation that decomposition is
correct (one self-contained file).

- [ ] **Step 5: Commit the skill (if `.claude/skills/` is tracked)**

```bash
git status --porcelain .claude/skills/verify-ui/SKILL.md
```

If the file shows as untracked/modified (not gitignored), commit it:

```bash
git add .claude/skills/verify-ui/SKILL.md
git commit -m "feat(skills): add verify-ui in-session iOS visual verification skill"
```

If `git status` shows nothing (path is gitignored like other `.claude/` local files), skip the
commit — the file is local-only by repo convention. Note which case applied.

---

### Task 2: Allowlist permissions and run the live acceptance dry-run

**Files:**

- Modify: `.claude/settings.local.json` (add two `permissions.allow` entries)

**Interfaces:**

- Consumes: the `verify-ui` skill from Task 1.
- Produces: a proven end-to-end run — the skill executes against `ocrecipes://recipe/<id>` and
  returns a screenshot path + accessibility snapshot + verdict, with no permission prompts.

- [ ] **Step 1: Add the permission allowlist entries**

In `.claude/settings.local.json`, add these two entries to the `permissions.allow` array
(after the existing last entry `"mcp__github__merge_pull_request"`):

```json
      "mcp__XcodeBuildMCP",
      "Bash(xcrun simctl *)"
```

`mcp__XcodeBuildMCP` (server-level) allows all that server's tools. Keep valid JSON — add a
comma after the previous entry.

- [ ] **Step 2: Verify the JSON still parses**

Run:

```bash
python3 -m json.tool .claude/settings.local.json > /dev/null && echo "valid JSON"
```

Expected: prints `valid JSON` (no parse error).

- [ ] **Step 3: Confirm the app is built, running, and backend is up**

Preconditions for the dry-run (ask the user to do these if not already true):

- App built+running once in the simulator: `npx expo run:ios` (also starts Metro).
- Backend up: `npm run server:dev`.

Run to confirm a simulator is booted:

```bash
xcrun simctl list devices booted
```

Expected: at least one `(Booted)` iPhone simulator. If none, the skill's Step 2 will boot one.

- [ ] **Step 4: Obtain a real recipe id for the deep link**

Get a valid recipe id from the dev DB (the `demo` account's seeded recipes):

```bash
psql "$DATABASE_URL" -t -c "select id from recipes order by created_at desc limit 1;"
```

Expected: one recipe id (UUID or integer per the schema). If empty, run `npm run seed:recipes`
first. Record the id as `<id>` for the next step.

- [ ] **Step 5: Run the acceptance dry-run via the skill**

Invoke the skill: `/verify-ui` with target screen `recipe/<id>` (the id from Step 4) and
assertions = the seeded recipe's title + that an ingredients list renders.

Execute the skill's procedure. The decisive observable outputs:

- `mcp__XcodeBuildMCP__screenshot` returns a screenshot **path**.
- `mcp__XcodeBuildMCP__snapshot_ui` returns a non-empty accessibility tree containing the
  recipe title.
- No permission prompt appears for any `mcp__XcodeBuildMCP__*` tool or for `xcrun simctl`.

Expected: a **PASS** verdict naming the recipe screen, with the screenshot path and the matched
assertions. If a permission prompt does appear, add the exact tool name it names to
`permissions.allow` and re-run.

- [ ] **Step 6: Confirm the auth/relaunch path actually exercised**

Verify the dry-run proved the representative path: either the deep link landed directly on the
recipe screen (JWT persisted across relaunch — the expected case), or it landed on login, the
skill logged in with `demo`/`demo123`, and the retry reached the recipe screen. Either outcome
is a pass; note which occurred (it validates the Assumptions section of the spec).

- [ ] **Step 7: Record the result**

No commit for `.claude/settings.local.json` (gitignored, local-only). Report to the user:
the verdict, the screenshot path, whether a native rebuild was needed, and which auth path
occurred. The skill is now proven end-to-end.

---

## Self-Review

**1. Spec coverage** (each spec section → task):

- On-demand SKILL.md trigger → Task 1. ✓
- Screenshot + a11y snapshot depth → Task 1 Step 1 (procedure §4) + Task 2 Step 5. ✓
- iOS-only / camera caveat → SKILL.md "When to use / not use" + acceptance screen choice. ✓
- Deep-link-first via `simctl openurl`, tap fallback, login retry → SKILL.md §3. ✓
- Pure SKILL.md structure → Task 1 (one file, no scripts). ✓
- Error handling (boot/build/empty-snapshot/backend) → SKILL.md §2 & §4. ✓
- Permissions setup → Task 2 Steps 1–2. ✓
- Acceptance test (content screen behind auth) → Task 2 Steps 4–6. ✓
- Assumptions (debug+Metro; persisted auth) → SKILL.md §2 & §3; validated in Task 2 Step 6. ✓

**2. Placeholder scan:** No "TBD"/"add error handling" placeholders. `<id>`, `<path>`,
`<barcode>`, `<screen>` are intentional runtime substitution points, each with an explicit step
(Task 2 Step 4) or example showing how to fill them. ✓

**3. Type/name consistency:** Tool names are identical across the SKILL.md, the Interfaces
blocks, and the permission entry (`mcp__XcodeBuildMCP*`). Xcode scheme `OCRecipes` vs. URL
scheme `ocrecipes://` are used consistently and correctly in their respective places. ✓

No gaps found.
