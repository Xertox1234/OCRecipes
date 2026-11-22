# Drive Offload — Keep Big Rebuildable Files on U34Bolt

**Date:** 2026-11-20 · **Status:** approved approach, design awaiting owner approval · **Follows:** `2026-10-14-external-drive-design.md`

## 1. Intent

The internal disk filled up again (29 GB free of 228 GB on 2026-11-20). The 2026-10-14 work moved the big
build caches (npm, CocoaPods, Gradle, DerivedData, XcodeBuildMCP, Docker) to `/Volumes/U34Bolt`, but other tools'
caches kept growing on the laptop and nothing noticed. The owner wants big rebuildable files — builds, caches,
anything over 100 MB — to live on the drive, and to keep it that way without having to go looking.

**Success looks like:** the known remaining caches write to the drive; once a week the owner gets a short report of
anything new over 100 MB on the laptop, sorted into what was handled, what to delete, and what is just information;
the laptop still works with the drive unplugged.

## 2. Goals, non-goals, anti-goals

**Goals**

- Redirect the remaining tool caches that have a location setting to `_shared/caches/` (§4).
- A weekly, laptop-wide scan for anything ≥ 100 MB, with a notification and a written report (§5).
- Automatic handling only where it cannot hurt: clearing the laptop leftovers of caches that are already redirected (§5.3).

**Non-goals**

- Moving app data, toolchains, Homebrew, simulators, the Android SDK or Chrome's cache. These are reported only.
- Cleaning other projects' folders. The scan reports them; each project's own scripts act.

**Anti-goals — a failure even if it "works"**

- Anything that breaks a tool while the drive is unplugged, or leaves the laptop needing the drive to boot a build
  that worked before. (Xcode/XcodeBuildMCP/Docker already fail fast unplugged by design — §9 of the 2026-10-14 spec. Nothing new may join that list.)
- A mover that moves folders behind a running app, or leaves links that dangle when unplugged.
- Creating a phantom `/Volumes/U34Bolt` on the internal disk (only the `df -P` mount check, never `[ -d ]`).
- A noisy report the owner learns to ignore.

## 3. Constraints

- **Multiple projects share the drive** (OCRecipes, plant_id_community, flutter_chat and future ones). Layout rule
  unchanged: one folder per project at the top level, laptop-wide material under `_shared/`, nothing loose. Shared
  caches are redirected once, laptop-wide — never per project.
- **The drive README is the single source of truth** that every project's sessions read before writing to the drive.
  Every new redirect and the scanner get a section there.
- **Mount check:** `[ "$(df -P /Volumes/U34Bolt 2>/dev/null | awk 'NR==2{print $6}')" = /Volumes/U34Bolt ]` everywhere.
- **Environment variables only reach programs started from a shell.** GUI apps launched from the Dock/Finder don't
  read `~/.zshenv`. Measured 2026-11-20: `~/.npm` still holds 458 MB (`_cacache` 225 MB, `_npx` 223 MB) although
  `npm_config_cache` points at the drive. A redirect is therefore never assumed complete; the scan checks the old
  location (§5.2).
- **Change from the 2026-10-14 scope:** that spec left Flutter/Dart to the plant_id_community session. The owner
  approved (2026-11-20) redirecting the Flutter pub cache laptop-wide, as a `_shared` cache like Gradle.

## 4. Redirects (one-time setup)

### 4.1 Approaches considered

|     | Approach                                                                                | Trade-off                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Each tool's own location setting, set in the existing mount-guarded `~/.zshenv` pattern | Falls back to the laptop unplugged, no links. Only works for tools that have a setting. **Chosen.**                                                               |
| B   | Move the folder and leave a symlink                                                     | Works for any folder, but dangles unplugged and some tools replace a dangling link with a real folder, silently refilling the disk (seen with Xcode, 2026-10-14). |
| C   | A background mover for everything ≥ 100 MB                                              | Catches everything, but moves folders behind running apps and crosses into other projects' folders. Rejected by the owner.                                        |

