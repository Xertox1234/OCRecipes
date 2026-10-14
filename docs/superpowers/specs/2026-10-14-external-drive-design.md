# External Drive (U34Bolt) — Free Internal Space and Keep It Free

**Date:** 2026-10-14 · **Status:** approved design, awaiting spec review · **Owner decisions:** recorded inline

## 1. Goal

The laptop's internal disk is 95% full (11 GB free of 228 GB, measured 2026-10-14). A 1 TB Thunderbolt
SSD (`/Volumes/U34Bolt`) is attached. Goal: free as much internal space as is safe for **OCRecipes and
laptop-wide caches**, and redirect the tools that refill the disk so the space stays free.

**Success criteria**

- Roughly 46 GB freed (11 GB → ~57 GB free), measured with `df -h /System/Volumes/Data` before and after each phase.
- New Xcode builds, npm/CocoaPods cache writes and ad-hoc OCRecipes worktrees land on the drive by default.
- With the drive unplugged, the laptop still opens the repo, runs tests and builds — nothing writes a phantom
  `/Volumes/U34Bolt` directory onto the internal disk.
- A Claude session in any other project can discover the drive layout without this session's memory.

## 2. Scope

**In scope:** OCRecipes ad-hoc worktrees and build output; laptop-wide npm/CocoaPods caches; Xcode DerivedData
location; removal of Docker Desktop and the Android emulator disk; erasing two iOS simulators; documentation.

**Out of scope (owner rulings 2026-10-14):**

- **Other projects' folders, Devin, Flutter/Dart, Windsurf** — each project runs its own session of this process.
  Houseplant-MD (`plant_id_community`) uses Devin and Flutter.
- **Android SDK, `~/.gradle`, Android Studio** — Flutter builds Android with them; the Houseplant-MD session decides.
- **`/todo` / `/todo-fast` worktrees** (`<main>/.claude/worktrees/agent-*`) — `guard-worktree-isolation.sh`
  derives the main checkout from that path segment and the harness is frozen (2026-09-22). They are short-lived
  and symlink `node_modules` to the main checkout, so they are small.
- **Main checkout, Postgres (`postgresql@18`), Redis, `~/.claude`** — stay internal. Hooks resolve
  `git rev-parse --show-toplevel` through symlinks and the memory dir is keyed to the checkout path; preflight
  refuses its stamp when Postgres is unreachable.

## 3. Drive format and layout

The drive arrived as **Journaled HFS+ with "ignore ownership" on**. Owner ruling: **erase and reformat to APFS
(case-insensitive)** — case-sensitive breaks Xcode/CocoaPods. Everything currently on it is regenerable:
`OCRecipes-cng2` (PR #1438) and `OCRecipes-e2epw` had 0 dirty files and 0 unpushed commits (checked 2026-10-14;
re-check immediately before erasing); `ocrecipes-build/` (27 GB) is build output.

After formatting: volume name `U34Bolt`, Spotlight indexing off (`sudo mdutil -i off /Volumes/U34Bolt`).

```
/Volumes/U34Bolt/
├── README.md                 layout + rules, readable by any project's session
├── OCRecipes/
│   ├── worktrees/            ad-hoc, long-lived OCRecipes worktrees
│   ├── build/xcodebuildmcp/  XcodeBuildMCP build output for OCRecipes (§4.2)
│   └── tmp/                  TMPDIR for big native builds — set per command, never globally
└── _shared/
    └── caches/
        ├── npm/
        ├── cocoapods/
        └── DerivedData/      Xcode build output for ALL projects (the Xcode setting is laptop-wide)
```

Rule: nothing loose at the top level — one folder per project, laptop-wide material under `_shared/`.

## 4. Redirection (Approach A — native per-tool config, mount-guarded)

Chosen over symlinking default locations (Xcode replaces a dangling symlink with a real directory, silently
refilling the disk) and over a one-time cleanup (DerivedData and worktrees regrow within weeks).

### 4.1 The mount predicate

"Is the drive mounted" is tested as **a separate filesystem**, never as "a directory exists":

```sh
[ "$(df -P /Volumes/U34Bolt 2>/dev/null | awk 'NR==2{print $6}')" = /Volumes/U34Bolt ]
```

i.e. "`/Volumes/U34Bolt` is itself a mount point". Measured 2026-10-14: the drive reports `/Volumes/U34Bolt`;
a plain directory under `/Volumes` reports `/System/Volumes/Data`; a missing path reports nothing. `df -P` is used
rather than `stat -f %d` because it behaves the same on Linux CI, where `oc-worktree`'s tests run.
A `[ -d /Volumes/U34Bolt/_shared ]` test passes exactly when the failure has already happened: a tool creates a
phantom `/Volumes/U34Bolt/...` on the internal disk, the check reads "mounted", every redirect then writes onto
the phantom, and the real drive mounts as `U34Bolt 1`. The `~/.zshenv` block and `oc-worktree` use this one
predicate. When the drive is **not** mounted but `/Volumes/U34Bolt` exists, the `~/.zshenv` block prints a one-line
"phantom U34Bolt on the internal disk — delete it before plugging in" warning (interactive shells only).

