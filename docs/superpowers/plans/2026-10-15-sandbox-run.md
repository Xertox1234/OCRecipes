# sandbox-run Implementation Plan

> **STATUS: LOCAL MACHINE SETUP — not verifiable from the repo.** This plan builds a tool under `~/.local/share/` on the owner's Mac, outside this repo. Don't act on it in a cloud session; ask the owner whether it was built.

> References below to memory files (names like `project_*.md`, `feedback_*`, `reference_*`, `user_*`) point at the owner's local agent memory, which cloud sessions can't read. Lasting decisions from it are in `docs/OWNER_RULINGS.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `sandbox-run` / `sandbox-net` / `sandbox-build` — one bash script that runs a command in a locked-down,
throwaway Docker container for Claude Code and its agents.

**Architecture:** One bash script in its own local git repo (`~/.local/share/sandbox-run/`), called through three
symlinks; the name it is called by picks the mode. It checks everything first (drive, Docker, folder allowlist,
options), then `docker create` + `docker start -a` with fixed lock-down flags, hides secret files with empty
read-only mounts, kills the box at a time limit, and records each run under `/Volumes/U34Bolt/_shared/sandbox/runs/`.
Integration tests (`tests/run.sh`) start real boxes; every "blocked" check has a control that must succeed.

**Tech Stack:** bash 5 (`/opt/homebrew/bin/bash`, first `bash` on PATH), Docker Desktop 4.95 / engine 29.8.2,
image `node:24-bookworm-slim` pinned by digest.

**Spec:** `docs/superpowers/specs/2026-10-15-sandbox-run-design.md` (OCRecipes repo) — read it before Task 1.

## Global Constraints

- Repo: `~/.local/share/sandbox-run/` — local git only, never pushed. Commits: message via a file + `git commit -F`,
  ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Image tag `sandbox-run:1`; box user uid/gid `1000:1000`, named `sandbox`; no `sudo` in the image.
- Drive: `/Volumes/U34Bolt`; mount check ONLY `[ "$(df -P "$DRIVE" 2>/dev/null | awk 'NR==2{print $6}')" = "$DRIVE" ]`.
- Run folders: `/Volumes/U34Bolt/_shared/sandbox/runs/<YYYYMMDD-HHMMSS>-<6 hex>/` holding `out/` (the box's `/out`),
  `run.log`, `.empty`. Locks: `/Volumes/U34Bolt/_shared/sandbox/locks/`.
- Folder allowlist (hard-coded, never derived from an env var): strictly inside `~/projects/`, `~/Downloads/`,
  `/Volumes/U34Bolt/`, `/private/tmp/claude-501/`.
- Every run: `--network none` (sandbox-run) / default bridge (sandbox-net), `--user 1000:1000`, `--cap-drop ALL`,
  `--security-opt no-new-privileges`, `--read-only`, `--memory 2g` (override `--memory`), `--cpus 4`,
  `--pids-limit 512`, `--init`, `--name sandbox-<run id>`, removed afterwards.
- Env in the box: only `HOME=/home/sandbox`, `TERM`, `CI=1`, `PYTHONDONTWRITEBYTECODE=1`, `npm_config_cache=/npm-cache`
  (plus the image's own `PATH`/`NODE_VERSION`). Never the host env.
- tmpfs: `/tmp` 1 GB exec-allowed mode 1777; `/home/sandbox` 256 MB uid/gid 1000.
- Runner's own failures: exit **125**, message on stderr starting `sandbox-run: `. Timeout: exit **124**. Otherwise the
  command's own exit code.
- `--timeout` default `10m`, clock starts once the box is running. `--prune` removes run folders older than 14 days.
- Never mounted: Docker socket, `~/.ssh`, shell config, the home folder.

## Review Focus

1. **A folder path with spaces** (`~/Downloads/My Repo`) — must run normally. Test in Task 3.
2. **A secret file or `--dir` path containing a comma or a double quote** — Docker's `--mount` cannot carry it, so the
   run must REFUSE (exit 125), never run with that secret visible. Tests in Tasks 2 and 4.
3. **Secrets under less obvious names or behind a symlink** (`prod.env`, `.env.local` → `server/real-secret.txt`) —
   must read empty. Test in Task 4.
4. **A symlink `--dir` that points outside the allowlist** (`<allowed>/lib-link` → `~/Library`) — must be refused
   (the real path is checked). Test in Task 2.
5. **The script killed mid-run** (agent cancelled, Ctrl-C) — the box must be removed and any dependency lock released.
   Tests in Tasks 5 and 6.

Not covered by an automated test: the "image missing" message (testing it would mean deleting the image mid-suite).
It is one `docker image inspect` line in Task 2; check it by eye in review.

---

## File map

| File (in `~/.local/share/sandbox-run/`) | Responsibility                                                            |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `sandbox-run`                           | the whole CLI (mode by name, checks, run, secrets, timer, volumes, prune) |
| `image/Dockerfile`                      | the box image                                                             |
| `tests/run.sh`                          | integration tests (needs drive + Docker)                                  |
| `README.md`                             | usage, the locks, known limits                                            |
| `~/.local/bin/sandbox-{run,net,build}`  | symlinks to `sandbox-run` (Task 7)                                        |

---

### Task 1: Repo, image and `sandbox-build`

**Files:**

- Create: `~/.local/share/sandbox-run/sandbox-run`, `image/Dockerfile`, `tests/run.sh`, `.gitignore`

**Interfaces:**

- Produces: script constants `IMAGE`, `DRIVE`, `SHARED`, `RUNS`, `LOCKS`, `REPO`, `MODE`; functions `die`,
  `drive_mounted`, `preflight`; test helpers `run`, `ok`, `bad`, `expect_code`, `expect_out`, `expect_err_has`,
  `rundir`, variables `BIN`, `FIX`, `OUT`, `ERR`, `CODE`.

- [ ] **Step 1: Create the repo and the test harness with the image tests**

```bash
mkdir -p ~/.local/share/sandbox-run/{image,tests} && cd ~/.local/share/sandbox-run && git init -q && printf '.DS_Store\n' > .gitignore
```

`tests/run.sh`:

```bash
#!/usr/bin/env bash
# Integration tests for sandbox-run. Needs U34Bolt mounted and Docker Desktop running.
# Every "must fail" check has a control that must succeed — a box that can do nothing would pass the rest.
set -o pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
BIN="$(mktemp -d)"
for n in sandbox-run sandbox-net sandbox-build sandbox-other; do ln -s "$REPO/sandbox-run" "$BIN/$n"; done
mkdir -p /private/tmp/claude-501
FIX="$(mktemp -d /private/tmp/claude-501/sandbox-run-tests.XXXXXX)"
trap 'rm -rf "$BIN" "$FIX"' EXIT
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL - $1"; [ -n "$2" ] && echo "       $2"; }
# run [VAR=value…] <command name> <args…>  → sets OUT, ERR, CODE
run() {
  local envs=()
  while [[ "$1" == *=* ]]; do envs+=("$1"); shift; done
  local n="$1"; shift
  OUT="$(env "${envs[@]}" "$BIN/$n" "$@" 2>"$FIX/.err")"; CODE=$?
  ERR="$(cat "$FIX/.err")"
}
expect_code()    { [ "$CODE" = "$2" ] && ok "$1" || bad "$1" "expected exit $2, got $CODE; stderr: $ERR"; }
expect_out()     { [ "$OUT" = "$2" ] && ok "$1" || bad "$1" "expected stdout '$2', got '$OUT'; stderr: $ERR"; }
expect_err_has() { case "$ERR" in *"$2"*) ok "$1" ;; *) bad "$1" "stderr lacks '$2': $ERR" ;; esac; }
rundir()         { printf '%s\n' "$ERR" | sed -n 's/^sandbox-run: run folder //p' | tail -1; }

