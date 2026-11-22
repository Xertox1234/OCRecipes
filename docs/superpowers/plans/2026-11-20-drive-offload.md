# Drive Offload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redirect the remaining tool caches to U34Bolt and add a weekly laptop-wide scan that reports anything ≥ 100 MB and clears only an exact allowlist of download-cache leftovers.

**Architecture:** A standalone tool in its own git repo at `~/.local/share/disk-scan/` (same pattern as `~/.local/share/sandbox-run/`): a bash `disk-scan` script with its path rules in `rules.sh`, a `setup` script for the one-time redirects, a `launchd` agent template, and a plain-bash test harness. Linked into `~/.local/bin`. Nothing lives in the OCRecipes repo except this plan and the spec.

**Tech Stack:** bash 3.2-compatible (macOS `/bin/bash`), `du`/`find`/`lsof`/`df`, `osascript` for notifications, `launchd`, `shellcheck`.

**Spec:** `docs/superpowers/specs/2026-11-20-drive-offload-design.md` (read it with this plan).

## Global Constraints

- Mount check, verbatim, everywhere: `[ "$(df -P /Volumes/U34Bolt 2>/dev/null | awk 'NR==2{print $6}')" = /Volumes/U34Bolt ]`. Never `[ -d ]`.
- Never run as root; never create anything under `/Volumes` when unmounted.
- Threshold 100 MB (`102400` KB). Notification re-count threshold: grown ≥ 1 GB (`1048576` KB) since last counted.
- No Full Disk Access. Skip privacy-protected folders silently; every report ends with a `Not scanned` list.
- `du -x` / `find -xdev` so the drive is never measured.
- Nothing is ever moved by the scan. The only write outside its own state/report files is deleting an allowlisted REFILL path (spec §5.3).
- bash 3.2: no associative arrays, no `mapfile`, no `${var,,}`.
- The owner runs `setup` and edits to `~/.zshenv` themselves; the implementer never runs `setup` for real or edits `~/.zshenv`.

## Review Focus

1. **Paths with spaces** (`~/Library/Application Support/...`) — classified and measured correctly, never word-split. Pinned in Task 2 (`fixture with spaces`).
2. **Phantom `/Volumes/U34Bolt` folder** (a directory that is not a mount point) — treated as unmounted: no auto-delete, report goes to the laptop. Pinned in Task 3 (`unmounted → no delete`) via the test mount override.
3. **A REFILL path that is a symlink** (e.g. into the drive) — skipped, never deleted through the link. Pinned in Task 3.
4. **A file held open under a REFILL path** — skipped and reported as "in use". Pinned in Task 3 (`open file → skip`).
5. **Two runs at once** (launchd fires while a manual run is going) — second run exits 0 with "already running", touches nothing. Pinned in Task 4 (`lock`).

---

### Task 1: Repo skeleton, tool settings check, test harness

**Files:**

- Create: `~/.local/share/disk-scan/{README.md,.gitignore,disk-scan,rules.sh,tests/run.sh}`
- Link: `~/.local/bin/disk-scan -> ~/.local/share/disk-scan/disk-scan`

**Interfaces:**

- Produces: env overrides every later task and test uses —
  `DISK_SCAN_HOME` (default `$HOME`), `DISK_SCAN_DRIVE` (default `/Volumes/U34Bolt`),
  `DISK_SCAN_STATE_DIR` (default `$HOME/Library/Application Support/disk-scan`),
  `DISK_SCAN_LOG_DIR` (default `$HOME/Library/Logs/disk-scan`),
  `DISK_SCAN_TEST_MOUNTED` (`1`/`0`; test-only, overrides the mount check when set),
  `DISK_SCAN_NO_NOTIFY=1` (suppresses `osascript`).
- Produces: `tests/run.sh` helpers in the `sandbox-run/tests/run.sh` style: `ok`, `bad`, `run` (sets `OUT`, `ERR`, `CODE`), `expect_code`, `expect_out_has`; a temp fixture home `FIX` removed on exit; exit 1 if any `FAIL`.

