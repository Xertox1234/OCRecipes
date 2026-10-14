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

| Tool                                                                                | Mechanism                                                                                                                                                                                                | Unplugged behaviour                                                                                                           |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| npm cache                                                                           | `export npm_config_cache=/Volumes/U34Bolt/_shared/caches/npm` in `~/.zshenv`, inside `if [ -d /Volumes/U34Bolt/_shared ]`                                                                                | Block skipped → default `~/.npm`                                                                                              |
| CocoaPods cache                                                                     | `export CP_HOME_DIR=/Volumes/U34Bolt/_shared/caches/cocoapods` in the same block                                                                                                                         | Block skipped → default                                                                                                       |
| Xcode DerivedData                                                                   | `defaults write com.apple.dt.Xcode IDECustomDerivedDataLocation /Volumes/U34Bolt/_shared/caches/DerivedData`                                                                                             | Not self-guarding: `~/.zshenv` prints one warning line when the setting points at an unmounted path (interactive shells only) |
| XcodeBuildMCP build output (`~/Library/Developer/XcodeBuildMCP/workspaces`, 7.5 GB) | **Unverified:** first plan task checks whether XcodeBuildMCP accepts a derived-data path. If yes, point it at `_shared/caches/`. If no, a prune script removes stale `workspaces/*` entries — no symlink | Default location                                                                                                              |
| Ad-hoc worktrees                                                                    | New `scripts/oc-worktree.sh <branch>`: `git worktree add /Volumes/U34Bolt/OCRecipes/worktrees/<slug>`, runs `.husky/post-checkout` provisioning and `scripts/declare-worktree.sh`                        | Refuses to run, non-zero exit                                                                                                 |

`TMPDIR=/Volumes/U34Bolt/OCRecipes/tmp` is used per command for large native builds only. It is never exported
globally: the Claude scratchpad lives under `/private/tmp/claude-501`.

## 5. Removals, moves, pruning

Sizes measured with `du -sh` on 2026-10-14.

| Phase               | Item                                                                                                          | Action                                                                                                                | Frees   |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------- |
| 0 (before reformat) | `~/Library/Logs` (3.4 GB), `~/Library/Caches` (3.2 GB), XcodeBuildMCP `workspaces/*` (7.5 GB)                 | Inspect each target, then delete; all regenerable                                                                     | ~14 GB  |
| 2                   | Docker Desktop: `/Applications/Docker.app` (2.0), `~/Library/Containers/com.docker.docker` (3.2), `~/.docker` | Uninstall (owner ruling: not needed)                                                                                  | ~5.3 GB |
| 2                   | `~/.android/avd/Medium_Phone.avd` + `.ini`                                                                    | Delete. SDK system image `android-36.1/google_apis_playstore` stays, so it can be recreated offline in about a minute | 11 GB   |
| 3                   | `OCRecipes-cng`, `OCRecipes-wt-inspired`, `OCRecipes-wt-inspired2` (internal; all clean and pushed)           | `git worktree remove`, recreate under `OCRecipes/worktrees/` only if still needed                                     | ~3.4 GB |
| 3                   | `cng2` (#1438), `e2epw`                                                                                       | Recreate under `OCRecipes/worktrees/` (`git worktree prune` first; the old paths vanish with the reformat)            | —       |
| 4                   | `~/.npm` (1.9), `~/Library/Caches/CocoaPods` (0.4)                                                            | Delete after redirect; refills on the drive                                                                           | ~2.3 GB |
| 4                   | iOS simulators iPhone 17 (6.5 GB) and iPhone 17e (3.5 GB)                                                     | `xcrun simctl erase <udid>` — device kept, contents wiped. iPhone 17 Pro kept intact                                  | ~10 GB  |

Phases: **0** relief → **1** reformat + layout → **2** removals → **3** worktrees → **4** redirect + cache/sim
prune → **5** docs. Each phase records `df -h` before and after.

## 6. Documentation (for other projects' sessions)

- `/Volumes/U34Bolt/README.md` — layout, the per-project rule, every redirect and its setting.
- Global `~/.claude/CLAUDE.md` — short "External drive" section: drive name, README pointer, "check the drive
  is mounted before writing to it", do not put a project's live checkout or database on it.
- `docs/DEV_SETUP.md` — OCRecipes section: `oc-worktree`, per-command `TMPDIR`, what stays internal and why.
- Memory: one new note (layout + redirects + unplugged behaviour); update `project_cng_decision_deferred` (cng2
  path) and the simulator reference note (which simulators were erased).

## 7. Verification

- `df -h /System/Volumes/Data` before and after every phase; report the measured deltas, not the estimates above.
- `diskutil info /Volumes/U34Bolt` shows APFS, case-insensitive; `mdutil -s /Volumes/U34Bolt` shows indexing off.
- `npm config get cache` and `defaults read com.apple.dt.Xcode IDECustomDerivedDataLocation` show the drive paths.
- One `expo run:ios` build: a new `OCRecipes-*` entry appears under `_shared/caches/DerivedData`, and none
  appears under `~/Library/Developer/Xcode/DerivedData`.
- `oc-worktree` creates a test worktree (`git worktree list` shows the drive path), then remove it. With the drive
  path made unavailable (simulated by pointing the script's root at a non-existent path), it exits non-zero
  without creating anything.
- Unplugged check: in a new shell with the drive ejected, `npm config get cache` returns `~/.npm`, and the
  DerivedData warning prints.

## 8. Repo deliverables

Branch → PR: `scripts/oc-worktree.sh` (+ test), `docs/DEV_SETUP.md` section, this spec. Everything else is
machine configuration (`~/.zshenv`, `defaults`, the drive README, the global CLAUDE.md) and is not committed.

## 9. Risks

- **Reformat loses the drive's contents** — mitigated by the re-check of 0 dirty / 0 unpushed immediately before
  erasing. Erasing is a destructive, owner-confirmed step.
- **Xcode's setting is not mount-aware** — an Xcode build with the drive ejected may create
  `/Volumes/U34Bolt/_shared/...` on the internal disk. Mitigated by the shell warning; recovery is deleting that
  internal directory before remounting.
- **Moved data leaves Time Machine** — only regenerable data and pushed worktrees move, so nothing unique is affected.