# ---------- Task 1: image ----------
run sandbox-build
expect_code "sandbox-build builds the image" 0
docker image inspect sandbox-run:1 >/dev/null 2>&1 && ok "image sandbox-run:1 exists" || bad "image sandbox-run:1 exists"
u="$(docker run --rm --network none sandbox-run:1 id -u 2>&1)"
[ "$u" = 1000 ] && ok "image user is uid 1000" || bad "image user is uid 1000" "got $u"
t="$(docker run --rm --network none sandbox-run:1 sh -c 'for c in node python3 git curl nc ip; do command -v $c >/dev/null && echo $c; done' | wc -l | tr -d ' ')"
[ "$t" = 6 ] && ok "image has node python3 git curl nc ip" || bad "image has node python3 git curl nc ip" "found $t of 6"
s="$(docker run --rm --network none sandbox-run:1 sh -c 'command -v sudo || echo none')"
[ "$s" = none ] && ok "image has no sudo" || bad "image has no sudo" "got $s"

# ---------- summary ----------
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
```

`chmod +x tests/run.sh`. New test sections are inserted above the `# ---------- summary ----------` line in later tasks.

- [ ] **Step 2: Run it — must fail**

Run: `~/.local/share/sandbox-run/tests/run.sh`
Expected: FAIL lines (the script does not exist yet; `sandbox-build` exit 126/127).

- [ ] **Step 3: Pin the base image digest**

Run: `docker buildx imagetools inspect node:24-bookworm-slim --format '{{json .Manifest.Digest}}'`
Expected: a `"sha256:…"` value. Use it as `<DIGEST>` below (this step needs internet once).

- [ ] **Step 4: Write `image/Dockerfile`**

```dockerfile
# The sandbox-run box. Rebuild with `sandbox-build` (asks first — it downloads).
FROM node:24-bookworm-slim@<DIGEST>
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 git curl ca-certificates netcat-openbsd iproute2 \
 && rm -rf /var/lib/apt/lists/* \
 && usermod -l sandbox -d /home/sandbox node \
 && groupmod -n sandbox node \
 && mkdir -p /home/sandbox /work /out /npm-cache \
 && chown 1000:1000 /home/sandbox /npm-cache
# No ENTRYPOINT: the node image's entrypoint turns an unknown command into `node <command>`.
ENTRYPOINT []
CMD ["bash"]
USER 1000:1000
WORKDIR /work
```

(The node image already has user `node` with uid 1000; it is renamed, not duplicated.)

- [ ] **Step 5: Write the script skeleton with build mode**

`sandbox-run`:

```bash
#!/usr/bin/env bash
# sandbox-run / sandbox-net / sandbox-build — run one command in a locked-down Docker box.
# The mode comes from the name this script is called by (three symlinks in ~/.local/bin).
# Spec: ~/projects/OCRecipes/docs/superpowers/specs/2026-10-15-sandbox-run-design.md
set -o pipefail

IMAGE="sandbox-run:1"
# Tests point SANDBOX_DRIVE at a fake path. It only moves the drive check and the runs folder —
# the folder allowlist is hard-coded and never follows it.
DRIVE="${SANDBOX_DRIVE:-/Volumes/U34Bolt}"
SHARED="$DRIVE/_shared/sandbox"
RUNS="$SHARED/runs"
LOCKS="$SHARED/locks"
REPO="$(cd "$(dirname "$(realpath "$0")")" && pwd -P)"
MODE="$(basename "$0")"

die() { echo "sandbox-run: $*" >&2; exit 125; }

drive_mounted() { [ "$(df -P "$DRIVE" 2>/dev/null | awk 'NR==2{print $6}')" = "$DRIVE" ]; }

preflight() {
  drive_mounted || die "U34Bolt is not mounted — plug it in."
  docker info >/dev/null 2>&1 || die "Docker Desktop is not running — open it."
}

if [ "$MODE" = sandbox-build ]; then
  [ $# -eq 0 ] || die "sandbox-build takes no arguments."
  preflight
  exec docker build -t "$IMAGE" "$REPO/image"
fi

die "unknown command name '$MODE' — call it as sandbox-run, sandbox-net or sandbox-build."
```

