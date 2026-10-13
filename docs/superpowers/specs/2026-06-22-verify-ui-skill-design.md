# Design: `verify-ui` skill — in-session visual verification (iOS Simulator)

**Date:** 2026-06-22
**Status:** Approved (design); pending implementation plan
**Author:** Claude (brainstormed with @xertox1234)

## Summary

A project skill at `.claude/skills/verify-ui/SKILL.md`, invoked as `/verify-ui`, that gives
the agent **in-session visual confirmation of an iOS screen it just edited**. One run:
launch the app in the iOS Simulator at the screen under test (via deep link when possible),
capture a **screenshot + accessibility snapshot**, assert the expected elements rendered with
no error state, and report a PASS/ISSUES verdict with the screenshot path.

It uses the already-connected **XcodeBuildMCP** server — no new build scripts, no CI wiring.

## Motivation

After a UI edit, correctness often lives in the _render_ — layout, an error/empty state, a
control that didn't mount, a contrast regression — which unit tests cannot see. Today that
check is a manual eyeball in the simulator (cf. the "restart Metro yourself after UI changes"
working convention). This skill lets the agent do the looking, in-session, in seconds, without
burning paid macOS CI minutes.

**Scope reality — the simulator has no camera.** This is a camera-first app, but the iOS
Simulator exposes no camera device, so VisionCamera renders its no-device/permission _fallback_,
not a live preview. The live capture view therefore **cannot be meaningfully verified here** —
only its no-device fallback can. The high-value targets are everything _around_ the camera:
content screens (recipe detail, meal plan, profile), the **post-scan results / nutrition
screens**, and error/empty/loading states. The acceptance test (below) deliberately uses a
content screen, not the Scan capture view.

The marquee accelerator is the app's existing deep-linking config
([`client/navigation/linking.ts`](../../../client/navigation/linking.ts)): instead of tapping
Login → tab → screen, the skill opens `ocrecipes://<path>` and lands on the exact screen under
edit.

## Boundary vs. Maestro (load-bearing distinction)

|          | Maestro (`e2e/flows/*`)                     | `verify-ui` (this skill)                    |
| -------- | ------------------------------------------- | ------------------------------------------- |
| When     | Deliberate, pre-launch / CI manual-dispatch | Inner dev loop, on-demand                   |
| Scope    | Regression of _known_ committed flows       | The _one screen being edited right now_     |
| Platform | iOS + Android                               | iOS Simulator only                          |
| Cost     | Paid macOS runner minutes                   | Free, local, ~seconds                       |
| Output   | Pass/fail of a committed `.yaml` flow       | Screenshot + a11y snapshot + ad-hoc verdict |

`verify-ui` **complements, never replaces** Maestro. It is not a regression suite and writes no
committed flows. Cross-platform correctness remains enforced by Maestro/CI (both platforms).

## Decisions (locked during brainstorming)

1. **Trigger:** on-demand project skill (`/verify-ui`). No auto-fire hook, no per-turn output.
2. **Depth:** screenshot **and** accessibility snapshot (`snapshot_ui`) — the agent both
   eyeballs the render and programmatically asserts expected text/elements; the a11y tree
   doubles as a VoiceOver/WCAG spot-check.
3. **Platform:** iOS Simulator only (XcodeBuildMCP is Apple-only). Android documented as a
   future `adb screencap` + uiautomator extension; not built now.
4. **Navigation:** deep link first via `xcrun simctl openurl booted ocrecipes://<path>`
   (XcodeBuildMCP's `launch_app_sim` takes no URL arg and there is no `openurl` MCP tool, so
   the deep link goes through `simctl`); tap-steps fallback for screens without a deep link.
5. **Structure:** pure `SKILL.md` procedure (Approach A) — orchestrates existing XcodeBuildMCP
   tools, no bespoke scripts. Matches the existing `audit`/`codify`/`todo` skill convention.

## Architecture

Single instruction-only skill file: `.claude/skills/verify-ui/SKILL.md` (Claude-Code skill
frontmatter: `name`, `description` with trigger conditions). It documents a procedure the agent
executes by calling XcodeBuildMCP tools directly. No runtime code, no npm scripts, no hooks.

**Project facts the skill hard-codes (verified 2026-06-22):**

- Xcode build scheme: `OCRecipes`; workspace `ios/OCRecipes.xcworkspace` (used by
  `session_set_defaults` — do NOT confuse with the `ocrecipes://` URL scheme below)
- iOS bundle identifier: `com.williamtower.ocrecipes`
- Deep-link URL scheme/prefixes: `ocrecipes://`, `https://ocrecipes.app` (used by `simctl openurl`)
- Test account for authed screens: `demo` / `demo123`
- Native project: committed `ios/` workspace (Expo app; `expo run:ios` builds it)