Owner picked: report-only scan first (done 2026-11-20), then **A for redirects + the weekly scan with limited
automatic handling** (§5).

### 4.2 What gets redirected

New `~/.zshenv` block, same shape as the existing `>>> U34Bolt` block: set only when mounted, and the
stale-env guard extended to unset each one when unmounted and it points at the drive.

| Cache                  | Laptop size 2026-11-20 | Setting                                                                                  | Drive path                  |
| ---------------------- | ---------------------- | ---------------------------------------------------------------------------------------- | --------------------------- |
| pip                    | 0.30 GB                | `PIP_CACHE_DIR`                                                                          | `_shared/caches/pip`        |
| Flutter/Dart pub       | 2.03 GB                | `PUB_CACHE`                                                                              | `_shared/caches/pub`        |
| dotslash (RN DevTools) | 0.86 GB                | `DOTSLASH_CACHE`                                                                         | `_shared/caches/dotslash`   |
| pre-commit             | 0.20 GB                | `PRE_COMMIT_HOME`                                                                        | `_shared/caches/pre-commit` |
| SwiftPM                | 0.72 GB                | **builder verifies** whether a laptop-wide setting exists; if none, it stays report-only | `_shared/caches/swiftpm`    |

The builder confirms each variable name against the tool's current docs before use; a tool with no setting moves
to report-only rather than to a symlink.

**After switching `PUB_CACHE`:** Flutter projects resolve packages by absolute path (`.dart_tool/package_config.json`),
so each Flutter checkout needs `flutter pub get` once. The setup step lists the checkouts; it does not run it in
other projects' folders.

**Existing laptop copies (~4 GB) at setup** _(my call)_: the pub cache is **copied** to the drive first
(`~/.pub-cache/bin/` holds a globally activated `flutterfire`, and copying saves a re-download), then the laptop
copy is removed. pip, dotslash, pre-commit and SwiftPM laptop copies are deleted outright (pure download caches).
The owner runs the setup script; it prints `df` before and after.

**Unplugged:** a new shell falls back to each tool's default location, which starts empty, so the first unplugged
install downloads again. Same trade-off accepted for Gradle (2026-10-14).

`launchctl setenv` (so GUI apps also see the paths) is **not** used: it doesn't re-check the mount, so it would
keep pointing at the drive after unplugging. Refills from GUI apps are caught by the scan instead.

## 5. The weekly scan

### 5.1 Shape

- A laptop-wide script (builder's call on name; it lives outside any repo, next to `sandbox-run` under
  `~/.local/`), run weekly by a per-user `launchd` agent, also runnable by hand with a `--dry-run` flag.
- Writes a dated report to the drive when mounted (`_shared/disk-scan/`), else to `~/Library/Logs/disk-scan/`.
- Posts one macOS notification only when there is something new to act on: "Disk scan: 3 items to review (4.1 GB)".
- Never runs as root (keeps the no-phantom guarantee).
- **No Full Disk Access** (owner ruling 2026-11-20). Under `launchd` the scan can't read privacy-protected folders
  (Mail, Messages, Safari, some `~/Library/Containers`, Desktop, Documents, Downloads). It skips them without
  triggering permission prompts, and every report ends with a "Not scanned" list naming them. Its run time is
  measured again under `launchd`, because the spike's ~2 min came from a terminal that already had access.

The spike (`bigscan.sh`, 2026-11-20) proved the scan: ~2 min over home + `/opt/homebrew` + system simulator
folders. Lesson carried in: list a big file only when no listed folder already contains it (the spike double-counted).

### 5.2 Classes