`chmod +x sandbox-run`

- [ ] **Step 6: Run the tests — must pass**

Run: `~/.local/share/sandbox-run/tests/run.sh`
Expected: `5 passed, 0 failed`.

- [ ] **Step 7: Commit**

Write the message to the scratchpad (`feat: repo, box image and sandbox-build` + trailer), then
`git add -A && git commit -q -F <msgfile>`.

---

### Task 2: Options, folder allowlist and every refusal

**Files:**

- Modify: `sandbox-run` (replace the final `die "unknown command name…"` line)
- Modify: `tests/run.sh` (new section)

**Interfaces:**

- Consumes: `die`, `drive_mounted`, `preflight`, `IMAGE`.
- Produces: variables `NET` (0/1), `REAL` (resolved `--dir`), `KEEP_SET` (0/1), `KEEP` (volume suffix), `SECS`
  (timeout seconds), `MEMORY`, `PRUNE` (0/1); positional `"$@"` = the command; functions `to_seconds`, `check_dir`,
  `check_mountable`; array `ALLOWED_ROOTS`.

- [ ] **Step 1: Add the failing tests** (above the summary line)

```bash
# ---------- Task 2: options, allowlist, refusals ----------
mkdir -p "$FIX/proj/server" "$FIX/proj/node_modules" "$FIX/plain" "$FIX/My Repo" "$FIX/a,b"
echo hello > "$FIX/proj/hello.txt"; echo app > "$FIX/proj/server/app.txt"; echo hi > "$FIX/My Repo/hi.txt"
ln -s "$HOME/Library" "$FIX/lib-link"

run sandbox-run --dir "$FIX/proj" -- true
expect_code "control: a valid offline call runs" 0
run sandbox-run --net --dir "$FIX/proj" -- true
expect_code "sandbox-run refuses --net" 125; expect_err_has "…and points to sandbox-net" "sandbox-net"
run sandbox-run --dir "$FIX/proj" --net -- true
expect_code "sandbox-run refuses --net in any position" 125
run sandbox-run --dir "$FIX/proj" --network=bridge -- true
expect_code "sandbox-run refuses --network=…" 125
run sandbox-net --net --dir "$FIX/proj" -- true
expect_code "sandbox-net refuses a --net flag too" 125
run sandbox-run --dir "$FIX/proj" true
expect_code "a command without -- is refused" 125
run sandbox-run --dir "$FIX/proj"
expect_code "no command is refused" 125
run sandbox-other --dir "$FIX/proj" -- true
expect_code "an unknown command name is refused" 125
for d in "$HOME" "$HOME/Library/Application Support" /Volumes/U34Bolt "$HOME/projects" / "$FIX/lib-link"; do
  run sandbox-run --dir "$d" -- true
  expect_code "allowlist refuses --dir $d" 125
done
run sandbox-run --dir "$FIX/a,b" -- true
expect_code "a --dir with a comma is refused" 125
run sandbox-run --timeout 5x --dir "$FIX/proj" -- true
expect_code "a bad --timeout is refused" 125
run sandbox-run --timeout 0 --dir "$FIX/proj" -- true
expect_code "a zero --timeout is refused" 125
run sandbox-run --memory lots --dir "$FIX/proj" -- true
expect_code "a bad --memory is refused" 125
run sandbox-run --keep-deps --dir "$FIX/plain" -- true
expect_code "--keep-deps without node_modules is refused" 125; expect_err_has "…and says why" "node_modules"
run SANDBOX_DRIVE=/Volumes/NoSuchDrive sandbox-run --dir "$FIX/proj" -- true
expect_code "drive unplugged → refused" 125; expect_err_has "…with 'plug it in'" "plug it in"
run DOCKER_HOST=unix:///nonexistent/docker.sock sandbox-run --dir "$FIX/proj" -- true
expect_code "Docker down → refused" 125; expect_err_has "…with 'open it'" "open it"
```

- [ ] **Step 2: Run — must fail**

Run: `tests/run.sh`
Expected: the control and most Task 2 checks FAIL (every call currently dies "unknown command name", so the
refusals pass by accident but the control `expect_code … 0` fails — that is the point of the control).

- [ ] **Step 3: Implement** — replace the final `die "unknown command name…"` line with:

```bash
USAGE="usage: $MODE [--dir <folder>] [--keep-deps [<name>]] [--timeout <dur>] [--memory <size>] -- <command…>
       $MODE --prune"

NET=0
case "$MODE" in
  sandbox-run) ;;
  sandbox-net) NET=1 ;;
  *) die "unknown command name '$MODE' — call it as sandbox-run, sandbox-net or sandbox-build." ;;
esac

# Strictly inside one of these (after resolving symlinks). Hard-coded on purpose.
ALLOWED_ROOTS=("$HOME/projects/" "$HOME/Downloads/" "/Volumes/U34Bolt/" "/private/tmp/claude-501/")
check_dir() {
  local p="$1/" root
  for root in "${ALLOWED_ROOTS[@]}"; do
    [[ "$p" == "$root"?* ]] && return 0
  done
  die "refusing --dir $1: only folders inside ~/projects, ~/Downloads, a folder on U34Bolt, or /private/tmp/claude-501 may be mounted."
}
# Docker's --mount value is comma-separated and quote-aware: a path with either cannot be mounted safely.
check_mountable() { case "$1" in *,*|*\"*) die "refusing to run: '$1' contains a comma or a double quote, which Docker mounts cannot carry." ;; esac; }

to_seconds() {
  [[ "$1" =~ ^([0-9]+)([smh]?)$ ]] || return 1
  local n=$((10#${BASH_REMATCH[1]}))
  [ "$n" -gt 0 ] || return 1
  case "${BASH_REMATCH[2]}" in h) echo $((n*3600)) ;; m) echo $((n*60)) ;; *) echo "$n" ;; esac
}

DIR="$PWD"; KEEP=""; KEEP_SET=0; TIMEOUT="10m"; MEMORY="2g"; PRUNE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --) shift; break ;;
    --dir) [ $# -ge 2 ] || die "--dir needs a folder."; DIR="$2"; shift 2 ;;
    --keep-deps)
      KEEP_SET=1
      if [ $# -ge 2 ] && [ "${2#-}" = "$2" ]; then KEEP="$2"; shift 2; else shift; fi ;;
    --timeout) [ $# -ge 2 ] || die "--timeout needs a duration like 90s, 10m or 1h."; TIMEOUT="$2"; shift 2 ;;
    --memory) [ $# -ge 2 ] || die "--memory needs a size like 2g."; MEMORY="$2"; shift 2 ;;
    --prune) PRUNE=1; shift ;;
    --net|--network|--network=*|--internet|--build)
      die "$1 is not accepted — use sandbox-net for internet (it asks first) or sandbox-build to build the image." ;;
    *) die "unknown option '$1' — the command goes after --.
$USAGE" ;;
  esac
done

if [ "$PRUNE" = 1 ]; then
  die "--prune is not implemented yet."   # replaced in Task 3
fi

[ $# -gt 0 ] || die "no command given.
$USAGE"
SECS="$(to_seconds "$TIMEOUT")" || die "--timeout '$TIMEOUT' is not a duration like 90s, 10m or 1h."
[[ "$MEMORY" =~ ^[0-9]+[mg]$ ]] || die "--memory '$MEMORY' is not a size like 512m or 4g."
[ -d "$DIR" ] || die "--dir $DIR is not a folder."
REAL="$(cd "$DIR" && pwd -P)"
check_dir "$REAL"
check_mountable "$REAL"
if [ "$KEEP_SET" = 1 ]; then
  [ -d "$REAL/node_modules" ] || die "--keep-deps needs a node_modules folder in $REAL (a read-only folder cannot gain one). Create an empty one first: mkdir \"$REAL/node_modules\""
  if [ -z "$KEEP" ]; then
    KEEP="dir-$(printf '%s' "$(basename "$REAL")" | tr -c 'A-Za-z0-9_.-' '-')-$(printf '%s' "$REAL" | shasum | cut -c1-8)"
  fi
  [[ "$KEEP" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "--keep-deps name '$KEEP' may only use letters, digits, '.', '_' and '-'."
fi
preflight
docker image inspect "$IMAGE" >/dev/null 2>&1 || die "the box image $IMAGE is missing — run sandbox-build once (needs internet)."

exit 0   # replaced in Task 3 by the run itself
```

- [ ] **Step 4: Run — must pass**

Run: `tests/run.sh` → Expected: `0 failed`.

- [ ] **Step 5: Commit** — `feat: options, folder allowlist and refusals`.

---

### Task 3: The run — mounts, locks, env, exit codes, run.log, prune

**Files:** Modify `sandbox-run` (replace the `--prune` stub and the final `exit 0`); Modify `tests/run.sh`.

**Interfaces:**

- Consumes: everything Task 2 produces.
- Produces: `ID`, `NAME` (`sandbox-$ID`), `RUNDIR`, array `ARGS` (docker create flags), array `HIDDEN` (relative
  secret paths; empty until Task 4), `WATCH`, `LOCK`, `CREATED`, `cleanup`; hook points (comments) `# secrets`,
  `# volumes`, `# timer` that Tasks 4–6 fill.

- [ ] **Step 1: Add the failing tests**

```bash
# ---------- Task 3: the run ----------
P="$FIX/proj"
run sandbox-run --dir "$P" -- cat hello.txt
expect_out "reads the folder" hello
run sandbox-run --dir "$P" -- sh -c 'echo x > /work/new.txt'
[ "$CODE" != 0 ] && [ ! -e "$P/new.txt" ] && ok "/work is read-only" || bad "/work is read-only" "exit $CODE"
run sandbox-run --dir "$P" -- sh -c 'echo made > /out/result.txt'
RD="$(rundir)"
[ "$(cat "$RD/out/result.txt" 2>/dev/null)" = made ] && ok "control: /out lands in the run folder" || bad "control: /out lands in the run folder" "RD=$RD"
grep -q 'internet off' "$RD/run.log" && grep -q '^exit: *0' "$RD/run.log" && ok "run.log records mode and exit" || bad "run.log records mode and exit"
run FAKE_TOKEN=ghp_fake sandbox-run --dir "$P" -- sh -c 'printenv FAKE_TOKEN || echo absent'
expect_out "host env does not reach the box" absent
run sandbox-run --dir "$P" -- printenv CI
expect_out "control: CI=1 is set" 1
run sandbox-run --dir "$P" -- id -u
expect_out "runs as uid 1000" 1000
run sandbox-run --dir "$P" -- sh -c 'echo t > /tmp/t && cat /tmp/t'
expect_out "control: /tmp is writable" t
run sandbox-run --dir "$P" -- sh -c 'test -e /var/run/docker.sock && echo present || echo absent'
expect_out "no Docker socket" absent
run sandbox-run --dir "$P" -- sh -c 'exit 7';  expect_code "exit 7 passes through" 7
run sandbox-run --dir "$P" -- sh -c 'exit 2';  expect_code "exit 2 passes through (not a runner error)" 2
run sandbox-run --dir "$P" -- true;            expect_code "control: exit 0" 0
run sandbox-run --dir "$P" -- curl -sS -m 5 -o /dev/null https://example.com
[ "$CODE" != 0 ] && ok "offline: no internet" || bad "offline: no internet"
run sandbox-net --dir "$P" -- curl -sS -m 10 -o /dev/null https://example.com
expect_code "control: sandbox-net reaches the internet" 0
run sandbox-run --dir "$P" -- sh -c 'ip route | grep -c default'
expect_out "offline: no route at all" 0
if nc -z 127.0.0.1 5432 2>/dev/null; then
  run sandbox-net --dir "$P" -- sh -c 'gw=$(ip route | awk "/default/{print \$3}"); nc -z -w 3 "$gw" 5432 && echo gateway:reachable || echo gateway:closed; nc -z -w 3 host.docker.internal 5432 && echo host:reachable || echo host:closed'
  echo "MEASURED (sandbox-net → laptop Postgres): $(echo $OUT)"
else
  echo "MEASURED: skipped — Postgres is not listening on the laptop (positive control missing)"
fi
run sandbox-run --dir "$FIX/My Repo" -- cat hi.txt
expect_out "a --dir with spaces works" hi
OLD="/Volumes/U34Bolt/_shared/sandbox/runs/19990101-000000-aaaaaa"
mkdir -p "$OLD" && touch -t 199901010000 "$OLD"
run sandbox-run --prune
[ ! -d "$OLD" ] && ok "--prune removes a run folder older than 14 days" || bad "--prune removes old run folders"
[ -d "$RD" ] && ok "control: --prune keeps a fresh run folder" || bad "control: --prune keeps a fresh run folder"
```

