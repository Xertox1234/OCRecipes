# `sandbox-run` — a locked-down Docker box for Claude Code and its agents

Date: 2026-10-15 · Status: design approved in conversation; revised after an advisor review; spec awaiting owner review

## Goal

Give the main Claude Code session and every subagent one command that runs code in a throwaway Docker container which
cannot touch the owner's files, secrets, or (by default) the internet. Uses it covers:

- code from outside (a downloaded repo, a library to try, a script from the internet);
- risky experiments (installs or commands that could break or clutter the laptop);
- project tests that need no database.

Out of scope (a later, separate design): running a whole agent session inside an isolated machine for hands-off work
(Docker Sandboxes / `sbx`). That needs a Docker sign-in and a measurement of where `sbx` stores its VMs.

## Decisions (owner, 2026-10-15)

| Question            | Decision                                                                           |
| ------------------- | ---------------------------------------------------------------------------------- |
| What to build first | The code runner; the agent box comes later                                         |
| Internet            | Off unless a run asks for it                                                       |
| Owner's files       | The box sees one folder read-only, plus a results folder on the drive              |
| Approval            | Offline runs never prompt; runs that want internet (or build the image) always ask |
| Approach            | A bash CLI wrapping `docker run` — not an MCP server, not `sbx`                    |
| Project tests       | Tests without a database only; database tests stay on the laptop and in CI         |

## Context

- Docker Desktop 4.95 (engine 29.8.2), disk image at `/Volumes/U34Bolt/_shared/docker/DockerDesktop/Docker.raw`
  (sparse, 228.7 GB cap). Docker does not start with the drive unplugged (measured 2026-10-15). Resource Saver is on
  (Docker idles after 30 s, so the first run after a pause starts slower).
- Mount check, the only one to use: `[ "$(df -P /Volumes/U34Bolt 2>/dev/null | awk 'NR==2{print $6}')" = /Volumes/U34Bolt ]`.
- `~/.zshenv` holds a GitHub token; OCRecipes has `.env` files with real keys. Neither may ever reach a box.
- Laptop: arm64, 10 CPUs; Docker's VM has ~8 GB memory. OCRecipes needs Node `24.x`.
- The owner often works in auto mode, where a classifier — not the permission prompt — decides whether a command runs.

## 1. Pieces and where they live

**Laptop** (tiny; exists even when the drive is unplugged, so failures are a clear message, never "command not found"):

- `~/.local/share/sandbox-run/` — its own local git repo (not pushed anywhere): the script `sandbox-run` (bash),
  `image/Dockerfile`, `tests/run.sh`, `README.md`.
- Three commands in `~/.local/bin/`, all symlinks to the one script, which picks its mode from the name it was called by:

| Command         | What it does                         | Internet | Approval    |
| --------------- | ------------------------------------ | -------- | ----------- |
| `sandbox-run`   | runs a command offline               | never    | pre-allowed |
| `sandbox-net`   | runs a command with internet         | yes      | always asks |
| `sandbox-build` | builds (or rebuilds) the box's image | yes      | always asks |

`sandbox-run` **rejects** any internet flag outright; the only way to get internet is to call `sandbox-net`. Because no
command name is an extension of another, the permission rules cannot be sidestepped by spacing or argument order —
the gate lives in the script, not in how Claude Code matches text.

**Drive**, under `/Volumes/U34Bolt/_shared/sandbox/` (laptop-wide, like the other `_shared` material):

- `runs/<YYYYMMDD-HHMMSS>-<6 hex>/` — one folder per run: everything the code wrote to `/out`, plus `run.log`
  (command, folder seen, internet on/off, hidden files, exit code, duration).
- `locks/` — install locks for shared dependency volumes (see section 3).
- The image `sandbox-run:1`, the dependency volumes and the shared npm cache volume live inside Docker's disk image,
  which is already on the drive.

**Image** (`image/Dockerfile`): `node:24-bookworm-slim` **pinned by digest** (so a rebuild is reproducible) plus
`python3`, `git`, `curl`, `ca-certificates`, `netcat-openbsd`, `iproute2`; a non-root user `sandbox` (uid 1000); no `sudo`.

**Usage** (same for `sandbox-run` and `sandbox-net`):

```
sandbox-run [--dir <folder>] [--keep-deps [<name>]] [--timeout <dur>] -- <command…>
sandbox-run --prune
sandbox-build
```

- `--dir` defaults to the current directory; it is resolved to its real path before any check (section 2).
- `--keep-deps` mounts the Docker volume `sandbox-deps-<name>` over `/work/node_modules`. With no name, the name is the
  folder's basename plus a short hash of its real path. It is refused, with a message, when `--dir` has no
  `node_modules` folder (a read-only folder cannot gain the mount point).
- `--timeout` defaults to `10m`; the clock starts when the box has started, not when the command is typed.
- `--prune` deletes `runs/` folders older than 14 days. Nothing is ever deleted automatically.

## 2. What one run can and cannot do

**Which folders may be mounted — an allowlist.** `--dir` (after resolving its real path) must be inside one of:

- `~/projects/`
- `~/Downloads/`
- `/Volumes/U34Bolt/<something>/` — any folder below the drive's top level
- Claude Code's scratchpad, `/private/tmp/claude-501/`

Anything else is refused with the reason, including the home folder, `~/Library`, `~/.ssh`, `~/.claude`, `~/.docker`,
`~/.aws`, `~/.gnupg`, `~/.config`, `/` and the drive's top level. (A denylist would leave holes like `~/Library`, which
holds app sign-in data.) Adding a root is a one-line change to the script.

**Mounts — the only things from the host the box sees** (plus an empty read-only file over each hidden secret, below):

| In the box           | From                                                           | Mode                                                                         |
| -------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/work`              | `--dir`                                                        | read-only                                                                    |
| `/work/node_modules` | volume `sandbox-deps-<name>` (only with `--keep-deps`)         | read-write; covers the host's macOS `node_modules`, which is never touched   |
| `/out`               | the run's folder on the drive                                  | read-write                                                                   |
| `/npm-cache`         | volume `sandbox-npm-cache` (shared by all runs)                | read-only in `sandbox-run`, read-write in `sandbox-net` (`npm_config_cache`) |
| `/tmp`               | memory (`tmpfs`, 1 GB, world-writable mode 1777, exec allowed) | read-write, gone after the run                                               |
| `/sandbox-state`     | the run folder's `state/` on the drive                         | read-write; the box marks that it started                                    |
| `/home/sandbox`      | memory (`tmpfs`, 256 MB, owned by uid 1000)                    | read-write, gone after the run                                               |

The npm cache is a volume, not memory, because memory-backed space counts against the box's memory limit and npm's cache
for a project like OCRecipes is hundreds of MB. `/tmp` allows running programs because many installs and test tools
unpack and run helpers there.

A new Docker volume belongs to root. When the script creates `sandbox-deps-<name>` or `sandbox-npm-cache`, it runs one
short root-only container that hands the volume to uid 1000; every later run is non-root.

**Locks on every run** (`docker run` flags):

- `--network none`; `sandbox-net` uses the default bridge network.
- `--user 1000:1000`, `--cap-drop ALL`, `--security-opt no-new-privileges`.
- `--read-only` root filesystem.
- `--memory 2g`, `--cpus 4`, `--pids-limit 512`. 2 GB so four parallel agents fit in Docker's ~8 GB; one run can ask
  for more with `--memory`, and contention between parallel runs is accepted.
- `--init` and `--name sandbox-<run id>`, so a timeout can `docker kill` the box by name.
- `--rm` — the box is deleted after every run.
- Environment: nothing from the host. The script sets only `HOME`, `TERM`, `CI=1`, `PYTHONDONTWRITEBYTECODE=1`,
  `npm_config_cache=/npm-cache` and `npm_config_logs_dir=/tmp/npm-logs` (the image adds `PATH`; Docker adds `HOSTNAME`).
- Never mounted: the Docker socket, `~/.ssh`, shell config files, the home folder.

**Secret files are hidden.** Before each run the script finds, **at any depth** under `--dir` (skipping
`node_modules` and `.git/objects`; files and symlinks): `.env*`, `*.env`, `*.pem`, `*.key`, `*.p8`, `*.p12`, `.npmrc`, `.netrc`, `mcp.json`, `.mcp.json`,
`settings.local.json`, and `.git/config` (which may carry credential URLs). Each is covered by an empty read-only file
mounted at the same path. `run.log` lists every hidden path. Git commands that read the remote config therefore do not
work inside the box; that is accepted.

**Known limit of `sandbox-net` runs: they can reach programs on the laptop.** Docker Desktop gives containers a
fixed gateway address that leads back to the Mac, so a `sandbox-net` run can likely reach services listening there
(local Postgres, the dev server). Renaming `host.docker.internal` does not close this — the gateway address is easy to
find. The README states this limit plainly, and a test measures it (section 4). Offline runs have no network at all, so
they cannot reach the laptop. This is one more reason `sandbox-net` always asks.

## 3. Approvals and failures

**Approval rules** in `~/.claude/settings.json` (laptop-wide, so every project and agent gets them):

- `permissions.allow`: `Bash(sandbox-run:*)` — offline runs only.
- `permissions.ask`: `Bash(sandbox-net:*)`, `Bash(sandbox-build:*)` — listed for clarity; unlisted commands ask anyway.
- `autoMode.allow`: one plain-English rule permitting `sandbox-run` only (and saying `sandbox-net`/`sandbox-build` are
  not covered), since auto mode has its own classifier layer and its allow list is written as sentences.

Claude Code blocks edits to its own settings, so the finished file is staged, validated with `json.load`, and handed to
the owner as one `cp` command.

**Failures** — one clear message each, every message starting with `sandbox-run:` on stderr; nothing half-runs. The
script's own failures use exit **125** (Docker's own code for "the runner failed"), so an agent can tell them from the
command's own exit codes such as 1 or 2.

| Situation                               | Behaviour                                                     | Exit       |
| --------------------------------------- | ------------------------------------------------------------- | ---------- |
| Drive not mounted (the `df` check)      | "U34Bolt is not mounted — plug it in." Docker is not touched. | 125        |
| Docker not running                      | "Docker Desktop is not running — open it."                    | 125        |
| Image missing                           | "Run `sandbox-build` once (needs internet)."                  | 125        |
| Folder not on the allowlist             | Refuses and names the reason.                                 | 125        |
| An internet flag given to `sandbox-run` | "Use `sandbox-net` for internet."                             | 125        |
| `--keep-deps` without `node_modules`    | Refuses and says why.                                         | 125        |
| Time limit reached                      | Box killed by name; `run.log` records it.                     | 124        |
| The code fails                          | Its own exit code is passed back unchanged.                   | code's own |

**Parallel runs:** each gets its own box and `runs/` folder. A run that uses a shared dependency volume takes a lock
first: `mkdir /Volumes/U34Bolt/_shared/sandbox/locks/<volume>` (atomic). The lock folder holds the owner's process ID;
a lock whose process no longer exists is stale and is removed. A second run waits up to its own timeout for the lock.

## 4. Testing

Tests are written first (TDD) in `tests/run.sh`. They start real boxes, so they need the drive and Docker. They run on the
laptop, not in OCRecipes CI. Every lock has a check that it blocks AND a control proving the allowed path works — without
the control, a box that can do nothing would pass every "blocked" test. Before the timing tests, a warm-up run wakes
Docker from Resource Saver.

| Lock            | Must fail                                                                                                    | Control that must work                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Internet        | `curl https://example.com` in `sandbox-run`                                                                  | the same `curl` in `sandbox-net`                                   |
| Internet flag   | `sandbox-run --net …` refused, exit 125                                                                      | `sandbox-net …` runs                                               |
| Laptop services | (measured, not asserted) `nc -z <gateway from ip route> 5432` in `sandbox-net`; offline run: no route at all | host-side `nc -z 127.0.0.1 5432` proves Postgres is listening      |
| Read-only       | writing to `/work`                                                                                           | writing to `/out`; the file appears in the run folder on the drive |
| Secrets hidden  | fixture `.env` (top level) AND `server/.env` (nested), each holding a marker, read empty                     | an ordinary fixture file reads normally                            |
| Environment     | a fake token exported in the calling shell is absent                                                         | `CI=1` is present                                                  |
| Normal user     | uid is not 0; `sudo` is absent                                                                               | writing to `/tmp` works                                            |
| Docker socket   | `/var/run/docker.sock` is absent                                                                             | —                                                                  |
| Time limit      | `sleep 30` with `--timeout 2s` → exit 124, and no `sandbox-<id>` box left running                            | a quick command → exit 0                                           |
| Exit codes      | `exit 7` → 7; `exit 2` → 2 (not mistaken for a runner error)                                                 | `exit 0` → 0                                                       |
| Allowlist       | `--dir ~`, `--dir ~/Library/Application\ Support`, `--dir /Volumes/U34Bolt` refused, exit 125                | `--dir <fixture under the scratchpad>` runs                        |
| Drive unplugged | script pointed at a fake drive path → "plug it in", exit 125                                                 | the real path runs                                                 |
| Docker down     | `DOCKER_HOST` at a dead socket → "open Docker", exit 125                                                     | the real socket runs                                               |
| Deps volume     | `--keep-deps` on a folder without `node_modules` → refused                                                   | on a fixture with `node_modules`, uid 1000 can write the volume    |