| Class       | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Action                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **REFILL**  | A pure download cache's old laptop location regrew ≥ 100 MB. Fixed allowlist, cache subfolder only: `~/.npm/_cacache`, `~/Library/Caches/pip`, `~/Library/Caches/dotslash`, `~/.cache/pre-commit`, `~/Library/Caches/CocoaPods`, `~/.gradle/caches` (never `~/.gradle` itself — it can hold `gradle.properties` signing secrets and `init.d/`), SwiftPM's cache if redirected                                                                                                                                                           | Cleared automatically under §5.3                                             |
| **DELETE?** | Old laptop location of a redirected cache that is _live state_, not a download cache: `~/.pub-cache` (projects point into it by absolute path; a Dock-launched Android Studio/VS Code `pub get` writes there) and `~/.npm/_npx` (holds code of running `npx` MCP servers). Plus known leftovers: editor update staging (`~/Library/Caches/*.ShipIt`), `~/Library/Logs/CoreSimulator/*.prev.log`, old Claude Code versions in `~/.local/share/claude/versions` and editor extension dirs beyond the newest, old `.stryker-tmp/sandbox-*` | Suggested with the exact command; never automatic                            |
| **PROJECT** | Anything under `~/projects/<name>/` (node_modules, venvs, builds, worktrees)                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Reported per project, named so that project's session can act. Never touched |
| **INFO**    | App data, Homebrew, simulators, Android SDK, Chrome, the per-user temp folder (`$TMPDIR` under `/private/var/folders`), unknown                                                                                                                                                                                                                                                                                                                                                                                                         | Reported only                                                                |

Already-on-drive links and the drive itself are skipped. `/Applications` and `/Library` (other than
`/Library/Developer/CoreSimulator` and `/Library/Updates`) are not scanned _(my call: app bundles and system files
are not offload candidates)_.

**Quiet rule (all classes except REFILL)** _(my call)_: an item is listed in the full report every week, but it
counts toward the notification only the first time it crosses 100 MB or when it has grown ≥ 1 GB since it last
counted. The scan keeps a small state file of sizes per path next to its reports. Automatic REFILL clears appear
in the report but never trigger a notification on their own.

**Folder-selection rules carried from the spike** (`bigscan.sh`, 2026-11-20): measure one level inside
`~/Library/{Caches,Application Support,Developer,Android,Containers,Logs}`, `~/.cache` and each hidden top-level
folder of `~`; inside `~/projects` prune at `node_modules`, `build`, `.dart_tool`, `Pods`, `.gradle`, `venv`,
`.venv`, `worktrees`, `.worktrees`, `DerivedData`; single files `-size +100M` only when no listed folder contains
them; `du -x` / `find -xdev` so the drive is never measured.

### 5.3 What runs automatically (the only writes)

A REFILL location is deleted only when **all** hold: the drive is mounted (`df -P` check); the location is on the
§5.2 REFILL list (a fixed allowlist in the script, not a pattern); **no process has a file open under the path**
(`lsof +D <path>` returns nothing — a process-name check can't work, since Claude Code and MCP servers are node
processes that always run); and the path is not a symlink. Everything it deletes is logged in the report. `--dry-run` reports
what it would delete and deletes nothing. Nothing is ever moved.

## 6. Documentation

- Drive README: rows for each new `_shared/caches/*` path, a "Disk scan" section (what it does, where reports go,
  how to run it by hand, how to turn it off), and the GUI-app limitation.
- Global `~/.claude/CLAUDE.md` "External drive" section: one line pointing at the scan.
- Memory `project_external_drive_u34bolt.md`: append the new redirects and scan.

## 7. Verification

- Before/after `df -h /System/Volumes/Data` for the setup step.
- Each redirect: in a new shell, run the tool once and show its cache landed on the drive and the laptop path stayed empty.
- Unplugged: in a new shell with the drive ejected, each variable is unset and the tool still runs (falls back).
- Scan: a test with a fixture home (temp folders, one per class) checks classification and that the auto step
  deletes only allowlisted REFILL paths, skips when the drive is unmounted, and skips when a process has a file open under the path.
- First real run is `--dry-run`, shown to the owner, before the `launchd` agent is turned on.

## 8. Left to the builder

Script and agent names; exact weekly time; report format; the `lsof` timeout and performance handling; how "grown since last report"
is stored; whether SwiftPM has a usable setting (§4.2).