## Procedure (the SKILL.md core)

Inputs the agent supplies at invoke time:

- **Target screen** — a deep-link path (e.g. `recipe/123`, `scan`, `nutrition/<barcode>`) or,
  when no deep link exists, explicit tap/swipe steps.
- **Assertions** — expected text / elements that prove the screen rendered correctly.

Steps:

1. **Session defaults (once per session):** `session_show_defaults`; if scheme/sim unset,
   `session_set_defaults` → `workspacePath` = `ios/OCRecipes.xcworkspace`, `scheme` =
   `OCRecipes`, `bundleId` = `com.williamtower.ocrecipes`, a pinned simulator chosen via
   `list_sims`.
2. **Ensure the app is running:** `boot_sim` + `open_sim` (idempotent). Try `launch_app_sim`
   on `com.williamtower.ocrecipes`.
   - **JS/UI edit → no rebuild** (Metro fast-refresh); just relaunch. _Assumes the debug build
     connected to Metro (`expo run:ios`) — a release/standalone build will not pull new JS on
     relaunch and would need a rebuild._
   - **Native module change / app not installed → `build_run_sim`** — the slow (~minutes) path,
     flagged explicitly so it is never a surprise.
3. **Authenticate if needed:** screens behind login use `demo`/`demo123` via the login flow
   when the app is not already authed.
4. **Navigate to the target screen:** with the app installed and the sim booted, run
   `xcrun simctl openurl booted ocrecipes://<path>` (Bash) to land directly on the screen —
   `simctl openurl` foregrounds or cold-launches the app and delivers the URL to React
   Navigation's linking handler. Fall back to agent-supplied `tap`/`snapshot_ui` steps when a
   screen has no deep link.
5. **Capture:** `screenshot` (agent views the image) + `snapshot_ui` (accessibility tree).
6. **Assert & report:** confirm expected elements/text present in the a11y tree, check for
   error-boundary/empty states, eyeball layout/contrast → report verdict (PASS / ISSUES) with
   the screenshot path.

## Error handling (never blocks — reports only)

- Sim not booted → `boot_sim`.
- App not installed / native changed → `build_run_sim` with the explicit slow-path note.
- Deep link doesn't resolve (no matching route) → tap-steps fallback → else capture the
  current screen and warn.
- Backend down → authed screens render errors; the skill detects the login/error state and
  instructs the user to start `npm run server:dev`.
- First `snapshot_ui` returns empty → re-run once (mirrors the LSP cold-start warm-up pattern).
- The skill reports findings; it does **not** gate commits or fail a build.

## Non-goals (YAGNI)

- No baseline image diffing (flaky, stateful — explicitly out).
- No Android path (documented future extension only).
- No CI integration (Maestro owns regression).
- No new committed npm/shell scripts — the skill only orchestrates existing MCP tools plus an
  inline `xcrun simctl openurl` command (pure SKILL.md, no bespoke runtime).
- No auto-fire hook (on-demand only).

## Setup / prerequisites

- One-time: allowlist `mcp__XcodeBuildMCP__*` and `Bash(xcrun simctl *)` in
  `.claude/settings.local.json` so runs don't prompt each time.
- The iOS Simulator app must be installable/runnable on the machine (Xcode toolchain present).
- For authed screens: backend up (`npm run server:dev`) and Metro running (started by
  `expo run:ios`).

## Assumptions

- **Debug build + Metro.** Fast-refresh-without-rebuild holds only for the debug build attached
  to Metro (`expo run:ios`). A release/standalone build needs a rebuild to pick up JS changes.
- **Persisted auth across relaunch.** Deep-link navigation to an auth-gated screen assumes the
  JWT in token storage survives the cold relaunch; the auth-gated acceptance test confirms this.
  If a relaunch lands on the login screen, the skill logs in (`demo`/`demo123`) and retries the
  deep link.

## Acceptance test

During implementation, a single real end-to-end dry run must succeed:
`/verify-ui` against a **content screen behind auth** — `ocrecipes://recipe/<id>` for a seeded
recipe — produces a screenshot **and** an accessibility snapshot **and** a verdict. A content
screen (not the Scan capture view) is chosen deliberately: it renders richly in the simulator,
and it exercises the full representative path — auth, JWT persisted across the relaunch, and
deep-link resolution. That proves the tool sequence end-to-end before the skill is considered
done.

(The Scan capture view is explicitly _not_ the acceptance screen — the simulator has no camera,
so it only shows the no-device fallback. See Motivation → "Scope reality".)

## Open questions

None. All design decisions resolved during brainstorming.

## Notes

- `docs/superpowers/specs/` is gitignored / local-only by project convention
  (specs are local planning artifacts), so this file is not committed to the remote.