**Real-life checks after the tests pass:**

1. OCRecipes in the box: one `sandbox-net --keep-deps -- npm ci`, then an offline `sandbox-run --keep-deps` of one
   `client/components/*-utils` test passes; a database test fails with a clear connection error within the time limit
   (no hang).
2. Approval rules, **in auto mode** (where the classifier, not the prompt, decides): Claude runs `sandbox-run` (runs with
   no prompt); then `sandbox-net`, which the owner declines. The decline returns to Claude as a rejected tool call —
   that is the evidence. If `sandbox-net` simply runs, the rules failed.
3. Disk: laptop free space measured before and after; the image, runs and volumes add nothing to the laptop.

## Docs and memory

- Drive README: a Layout line for `_shared/sandbox/` and an Unplugged note (the commands refuse with a message).
- Global `~/.claude/CLAUDE.md`: a short "sandbox-run" section (the three commands, `sandbox-net` asks, the `sandbox-net`
  laptop-services limit, no database tests).
- Memory: a project entry once the real-life checks pass.

## Changes from the final review (2026-10-15)

- The box carries its own time limit (5 s after the script's) and is created with `--rm`, so it ends and removes
  itself even if the script is killed outright.
- The box marks that it started (in the run folder's `state/`); a box that never starts is a runner failure (125).
- A path with a newline or other control character is refused, like commas and double quotes.
- A dependency volume belongs to the folder that created it (a Docker label); offline runs mount the npm cache
  read-only, so untrusted code cannot plant packages a later run would use.
- Lock takeover: one waiter decides at a time; a lock with no pid over 10 s old is stale; a stale lock's box is removed.
