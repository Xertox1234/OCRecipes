# Postcss-Override Bundler-Verification Closure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close `todos/P3-2026-05-31-postcss-override-bundler-verify.md` by recording the metro-postcss gating analysis (AC #1 resolved-by-analysis), confirming the static checks (AC #2/#4), and making AC #3's deferred trigger durable — with no new build code.

**Architecture:** Three deliverables. (1) A local-only `docs/solutions/` knowledge file codifying _why_ a web export can't exercise postcss in this project. (2) A one-line removal-trigger comment in the tracked `.github/dependabot.yml`. (3) An `Updates` entry on the todo (checking AC #1/#2/#4) followed by archiving it. Only #2 and #3 are tracked by git → a small PR; `main` is protected so it merges via PR, not direct push.

**Tech Stack:** npm `overrides`, `@expo/metro-config` (metro web CSS transform), lightningcss, Dependabot config, Markdown docs. No runtime code, no tests.

**Spec:** `docs/superpowers/specs/2026-06-02-postcss-override-bundler-verify-closure-design.md`

---

## File Structure

| Path                                                                                          | Tracked?                | Action                | Responsibility                                                                       |
| --------------------------------------------------------------------------------------------- | ----------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| `docs/solutions/best-practices/metro-postcss-gating-overrides-resolution-floor-2026-06-02.md` | local-only (gitignored) | Create                | Reusable finding: metro postcss gating + lightningcss + override-as-resolution-floor |
| `.github/dependabot.yml`                                                                      | tracked                 | Modify (comment only) | Durable override-removal trigger at the SDK-pin                                      |
| `todos/P3-2026-05-31-postcss-override-bundler-verify.md` → `todos/archive/…`                  | tracked                 | Edit + move           | Record analysis, check AC #1/#2/#4, archive                                          |

No `react-native-web`, `postcss.config`, `metro.config`, or `.css` is created. Order of work: solution doc → dependabot comment → todo close+archive → verify → commit.

---

### Task 1: Write the solution doc (local-only codification)

**Files:**

- Create: `docs/solutions/best-practices/metro-postcss-gating-overrides-resolution-floor-2026-06-02.md`

- [ ] **Step 1: Write the file with this exact content**

```markdown
---
title: "Expo metro's postcss path is gated on a postcss.config — an overrides.postcss pin is a resolution floor, not a live code path"
track: knowledge
category: best-practices
tags:
  [
    dependencies,
    expo,
    metro,
    postcss,
    lightningcss,
    overrides,
    build-tooling,
    web,
    security,
  ]
module: shared
applies_to: ["package.json", ".github/dependabot.yml"]
created: 2026-06-02
---

# Expo metro's postcss path is gated on a postcss.config — an `overrides.postcss` pin is a resolution floor, not a live code path

## When this applies

- You forced a transitive dep via npm `overrides` to dodge a CVE (e.g. `postcss ^8.5.10`)
  and want to know whether the _bundler_ actually runs the patched code.
- You're about to "verify postcss under the web export" or add Tailwind/autoprefixer for web.
- You're lifting the Expo SDK pin and wondering whether an `overrides` entry is still needed.

## The metro web CSS pipeline (Expo SDK 54, @expo/metro-config 54.0.15)

A web export transforms CSS files through `build/transform-worker/transform-worker.js`:

1. `transformCss()` runs **only** on the `web` platform (native returns an empty module).
2. It calls `transformPostCssModule()` (`build/transform-worker/postcss.js`) **first**, which
   calls `resolvePostcssConfig(projectRoot)` and **early-returns `{ hasPostcss: false }` when
   there is no `postcss.config.*` at the project root** — `require('postcss')` and
   `processor.process()` (the advisory's vulnerable stringify) are never reached.
3. The real CSS work is then done by **lightningcss** (`require('lightningcss').transform(...)`),
   not postcss.

`resolvePostcssConfig` reads the **project** root, so installing a dependency (e.g.
`react-native-web`) cannot introduce a config. postcss therefore sits behind three gates:
**web platform** + a **`.css` in the bundle** + a **`postcss.config` with a plugin**.

## Why an `overrides.postcss` pin is a _resolution floor_, not a live code path

OCRecipes has no `postcss.config.*`, no `metro.config.*`, and no `.css` imports in
`client/`, `shared/`, or `server/`. So a vanilla `npx expo export --platform web` — even with
`react-native-web` installed — routes CSS through lightningcss and **never calls postcss**.

The `overrides: { "postcss": "^8.5.10" }` pin is thus a _dependency-resolution floor_: it
guarantees that _if_ a `postcss.config` is ever added (Tailwind-for-web, autoprefixer) the
version metro resolves is ≥ 8.5.10. Its API compatibility is already exercised on **every CI
run** via `vitest → vite → postcss` (vite calls the same postcss `process()` API), so an
API-breaking bump would fail tests even though the CSS stringify never fires.

## How to actually exercise postcss under metro (only if you ever need to)

You must deliberately wake all three gates: install `react-native-web`, add a
`postcss.config.js` with ≥1 plugin, import a `.css` from a web entry, then
`npx expo export --platform web`. This proves "a stable postcss processes trivial CSS" —
it does **not** reflect this project's real bundler behavior, which never calls postcss.

## How this was verified (2026-06-02)
```