### 4.2 Redirects

| Tool                                                                                | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Unplugged behaviour                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm cache                                                                           | `export npm_config_cache=/Volumes/U34Bolt/_shared/caches/npm` in `~/.zshenv`, inside the §4.1 predicate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Block skipped → default `~/.npm`                                                                                                                                                                     |
| CocoaPods cache                                                                     | `export CP_CACHE_DIR=/Volumes/U34Bolt/_shared/caches/cocoapods` in the same block. Verified: CocoaPods 1.17.0 `lib/cocoapods/config.rb:119` reads `CP_CACHE_DIR` for the cache root (`CP_HOME_DIR` relocates `~/.cocoapods` specs, not the cache)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Block skipped → default `~/Library/Caches/CocoaPods`                                                                                                                                                 |
| XcodeBuildMCP build output (`~/Library/Developer/XcodeBuildMCP/workspaces`, 7.5 GB) | **The primary build path today** — Xcode's default DerivedData holds only 20 KB, and XcodeBuildMCP passes its own `-derivedDataPath`, so the Xcode setting below does not move it. Verified in XcodeBuildMCP 2.7.0: `sessionDefaults.derivedDataPath` in `.xcodebuildmcp/config.yaml` (file beats the `XCODEBUILDMCP_DERIVED_DATA_PATH` env var; per-session `session_set_defaults` beats both). An explicit path is used as-is, **not** scoped per project (`utils/derived-data-path.js:24-26`), so it must be OCRecipes' own folder — a laptop-wide `_shared` folder would mix OCRecipes' and Houseplant-MD's `Pods` build products. Set `/Volumes/U34Bolt/OCRecipes/build/xcodebuildmcp` in the committed `.xcodebuildmcp/config.yaml` | Not mount-aware (xcodebuild creates the path) — covered by the phantom warning                                                                                                                       |
| Xcode DerivedData (Xcode GUI and `expo run:ios`)                                    | `defaults write com.apple.dt.Xcode IDECustomDerivedDataLocation /Volumes/U34Bolt/_shared/caches/DerivedData`. `expo run:ios` passes no `-derivedDataPath` and finds the `.app` from `CONFIGURATION_BUILD_DIR` in the build log (`@expo/cli/build/src/run/ios/XcodeBuild.js:149`); its fallback regex requires `/Developer/Xcode/DerivedData/` in the path, so the verification build in §7 must install successfully                                                                                                                                                                                                                                                                                                                      | Not mount-aware — covered by the phantom warning. Plan probe first: point the setting at `/Volumes/Nope/dd`, run one build, observe whether `/Volumes/Nope` gets created, then remove it and restore |
| Ad-hoc worktrees                                                                    | New `scripts/oc-worktree.sh <branch>`: checks §4.1, `git worktree add /Volumes/U34Bolt/OCRecipes/worktrees/<slug>` (fires `.husky/post-checkout`, which links `.env*`), `npm ci`, then `scripts/declare-worktree.sh`. Each worktree carries its own `node_modules` (~1 GB) — the intended cost; `worktree-deps.sh` deliberately leaves ad-hoc worktrees to a clean install                                                                                                                                                                                                                                                                                                                                                                | Refuses to run, non-zero exit                                                                                                                                                                        |

`TMPDIR=/Volumes/U34Bolt/OCRecipes/tmp` is used per command for large native builds only. It is never exported
globally: the Claude scratchpad lives under `/private/tmp/claude-501`.

The 27 GB `ocrecipes-build/dd` on the drive today came from a manual `xcodebuild -derivedDataPath` run against
`ocrecipes-build/src` (a git-less copy of the repo, per `prebuild.log`) — not from any default location.

## 5. Removals, moves, pruning

Sizes measured with `du -sh` on 2026-10-14.