- [ ] **Step 2: Run — must fail** (`tests/run.sh`: Task 3 checks FAIL because the script exits 0 without running).

- [ ] **Step 3: Implement prune** — replace the `--prune` stub with:

```bash
if [ "$PRUNE" = 1 ]; then
  drive_mounted || die "U34Bolt is not mounted — plug it in."
  [ -d "$RUNS" ] || exit 0
  find "$RUNS" -mindepth 1 -maxdepth 1 -type d -mtime +14 -print -exec rm -rf {} +
  exit 0
fi
```

- [ ] **Step 4: Implement the run** — replace the final `exit 0` with:

```bash
ID="$(date +%Y%m%d-%H%M%S)-$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
NAME="sandbox-$ID"
RUNDIR="$RUNS/$ID"
mkdir -p "$RUNDIR/out" || die "could not create the run folder $RUNDIR."
: > "$RUNDIR/.empty"
echo "sandbox-run: run folder $RUNDIR" >&2

WATCH=""; LOCK=""; CREATED=0
cleanup() {
  [ -n "$WATCH" ] && kill "$WATCH" 2>/dev/null
  [ "$CREATED" = 1 ] && docker rm -f "$NAME" >/dev/null 2>&1
  [ -n "$LOCK" ] && rm -rf "$LOCK"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ARGS=(--name "$NAME" --init
  --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges --read-only
  --memory "$MEMORY" --cpus 4 --pids-limit 512
  --tmpfs /tmp:rw,exec,nosuid,nodev,size=1g,mode=1777
  --tmpfs /home/sandbox:rw,nosuid,nodev,size=256m,uid=1000,gid=1000,mode=0755
  --env HOME=/home/sandbox --env "TERM=${TERM:-dumb}" --env CI=1 --env PYTHONDONTWRITEBYTECODE=1
  --workdir /work
  --mount "type=bind,src=$REAL,dst=/work,readonly"
  --mount "type=bind,src=$RUNDIR/out,dst=/out")
[ "$NET" = 1 ] || ARGS+=(--network none)

HIDDEN=()
# secrets (Task 4)

# volumes (Task 6)

{
  echo "started:  $(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "mode:     $MODE (internet $([ "$NET" = 1 ] && echo on || echo off))"
  echo "dir:      $REAL"
  printf 'command: '; printf ' %q' "$@"; echo
  echo "timeout:  ${SECS}s   memory: $MEMORY   deps volume: ${KEEP:-none}"
  echo "hidden:   ${#HIDDEN[@]} file(s)"
  for h in "${HIDDEN[@]}"; do echo "  $h"; done
} > "$RUNDIR/run.log"

docker create "${ARGS[@]}" "$IMAGE" "$@" >/dev/null || die "Docker could not create the box (its error is above)."
CREATED=1
START=$(date +%s)
# timer (Task 5)
# Started in the background and waited for, so a TERM/INT reaches our trap at once.
docker start -a "$NAME" & STARTER=$!
wait "$STARTER"; CODE=$?
TIMED_OUT=no
[ -e "$RUNDIR/.timedout" ] && { CODE=124; TIMED_OUT=yes; }
{
  echo "exit:     $CODE$([ "$TIMED_OUT" = yes ] && echo ' (time limit reached)')"
  echo "duration: $(( $(date +%s) - START ))s"
} >> "$RUNDIR/run.log"
exit "$CODE"
```

- [ ] **Step 5: Run — must pass** (`tests/run.sh` → `0 failed`; read the MEASURED line and keep it for the README).

- [ ] **Step 6: Commit** — `feat: the locked-down run, run.log and --prune`.

---

### Task 4: Hide secret files

**Files:** Modify `sandbox-run` (fill `# secrets (Task 4)`); Modify `tests/run.sh`.

**Interfaces:** Consumes `REAL`, `RUNDIR`, `ARGS`, `HIDDEN`, `check_mountable`. Produces filled `HIDDEN`.

- [ ] **Step 1: Add the failing tests**