npm ls postcss → expo→@expo/metro-config→postcss@8.5.15
vitest→vite→postcss@8.5.15 (deduped) ; single node_modules/postcss
npm ls react-native-web → (empty, not installed)
expo@54.0.34 (SDK 54)

```

Code: `@expo/metro-config/build/transform-worker/transform-worker.js` (`transformCss`,
lightningcss at the "Global CSS" block) and `build/transform-worker/postcss.js`
(`transformPostCssModule`, `resolvePostcssConfig`).

## See also

- Closure: `todos/archive/P3-2026-05-31-postcss-override-bundler-verify.md`
- Removal trigger: comment in `.github/dependabot.yml` `expo >=55.0.0` ignore block
- Related: `docs/solutions/best-practices/auditing-dependencies-expo-drizzle-zod-stack-2026-05-23.md`
```

- [ ] **Step 2: Confirm it landed (local-only, so git ignores it)**

Run: `git check-ignore docs/solutions/best-practices/metro-postcss-gating-overrides-resolution-floor-2026-06-02.md && head -9 "$_"`
Expected: prints the path (confirming it's gitignored/local-only), then the frontmatter block.

---

### Task 2: Add the override-removal trigger to dependabot.yml

**Files:**

- Modify: `.github/dependabot.yml` (the `expo` `>=55.0.0` ignore block, ~lines 41-43)

- [ ] **Step 1: Insert the trigger comment**

Find this block:

```yaml
# Pinned to Expo SDK 54. A transitive CVE must NOT drag expo to a new SDK
# major (a multi-day native migration); fix such CVEs via `overrides`
# instead. Allow 54.x patches; block the SDK 55/56 jump. See PR #312.
- dependency-name: "expo"
  versions: [">=55.0.0"]
```

Replace it with (adds a NOTE; the `- dependency-name` entry is unchanged):

```yaml
# Pinned to Expo SDK 54. A transitive CVE must NOT drag expo to a new SDK
# major (a multi-day native migration); fix such CVEs via `overrides`
# instead. Allow 54.x patches; block the SDK 55/56 jump. See PR #312.
#
# NOTE: when you intentionally lift this SDK pin, re-evaluate the
# `overrides.postcss` pin in package.json. Check whether the new
# @expo/metro-config ships postcss >= 8.5.10 natively and, if so, DROP the
# override (then re-run `npm ls postcss`). The override is only a
# resolution floor — metro doesn't call postcss unless a postcss.config
# exists; lightningcss is the web CSS transformer. See the closure note in
# docs/solutions/best-practices (metro-postcss-gating-…).
- dependency-name: "expo"
  versions: [">=55.0.0"]
```

- [ ] **Step 2: Verify the YAML still parses**

Run: `node -e "const y=require('fs').readFileSync('.github/dependabot.yml','utf8'); const i=y.indexOf('overrides.postcss'); console.log(i>0 ? 'comment present, len='+y.length : 'MISSING')"`
Expected: `comment present, len=…`. (No YAML linter in repo; a `#` comment line cannot break parsing — this just confirms the edit landed and the file is readable.)

---

### Task 3: Close and archive the todo

**Files:**

- Modify then move: `todos/P3-2026-05-31-postcss-override-bundler-verify.md` → `todos/archive/P3-2026-05-31-postcss-override-bundler-verify.md`

- [ ] **Step 1: Check the AC boxes** — in the source file, change AC #1, #2, #4 from `- [ ]` to `- [x]`. Leave AC #3 as `- [ ]` (genuinely deferred). The four lines become:

```markdown
- [x] When `react-native-web` is added (web frontend work), run
      `npx expo export --platform web` and confirm the bundle builds with **no
      postcss-related errors** and CSS is emitted correctly.
```

```markdown
- [x] Re-run `npm ls postcss` and confirm every instance still resolves to
      ≥ 8.5.10 (the override survived any interim `expo`/metro-config patch).
```

```markdown
- [ ] On the next Expo SDK upgrade: check whether `@expo/metro-config` now ships
      postcss ≥ 8.5.10 natively. If so, **remove** the `overrides.postcss` entry
      in `package.json` (don't carry a now-redundant pin) and drop the matching
      note. Re-verify `npm ls postcss` afterward.
```

```markdown
- [x] Confirm the `expo >=55.0.0` ignore in `.github/dependabot.yml` is still the
      desired guard (remove/adjust if/when an intentional SDK upgrade happens).
```

(AC #1 is checked because it is resolved _by analysis_ — see the Updates entry, which makes the basis explicit. AC #3 stays open as a future SDK-upgrade trigger, now mirrored durably in dependabot.yml.)

- [ ] **Step 2: Append this Updates entry** under the `## Updates` section (after the `### 2026-06-01` block):

```markdown
### 2026-06-02

- **Closed (AC #1 satisfied by analysis).** Code-read of `@expo/metro-config@54.0.15`:
  a web export would not exercise postcss in this project regardless of
  `react-native-web`. `transform-worker.js → transformCss()` invokes postcss only via
  `transformPostCssModule()`, which early-returns `hasPostcss:false` when no
  `postcss.config.*` exists at the project root (none does; `resolvePostcssConfig` reads
  the project root, so installing react-native-web can't add one). The web CSS transformer
  is **lightningcss**. The `overrides.postcss` pin is a dependency-resolution floor, not a
  live bundler code path; its API compat is exercised every CI run via
  `vitest → vite → postcss@8.5.15`.
- **AC #2 passes:** `npm ls postcss` → 8.5.15 on both paths, single dedupe.
- **AC #4 confirmed:** `expo@54.0.34`; the `expo >=55.0.0` dependabot guard is still wanted.
- **AC #3 deferred; trigger made durable:** the override-removal reminder now lives as a
  comment in `.github/dependabot.yml` (edited whenever the SDK pin is lifted).
- Finding codified in `docs/solutions/best-practices/metro-postcss-gating-overrides-resolution-floor-2026-06-02.md`
  (local-only). Archiving this todo.
```

- [ ] **Step 3: Move to archive, preserving the content edit (avoids the `git mv` + lint-staged drop)**

```bash
git mv todos/P3-2026-05-31-postcss-override-bundler-verify.md todos/archive/
# content edits from Steps 1-2 were made on the old path; re-stage at the new path:
git add todos/archive/P3-2026-05-31-postcss-override-bundler-verify.md
git status --porcelain todos/
```

Expected: a single `R  todos/P3-…md -> todos/archive/P3-…md` (rename, with content edit folded in). If you see a separate `M` on the old path, re-run the `git add`.

---

### Task 4: Verify the evidence and commit the tracked changes

**Files:** none new — verification + commit of `.github/dependabot.yml` and the todo move.

- [ ] **Step 1: Re-confirm the recorded evidence is still true**

```bash
npm ls postcss
npm ls react-native-web
```

Expected: postcss `8.5.15` on both `expo→@expo/metro-config` and `vitest→vite` (deduped); react-native-web `(empty)`. If either differs, STOP and reconcile the Updates entry before committing.

- [ ] **Step 2: Confirm only the intended tracked paths changed**

```bash
git status --porcelain
```

Expected: exactly `M .github/dependabot.yml` and `R todos/P3-…md -> todos/archive/P3-…md`. The solution doc and spec must NOT appear (they are gitignored). If anything else appears, STOP — review before staging.

- [ ] **Step 3: Stage and commit on a feature branch (main is protected — no direct push)**

```bash
git switch -c docs/postcss-override-closure
git add .github/dependabot.yml todos/archive/P3-2026-05-31-postcss-override-bundler-verify.md
git commit -m "docs(deps): close postcss-override bundler-verify todo (resolved by analysis)

- AC #1 satisfied by analysis: metro routes web CSS through lightningcss;
  postcss only fires behind a postcss.config (absent). overrides.postcss is a
  resolution floor, not a live path. AC #2/#4 confirmed; AC #3 trigger moved to
  dependabot.yml. Finding codified locally in docs/solutions/best-practices.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Note: the pre-commit Kimi gate auto-skips (no `.ts/.tsx` staged); prettier (lint-staged) runs on the staged `.md`.

---

## Integration

`main` is protected (PRs only). After Task 4:

- [ ] Push the branch and open a PR (small: a `dependabot.yml` comment + a todo move). Use `superpowers:finishing-a-development-branch` to choose merge vs PR.
- [ ] Docs/todos PRs still run the **full CI gate** (~5-8 min; the `pull_request` trigger has no `paths-ignore`). Watch checks green, then squash-merge and delete the branch.
- [ ] After merge, the solution doc and this plan/spec remain only on your local disk (gitignored) — that is expected and intended.

**Worktree note:** the user often works in parallel in the main checkout. If that checkout may be dirty/active, execute this in an isolated worktree (`superpowers:using-git-worktrees`) instead of switching branches in the shared checkout. The solution doc lives in a gitignored dir, so write it in the MAIN checkout (gitignored dirs don't propagate into fresh worktrees).

---

## Self-Review

- **Spec coverage:** AC #1 (Task 3 Updates + Task 1 doc), AC #2 (Task 4 Step 1 + Task 3 box), AC #3 trigger (Task 2), AC #4 (Task 3 box). Deliverables 1-3 = Tasks 1-3. Out-of-scope items (no react-native-web / postcss.config / .css) enforced by Task 4 Step 2's `git status` gate. ✓
- **Placeholders:** none — solution doc, comment, Updates entry, and commit message are all literal. ✓
- **Consistency:** filename `metro-postcss-gating-overrides-resolution-floor-2026-06-02.md` and branch `docs/postcss-override-closure` are used identically across tasks; `git mv` ordering matches the lint-staged-drop guard. ✓