- [ ] **Step 1: Confirm each cache setting against current docs** (Context7 or the tool's docs): `PIP_CACHE_DIR`, `PUB_CACHE`, `DOTSLASH_CACHE`, `PRE_COMMIT_HOME`, and whether SwiftPM has any laptop-wide cache-location setting usable by `xcodebuild`/Xcode. Record findings in `README.md` → "Redirects". If SwiftPM has none, it is INFO only (spec §4.2) and drops from Tasks 3 and 5.
- [ ] **Step 2:** `git init`, `.gitignore` (`*.log`), `README.md` stub, `rules.sh` (empty functions), `disk-scan` printing usage for `--help` and exiting 2 on unknown flags. Flags: `--dry-run`, `--install-agent`, `--uninstall-agent`, `--help`.
- [ ] **Step 3: Write tests** `--help exits 0`, `unknown flag exits 2`. Run `bash tests/run.sh` → PASS. `shellcheck disk-scan rules.sh tests/run.sh` → clean.
- [ ] **Step 4: Commit** `feat: disk-scan skeleton and test harness`.

### Task 2: Scan and classify (report only)

**Files:** Modify `rules.sh`, `disk-scan`; Test `tests/run.sh`

**Interfaces:**

- Produces in `rules.sh`: `classify <abs path>` → prints one of `REFILL DELETE PROJECT INFO`; `refill_allowlist` → prints the REFILL paths (one per line, relative to `$DISK_SCAN_HOME`); `delete_hint <abs path>` → prints the suggested command for a DELETE item.
- Produces in `disk-scan`: `scan` → prints TSV lines `kb<TAB>class<TAB>path` for every unit ≥ 102400 KB, using the spike's folder-selection rules (spec §5.2 "Folder-selection rules"), skipping symlinks into the drive and files contained in an already-listed folder; `not_scanned` → prints protected folders it could not read.

Class rules (from spec §5.2): REFILL = exactly `.npm/_cacache`, `Library/Caches/pip`, `Library/Caches/dotslash`, `.cache/pre-commit`, `Library/Caches/CocoaPods`, `.gradle/caches` (+ SwiftPM if Task 1 found a setting). DELETE = `.pub-cache`, `.npm/_npx`, `Library/Caches/*.ShipIt`, `Library/Logs/CoreSimulator/*.prev.log`, `.local/share/claude/versions/*` except the newest, `.{vscode,windsurf,devin}/extensions/anthropic.claude-code-*` except the newest per editor, `projects/*/.stryker-tmp/sandbox-*`. PROJECT = anything under `projects/`. INFO = everything else, plus `$TMPDIR`'s parent, `/opt/homebrew`, `/Library/Developer/CoreSimulator`, `/Library/Updates`.

- [ ] **Step 1: Write failing tests** with a fixture home under `$FIX/home`. Sized fixtures are real 101 MB files (`dd if=/dev/zero of=<f> bs=1m count=101`); sparse files report ~0 with `du`, so they can't be used. Keep the number of sized fixtures small:
  - `classify REFILL`: `$FIX/home/.npm/_cacache` → `REFILL`; `$FIX/home/.gradle` → not `REFILL`.
  - `classify DELETE`: `.pub-cache`, `Library/Caches/com.microsoft.VSCode.ShipIt` → `DELETE`.
  - `classify PROJECT`: `projects/x/node_modules` → `PROJECT`.
  - `fixture with spaces`: a 101 MB folder at `Library/Application Support/Some App` appears once in `scan` output as `INFO` with the full path.
  - `under threshold skipped`: a 99 MB folder is absent.
  - `no double count`: a 101 MB file inside a listed 101 MB folder appears once.
  - `drive link skipped`: a symlink to `$DISK_SCAN_DRIVE/x` is absent.
  - `newest version kept`: with `versions/2.1.1` and `versions/2.1.2`, only `2.1.1` is `DELETE`.
- [ ] **Step 2:** Run `bash tests/run.sh` → the new tests FAIL.
- [ ] **Step 3: Implement** `classify`, `refill_allowlist`, `delete_hint` in `rules.sh` and `scan`, `not_scanned` in `disk-scan`. Version ordering with `sort -V`. Unreadable folders: catch `du`/`find` "Operation not permitted" on stderr and collect them for `not_scanned`; never prompt.
- [ ] **Step 4:** `bash tests/run.sh` → PASS; `shellcheck` clean.
- [ ] **Step 5: Commit** `feat: scan and classify big folders`.

### Task 3: Automatic REFILL clear

**Files:** Modify `disk-scan`; Test `tests/run.sh`

**Interfaces:**

- Consumes: `classify`, `refill_allowlist` (Task 2).
- Produces: `is_mounted` → exit 0/1 (the Global Constraints check, unless `DISK_SCAN_TEST_MOUNTED` is set); `clear_refill <abs path>` → prints `cleared<TAB>kb<TAB>path`, `in-use<TAB>kb<TAB>path`, or `skipped<TAB>reason<TAB>path`; in `--dry-run` prints `would-clear<TAB>kb<TAB>path` and deletes nothing.

Rule (spec §5.3), all must hold: `is_mounted`; path is in `refill_allowlist` (exact string match after resolving to `$DISK_SCAN_HOME/<entry>`); path is not a symlink; `lsof +D "<path>"` prints nothing; size ≥ 102400 KB.

- [ ] **Step 1: Write failing tests:**
  - `clears allowlisted`: mounted=1, 101 MB `.npm/_cacache` → `cleared`, folder gone.
  - `dry-run deletes nothing`: same with `--dry-run` → `would-clear`, folder present.
  - `unmounted → no delete`: mounted=0 → `skipped<TAB>drive not mounted`, folder present.
  - `symlink skipped`: `.npm/_cacache` is a symlink to a 101 MB folder → `skipped<TAB>symlink`, target intact.
  - `open file → skip`: `tail -f "$FIX/home/.npm/_cacache/f" &` holding it open → `in-use`, folder present; kill the tail after.
  - `gradle root never deleted`: 101 MB file at `.gradle/big.bin` plus `.gradle/gradle.properties`, no `.gradle/caches` → after a full run both files are present.
  - `DELETE class never auto-cleared`: 101 MB `.pub-cache` mounted=1 → present after a full run.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `is_mounted`, `clear_refill`. **Step 4:** Run → PASS; `shellcheck` clean.
- [ ] **Step 5: Commit** `feat: clear allowlisted cache leftovers`.

### Task 4: Report, quiet state, notification, lock

**Files:** Modify `disk-scan`; Test `tests/run.sh`

**Interfaces:**

- Consumes: `scan`, `not_scanned`, `clear_refill`, `is_mounted`.
- Produces: a report file `YYYY-MM-DD.txt` written to `$DISK_SCAN_DRIVE/_shared/disk-scan/reports/` when mounted, else `$DISK_SCAN_LOG_DIR/`; state file `$DISK_SCAN_STATE_DIR/state.tsv` with lines `path<TAB>last_counted_kb`; stdout last line `disk-scan: N to review (X.X GB) — report: <path>`.

Report sections in order: `Cleared automatically`, `Suggested deletes` (with `delete_hint`), `Projects` (grouped by project name), `Info`, `Not scanned`. Notify-count rule (spec §5.2 quiet rule): a non-REFILL item counts when it is not in `state.tsv`, or `kb - last_counted_kb ≥ 1048576`; when it counts, its `last_counted_kb` is updated. REFILL clears never count. Notify (`osascript -e 'display notification "<N> items to review (<X.X> GB)" with title "Disk scan"'`) only when the count > 0 and `DISK_SCAN_NO_NOTIFY` unset. Lock: `mkdir "$DISK_SCAN_STATE_DIR/lock"`; on failure print `disk-scan: already running` and exit 0; remove on exit via `trap`.

- [ ] **Step 1: Write failing tests:**
  - `report to laptop when unmounted`: mounted=0 → report under `$DISK_SCAN_LOG_DIR`, none under the drive dir.
  - `report to drive when mounted`: mounted=1 with `DISK_SCAN_DRIVE=$FIX/drive` → report under `$FIX/drive/_shared/disk-scan/reports/`.
  - `first run counts, second is quiet`: one 101 MB INFO item → run 1 last line says `1 to review`; run 2 says `0 to review`.
  - `growth re-counts`: rewrite that item's `last_counted_kb` in `state.tsv` to (its size − 1048576) → next run says `1 to review`. (Simulates 1 GB of growth without writing 1 GB.)
  - `report has Not scanned section`: report contains a line `Not scanned`.
  - `lock`: create the lock dir first → run exits 0, stdout has `already running`, no report written.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; `shellcheck` clean.
- [ ] **Step 5: Commit** `feat: report, quiet state, notification, lock`.

### Task 5: One-time setup (redirects)

**Files:** Create `setup`, `zshenv-block.sh`; Test `tests/run.sh`

**Interfaces:**

- Produces: `zshenv-block.sh` — the text block, between markers `# >>> U34Bolt caches 2 (disk-scan) >>>` and `# <<< U34Bolt caches 2 <<<`, that sets `PIP_CACHE_DIR`, `PUB_CACHE`, `DOTSLASH_CACHE`, `PRE_COMMIT_HOME` to `/Volumes/U34Bolt/_shared/caches/{pip,pub,dotslash,pre-commit}` only when mounted, and when unmounted unsets each one whose value starts with `/Volumes/U34Bolt/`.
- Produces: `setup [--zshenv <file>] [--dry-run]` → refuses (exit 1) unless mounted; appends the block to the zshenv file only if the start marker is absent (idempotent); creates the four drive folders; copies `~/.pub-cache` to the drive pub folder with `rsync -a` then removes the laptop copy only if rsync exit is 0; deletes the laptop pip/dotslash/pre-commit caches; prints `df -h /System/Volumes/Data` before and after; lists Flutter checkouts (`find ~/projects -name pubspec.yaml -maxdepth 4`) with "run `flutter pub get` here".

- [ ] **Step 1: Write failing tests** (all against `$FIX`, `--zshenv "$FIX/zshenv"`, mounted override):
  - `block appended once`: run setup twice → marker appears exactly once.
  - `block mounted`: `DISK_SCAN_TEST_MOUNTED` cannot reach zsh, so test the block by sourcing it in `zsh -f` with the mount check swapped for `true`/`false` via `sed` on a copy → mounted sets `PUB_CACHE=/Volumes/U34Bolt/_shared/caches/pub`; unmounted with an inherited `PUB_CACHE=/Volumes/U34Bolt/x` unsets it and keeps an inherited `PIP_CACHE_DIR=/elsewhere`.
  - `refuses unmounted`: mounted=0 → exit 1, zshenv untouched.
  - `pub copied before delete`: `$FIX/home/.pub-cache/bin/flutterfire` ends up at `$FIX/drive/_shared/caches/pub/bin/flutterfire` and the laptop copy is gone.
  - `dry-run changes nothing`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; `shellcheck` clean.
- [ ] **Step 5: Commit** `feat: one-time cache redirect setup`.

### Task 6: launchd agent

**Files:** Create `local.disk-scan.plist.template`; Modify `disk-scan`; Test `tests/run.sh`

**Interfaces:**

- Produces: `--install-agent [--agents-dir <dir>]` writes `local.disk-scan.plist` (Label `local.disk-scan`, ProgramArguments `/bin/bash <abs path to disk-scan>`, `StartCalendarInterval` Weekday 0 Hour 10 Minute 0, stdout/stderr to `$DISK_SCAN_LOG_DIR/agent.log`) to `~/Library/LaunchAgents` (or `--agents-dir`), then `launchctl bootstrap gui/$(id -u)` unless `--agents-dir` is given; `--uninstall-agent` bootouts and removes it.

- [ ] **Step 1: Write failing test** `plist valid`: `--install-agent --agents-dir "$FIX/la"` → `plutil -lint` passes, `plutil -extract Label raw` = `local.disk-scan`, Weekday = `0`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: weekly launchd agent`.

### Task 7: Docs and owner hand-off

**Files:** Modify `~/.local/share/disk-scan/README.md`, `/Volumes/U34Bolt/README.md`, `~/.claude/CLAUDE.md` (External drive section, one line), memory `project_external_drive_u34bolt.md`.

- [ ] **Step 1:** Tool README: what it does, flags, classes, allowlist, the GUI-app limitation, how to turn the agent off, test command.
- [ ] **Step 2:** Drive README Layout rows: `_shared/caches/{pip,pub,dotslash,pre-commit}` (and `swiftpm` if Task 1 found a setting), `_shared/disk-scan/reports/`; Unplugged note: these fall back like npm.
- [ ] **Step 3:** Global CLAUDE.md line: `disk-scan` exists, weekly, report-only except the REFILL allowlist; README path. Append the new redirects and the scan to memory `project_external_drive_u34bolt.md`.
- [ ] **Step 4:** Commit the tool repo `docs: README`. Hand the owner, in this order: (a) `disk-scan --dry-run` output to look at; (b) `~/.local/share/disk-scan/setup` to run themselves, then open a NEW terminal tab; (c) `flutter pub get` in each listed Flutter checkout; (d) `disk-scan --install-agent` once they're happy.
- [ ] **Step 5: Live verification (with the owner):** in a new tab, `echo $PIP_CACHE_DIR $PUB_CACHE` → drive paths; `pip download --no-deps six -d /tmp/x` → `_shared/caches/pip` grew, `~/Library/Caches/pip` absent; `launchctl print gui/$(id -u)/local.disk-scan` shows the agent; first agent run's `Not scanned` list and run time recorded in the tool README.