```bash
# ---------- Task 4: secrets ----------
S="$FIX/sec"; mkdir -p "$S/server" "$S/.git" "$S/node_modules"
echo SECRET_TOP > "$S/.env"; echo SECRET_NESTED > "$S/server/.env"; echo SECRET_PROD > "$S/prod.env"
echo SECRET_KEY > "$S/server/tls.key"; echo '[remote] url=https://SECRET_GIT@example.com' > "$S/.git/config"
echo SECRET_MCP > "$S/.mcp.json"; echo SECRET_LINKED > "$S/server/real-secret.txt"
ln -s server/real-secret.txt "$S/.env.local"; echo app > "$S/server/app.txt"
run sandbox-run --dir "$S" -- sh -c 'cat .env server/.env prod.env server/tls.key .git/config .mcp.json .env.local 2>&1'
case "$OUT" in *SECRET_*) bad "secret files read empty" "got: $OUT" ;; *) [ "$CODE" = 0 ] && ok "secret files read empty (top, nested, *.env, key, git config, mcp, symlink)" || bad "secret files read empty" "exit $CODE: $ERR" ;; esac
run sandbox-run --dir "$S" -- cat server/app.txt
expect_out "control: an ordinary file reads normally" app
RL="$(rundir)/run.log"; n="$(sed -n 's/^hidden: *\([0-9]*\) file.*/\1/p' "$RL")"
[ "$n" = 7 ] && ok "run.log lists 7 hidden files" || bad "run.log lists 7 hidden files" "got $n"
C="$FIX/comma"; mkdir -p "$C"; echo X > "$C/a,b.env"
run sandbox-run --dir "$C" -- true
expect_code "a secret with a comma in its name → refuse, never run" 125
```

- [ ] **Step 2: Run — must fail** (the SECRET\_ markers are readable).

- [ ] **Step 3: Implement** — replace `# secrets (Task 4)` with:

```bash
# Cover every secret-looking file (at any depth, symlinks included) with an empty read-only file.
# A symlink is covered at the path it resolves to inside the box; a dangling one makes `docker create` fail (refuse).
while IFS= read -r -d '' f; do
  HIDDEN+=("${f#"$REAL"/}")
done < <(find "$REAL" \( -name node_modules -o -path '*/.git/objects' \) -prune -o \( -type f -o -type l \) \( \
    -name '.env*' -o -name '*.env' -o -name '*.pem' -o -name '*.key' -o -name '*.p8' -o -name '*.p12' \
    -o -name '.npmrc' -o -name '.netrc' -o -name 'mcp.json' -o -name '.mcp.json' -o -name 'settings.local.json' \
    -o -path '*/.git/config' \) -print0)
for h in "${HIDDEN[@]}"; do
  check_mountable "$h"
  ARGS+=(--mount "type=bind,src=$RUNDIR/.empty,dst=/work/$h,readonly")
done
```

- [ ] **Step 4: Run — must pass.** If the symlink case makes `docker create` fail, resolve the link on the host
      (`realpath`), and if the target is inside `$REAL` mask the target's relative path instead; if it is outside, it is
      already invisible — skip it. Re-run until `0 failed`.

- [ ] **Step 5: Commit** — `feat: hide secret files inside the box`.

---

### Task 5: Time limit and cleanup when killed

**Files:** Modify `sandbox-run` (fill `# timer (Task 5)`); Modify `tests/run.sh`.

**Interfaces:** Consumes `NAME`, `SECS`, `RUNDIR`, `WATCH`, `cleanup`. Produces `start_timer`.

- [ ] **Step 1: Add the failing tests**

```bash
# ---------- Task 5: time limit, killed mid-run ----------
run sandbox-run --dir "$P" -- true   # wake Docker from Resource Saver before timing anything
t0=$(date +%s)
run sandbox-run --timeout 2s --dir "$P" -- sleep 30
el=$(( $(date +%s) - t0 ))
expect_code "time limit → exit 124" 124
[ "$el" -lt 20 ] && ok "…within seconds, not 30 (took ${el}s)" || bad "…within seconds" "took ${el}s"
N="sandbox-$(basename "$(rundir)")"
[ -z "$(docker ps -aq --filter "name=^${N}$")" ] && ok "…and no box is left behind" || bad "…no box left behind" "$N"
grep -q 'time limit reached' "$(rundir)/run.log" && ok "…and run.log says so" || bad "…run.log says so"
run sandbox-run --timeout 5s --dir "$P" -- true
expect_code "control: a quick command under a time limit → 0" 0
"$BIN/sandbox-run" --dir "$P" -- sleep 60 >/dev/null 2>"$FIX/kill.err" & KP=$!
for _ in $(seq 1 50); do grep -q 'run folder' "$FIX/kill.err" 2>/dev/null && break; sleep 0.2; done
KN="sandbox-$(basename "$(sed -n 's/^sandbox-run: run folder //p' "$FIX/kill.err")")"
for _ in $(seq 1 50); do [ "$(docker inspect -f '{{.State.Running}}' "$KN" 2>/dev/null)" = true ] && break; sleep 0.2; done
kill -TERM "$KP"; wait "$KP"; kc=$?
[ "$kc" = 143 ] && ok "killed script exits 143" || bad "killed script exits 143" "got $kc"
[ -z "$(docker ps -aq --filter "name=^${KN}$")" ] && ok "…and its box is removed" || bad "…its box is removed" "$KN"
```

- [ ] **Step 2: Run — must fail** (`sleep 30` runs to the end: exit 0 after ~30 s).

- [ ] **Step 3: Implement** — replace `# timer (Task 5)` with:

```bash
start_timer() {
  # Waits until the box is actually running (Docker may be waking from Resource Saver), then allows SECS seconds.
  (
    trap 'kill "$SL" 2>/dev/null; exit 0' TERM
    until [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" = true ]; do sleep 0.2; done
    sleep "$SECS" & SL=$!
    wait "$SL"
    : > "$RUNDIR/.timedout"
    docker kill "$NAME" >/dev/null 2>&1
  ) &
  WATCH=$!
}
start_timer
```