| Phase               | Item                                                                                                          | Action                                                                                                                                                                                                                                                                                                                                                                                      | Frees   |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 0 (before reformat) | `~/Library/Logs` (3.4 GB), `~/Library/Caches` (3.2 GB), XcodeBuildMCP `workspaces/*` (7.5 GB)                 | List the top entries of each first (re-download costs such as Playwright browsers or Homebrew downloads are named to the owner), then delete; all regenerable                                                                                                                                                                                                                               | ~14 GB  |
| 2                   | Docker Desktop: `/Applications/Docker.app` (2.0), `~/Library/Containers/com.docker.docker` (3.2), `~/.docker` | Uninstall with Docker's own uninstaller (`/Applications/Docker.app/Contents/MacOS/uninstall`), not `rm` — it owns the `/usr/local/bin/docker*` links and a privileged helper. Basis: no compose/devcontainer files in the repo; the only references are an allowlist entry (`.claude/settings.local.json:26`) and a test fixture string; `Docker.raw` last written 2026-09-05               | ~5.3 GB |
| 2                   | `~/.android/avd/Medium_Phone.avd` + `.ini`                                                                    | Delete. SDK system image `android-36.1/google_apis_playstore` stays, so it can be recreated offline in about a minute                                                                                                                                                                                                                                                                       | 11 GB   |
| 3                   | `OCRecipes-cng`, `OCRecipes-wt-inspired`, `OCRecipes-wt-inspired2` (internal; 0 dirty, 0 unpushed)            | `git worktree remove`. Mostly deletions, not recreations: `wt-inspired`'s branch merged as #1444, `cng` is detached at a stale commit. The plan lists a verdict per worktree                                                                                                                                                                                                                | ~3.4 GB |
| 3                   | `cng2` (#1438, open, waiting on the owner's phone test)                                                       | Recreate under `OCRecipes/worktrees/` (`git worktree prune` first; the old path vanishes with the reformat). `e2epw` (#1439, merged) is not recreated                                                                                                                                                                                                                                       | —       |
| 4                   | `~/.npm` (1.9), `~/Library/Caches/CocoaPods` (0.4)                                                            | Delete after redirect; refills on the drive                                                                                                                                                                                                                                                                                                                                                 | ~2.3 GB |
| 4                   | iOS simulators iPhone 17 (6.5 GB) and iPhone 17e (3.5 GB)                                                     | `xcrun simctl erase <udid>` — device kept, contents wiped. Basis (`simctl list -j` `lastBootedAt`): iPhone 17 Pro booted 2026-10-14 and is the simulator memory notes name as the working one; iPhone 17 last booted 2026-10-10; 17e 2026-10-04 (and a memory note records it as the stray second booted sim). No skill, agent or Maestro flow names either UDID. iPhone 17 Pro kept intact | ~10 GB  |

Phases: **0** relief → **1** reformat + layout → **2** removals → **3** worktrees → **4** redirect + cache/sim
prune → **5** docs. Each phase records `df -h` before and after.

**Owner-run steps:** `diskutil eraseDisk` and `sudo mdutil -i off` are typed by the owner (via `!`). Edits to the
global `~/.claude/CLAUDE.md`, if the self-modification gate blocks them, follow the staged-file + `cp` hand-off.

## 6. Documentation (for other projects' sessions)

- `/Volumes/U34Bolt/README.md` — layout, the per-project rule, the §4.1 predicate, every redirect and its setting.
- Global `~/.claude/CLAUDE.md` — short "External drive" section: drive name, README pointer, "check the drive is
  mounted (§4.1 predicate) before writing to it", do not put a project's live checkout or database on it.
- `docs/DEV_SETUP.md` — OCRecipes section: `oc-worktree`, per-command `TMPDIR`, what stays internal and why.
- Memory: one new note (layout + redirects + unplugged behaviour); update `project_cng_decision_deferred` (cng2
  path **and** its `TMPDIR=/Volumes/U34Bolt/tmp`, which becomes `OCRecipes/tmp`) and the simulator reference
  note (which simulators were erased).

## 7. Verification

- `df -h /System/Volumes/Data` before and after every phase; report the measured deltas, not the estimates above.
- `diskutil info /Volumes/U34Bolt` shows APFS, case-insensitive; `mdutil -s /Volumes/U34Bolt` shows indexing off.
- `npm config get cache` and `defaults read com.apple.dt.Xcode IDECustomDerivedDataLocation` show the drive paths.
- CocoaPods: one `pod install` in a worktree's `ios/`, then `_shared/caches/cocoapods` is non-empty and
  `~/Library/Caches/CocoaPods` is not recreated.
- One `expo run:ios` build installs and launches on the iPhone 17 Pro: a new `OCRecipes-*` entry appears under
  `_shared/caches/DerivedData`, none under `~/Library/Developer/Xcode/DerivedData`.
- XcodeBuildMCP: after one `build_sim`, its output lands under `OCRecipes/build/xcodebuildmcp` and
  `~/Library/Developer/XcodeBuildMCP/workspaces` gains no new OCRecipes entry.
- `oc-worktree` creates a test worktree (`git worktree list` shows the drive path), then remove it. With the
  predicate forced false (script's mount root pointed at a non-existent path), it exits non-zero and creates nothing.
- Unplugged check: with the drive ejected, a new shell shows `npm config get cache` = `~/.npm`; then
  `mkdir /Volumes/U34Bolt` (phantom) makes the warning print; remove the phantom before remounting.

## 8. Repo deliverables

Branch → PR: `scripts/oc-worktree.sh` (+ test), `docs/DEV_SETUP.md` section, this spec. Everything else is
machine configuration (`~/.zshenv`, `defaults`, the drive README, the global CLAUDE.md) and is not committed.

## 9. Risks

- **Reformat loses the drive's contents** — mitigated by re-checking 0 dirty / 0 unpushed for `cng2` and `e2epw`
  immediately before erasing, and confirming `ocrecipes-build/src` is a git-less build copy. Erasing is an
  owner-run step.
- **Xcode's setting is not mount-aware** — an Xcode build with the drive ejected may create a phantom
  `/Volumes/U34Bolt/...` on the internal disk. The §4.1 predicate keeps every other redirect off the phantom, and
  the warning tells the owner to delete it before remounting.
- **Moved data leaves Time Machine** — only regenerable data and pushed worktrees move, so nothing unique is affected.