- [ ] **Step 4: Run — must pass.**

- [ ] **Step 5: Commit** — `feat: time limit and cleanup when killed`.

---

### Task 6: npm cache, dependency volumes and their lock

**Files:** Modify `sandbox-run` (fill `# volumes (Task 6)`, add `ensure_volume`, `acquire_lock` above it); Modify `tests/run.sh`.

**Interfaces:** Consumes `KEEP_SET`, `KEEP`, `SECS`, `LOCKS`, `LOCK`, `ARGS`, `IMAGE`. Produces volumes
`sandbox-npm-cache` (at `/npm-cache`, env `npm_config_cache=/npm-cache`) and `sandbox-deps-<KEEP>` (at
`/work/node_modules`); lock dir `$LOCKS/sandbox-deps-<KEEP>` holding `pid`.

- [ ] **Step 1: Add the failing tests**

```bash
# ---------- Task 6: npm cache and dependency volumes ----------
run sandbox-run --dir "$P" -- sh -c 'echo c > "$npm_config_cache/probe" && cat "$npm_config_cache/probe"'
expect_out "npm cache volume is writable by the box user" c
run sandbox-run --keep-deps tdeps --dir "$P" -- sh -c 'echo dep > node_modules/marker && cat node_modules/marker'
expect_out "deps volume is writable" dep
[ ! -e "$P/node_modules/marker" ] && ok "…and the host node_modules is untouched" || bad "…host node_modules untouched"
run sandbox-run --keep-deps tdeps --dir "$P" -- cat node_modules/marker
expect_out "deps volume persists between runs" dep
run sandbox-run --keep-deps --dir "$P" -- true
expect_code "--keep-deps with no name works" 0
docker volume ls -q | grep -q '^sandbox-deps-dir-proj-' && ok "…and names the volume after the folder" || bad "…names the volume after the folder"
"$BIN/sandbox-run" --keep-deps tdeps --dir "$P" -- sleep 8 >/dev/null 2>&1 & AP=$!
L=/Volumes/U34Bolt/_shared/sandbox/locks/sandbox-deps-tdeps
for _ in $(seq 1 50); do [ -d "$L" ] && break; sleep 0.2; done
run sandbox-run --keep-deps tdeps --timeout 2s --dir "$P" -- true
expect_code "a second run on a busy deps volume gives up after its timeout" 125; expect_err_has "…saying it is busy" "busy"
wait "$AP"
[ ! -d "$L" ] && ok "…and the lock is released when the first run ends" || bad "…lock released"
mkdir -p "$L" && echo 999999 > "$L/pid"
run sandbox-run --keep-deps tdeps --dir "$P" -- true
expect_code "a stale lock (dead process) is taken over" 0
"$BIN/sandbox-run" --keep-deps tdeps --dir "$P" -- sleep 60 >/dev/null 2>&1 & KP=$!
for _ in $(seq 1 50); do [ -d "$L" ] && [ -s "$L/pid" ] && break; sleep 0.2; done
sleep 2; kill -TERM "$KP"; wait "$KP"
[ ! -d "$L" ] && ok "a killed run releases its lock" || bad "a killed run releases its lock"
docker volume ls -q | grep -E '^sandbox-deps-(tdeps|dir-proj-)' | xargs docker volume rm >/dev/null 2>&1
```

- [ ] **Step 2: Run — must fail** (`$npm_config_cache` is unset; `--keep-deps` mounts nothing).

- [ ] **Step 3: Implement** — replace `# volumes (Task 6)` with:

```bash
ensure_volume() {   # a new Docker volume belongs to root; hand it to the box user once
  docker volume inspect "$1" >/dev/null 2>&1 && return 0
  docker volume create "$1" >/dev/null || die "could not create Docker volume $1."
  docker run --rm --network none --user 0:0 --mount "type=volume,src=$1,dst=/v" "$IMAGE" chown 1000:1000 /v >/dev/null \
    || die "could not hand Docker volume $1 to the box user."
}
acquire_lock() {    # one run at a time per deps volume; a lock whose process is gone is stale
  local l="$LOCKS/sandbox-deps-$KEEP" waited=0 pid
  mkdir -p "$LOCKS"
  until mkdir "$l" 2>/dev/null; do
    pid="$(cat "$l/pid" 2>/dev/null)"
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then rm -rf "$l"; continue; fi
    [ "$waited" -ge "$SECS" ] && die "dependency volume $KEEP is busy (another run holds $l)."
    sleep 1; waited=$((waited+1))
  done
  echo $$ > "$l/pid"
  LOCK="$l"
}
ensure_volume sandbox-npm-cache
ARGS+=(--mount "type=volume,src=sandbox-npm-cache,dst=/npm-cache" --env npm_config_cache=/npm-cache)
if [ "$KEEP_SET" = 1 ]; then
  ensure_volume "sandbox-deps-$KEEP"
  acquire_lock
  ARGS+=(--mount "type=volume,src=sandbox-deps-$KEEP,dst=/work/node_modules")
fi
```

- [ ] **Step 4: Run — must pass** (full suite, `0 failed`).

- [ ] **Step 5: Commit** — `feat: npm cache and per-folder dependency volumes with a lock`.

---

### Task 7: Install, approvals, docs and the real-life checks

**Files:**

- Create: `~/.local/share/sandbox-run/README.md`; symlinks `~/.local/bin/sandbox-{run,net,build}`
- Stage: `~/.claude/backups/settings.json.sandbox-run` (owner copies it into place)
- Modify: `/Volumes/U34Bolt/README.md` (python3 -I — the drive's top folder is not writable by `sed -i`),
  `~/.claude/CLAUDE.md`, memory `project_external_drive_u34bolt.md` + a new `project_sandbox_run.md` + `MEMORY.md` line
- OCRecipes: PR with the spec (branch `docs/sandbox-run-spec`)

- [ ] **Step 1: Install the commands**

```bash
for n in sandbox-run sandbox-net sandbox-build; do ln -sfn ~/.local/share/sandbox-run/sandbox-run ~/.local/bin/$n; done
cd /private/tmp/claude-501 && sandbox-run --dir ~/.local/share/sandbox-run -- ls >/dev/null; echo "exit $?"
```

Expected: `exit 125` with "refusing --dir" (`~/.local` is not on the allowlist) — proves the installed command runs
and refuses. Then `sandbox-run --dir ~/projects/OCRecipes -- node -v` → `v24.…`, exit 0.

- [ ] **Step 2: Stage the approval rules** — first check for conflicts (prints only matching rules, never the file):

```bash
python3 -I - <<'PY'
import json, os
s = json.load(open(os.path.expanduser('~/.claude/settings.json')))
p = s.get('permissions', {})
for k in ('allow', 'ask', 'deny'):
    for r in p.get(k, []):
        if r in ('Bash', 'Bash(*)') or 'sandbox' in r:
            print(k, r)
print('autoMode.allow sandbox:', [r for r in s.get('autoMode', {}).get('allow', []) if 'sandbox' in r])
PY
```

Expected: no `Bash`/`Bash(*)` allow (it would pre-approve `sandbox-net`). If one exists, stop and tell the owner.
Then stage:

```bash
python3 -I - <<'PY'
import json, os, shutil
src = os.path.expanduser('~/.claude/settings.json')
out = os.path.expanduser('~/.claude/backups/settings.json.sandbox-run')
os.makedirs(os.path.dirname(out), exist_ok=True)
shutil.copy2(src, os.path.expanduser('~/.claude/backups/settings.json.before-sandbox-run'))
s = json.load(open(src))
def add(d, k, v):
    l = d.setdefault(k, [])
    if v not in l: l.append(v)
perm = s.setdefault('permissions', {})
add(perm, 'allow', 'Bash(sandbox-run:*)')
add(perm, 'ask', 'Bash(sandbox-net:*)'); add(perm, 'ask', 'Bash(sandbox-build:*)')
add(s.setdefault('autoMode', {}), 'allow', 'Bash(sandbox-run *)')
json.dump(s, open(out, 'w'), indent=2); json.load(open(out)); print('staged + valid')
PY
```

Hand the owner one line: `! cp ~/.claude/backups/settings.json.sandbox-run ~/.claude/settings.json`

- [ ] **Step 3: Real-life check 1 — OCRecipes in the box**

```bash
df -h /System/Volumes/Data | awk 'NR==2{print "laptop free before:", $4}'
sandbox-net --keep-deps ocrecipes --timeout 20m --dir ~/projects/OCRecipes -- sh -c 'HUSKY=0 npm ci'
sandbox-run --keep-deps ocrecipes --dir ~/projects/OCRecipes -- npx vitest run client/components/__tests__/allergen-badge-utils.test.ts
```

Expected: `npm ci` exit 0 (asks the owner — it is `sandbox-net`); the vitest file passes offline. Then pick one
database-backed test (`grep -rl 'DATABASE_URL' server --include='*.test.ts' | head -1`) and run it the same way:
expected a clear connection error or a skip within the time limit — record which.

- [ ] **Step 4: Real-life check 2 — approvals, in auto mode** (owner switches auto mode on and confirms the settings
      were copied). Claude runs `sandbox-run --dir ~/projects/OCRecipes -- true` → expected: runs with no prompt. Then
      `sandbox-net --dir ~/projects/OCRecipes -- true` → owner declines; expected: Claude sees a rejected tool call. If it
      simply runs, the rules failed — stop and fix before going on.

- [ ] **Step 5: Real-life check 3 — disk** — `df -h /System/Volumes/Data` again; compare with Step 3's number and
      `du -sh /Volumes/U34Bolt/_shared/docker /Volumes/U34Bolt/_shared/sandbox`. Expected: laptop unchanged (± normal
      noise); growth only on the drive.

- [ ] **Step 6: Write `README.md`** (repo) — the three commands and usage; the lock table from the spec; secret hiding
      and its list; exit codes 125 / 124; the MEASURED `sandbox-net` → laptop result from Task 3, stated plainly; no
      database tests; `--prune`; how to run `tests/run.sh`. Commit: `docs: README`.

- [ ] **Step 7: Drive README, global CLAUDE.md, memory**
  - Drive README (python3 -I, assert-once replace like the Docker lines): Layout line
    ``- `_shared/sandbox/` — sandbox-run's run folders (`runs/`) and locks; its image and volumes live in Docker's image``
    and an Unplugged sentence: "`sandbox-run`/`sandbox-net`/`sandbox-build` refuse with 'plug it in' (exit 125)."
  - `~/.claude/CLAUDE.md`: a 5-line "sandbox-run" section — the three commands, `sandbox-net`/`sandbox-build` ask,
    the measured laptop-services limit, no database tests, README path.
  - Memory: new `project_sandbox_run.md` (what was built, measured results, where the README is) + `MEMORY.md` Dev
    Tooling line; drop "design pending" from `project_external_drive_u34bolt.md`.

- [ ] **Step 8: OCRecipes PR** — the spec only (`docs/superpowers/plans/` is gitignored in OCRecipes; this plan stays
      local). On `docs/sandbox-run-spec`: push (preflight runs), open the PR via `mcp__github__create_pull_request`, one
      review pass, merge via `mcp__github__merge_pull_request` with `expectedHeadSha` (the owner's three uncommitted files
      stay untouched).
