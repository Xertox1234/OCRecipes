# `sandbox-run` — a locked-down Docker box for Claude Code and its agents

Date: 2026-10-15 · Status: design approved in conversation, spec awaiting owner review

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
  (sparse, 228.7 GB cap). Docker does not start with the drive unplugged (measured 2026-10-15).
- Mount check, the only one to use: `[ "$(df -P /Volumes/U34Bolt 2>/dev/null | awk 'NR==2{print $6}')" = /Volumes/U34Bolt ]`.
- `~/.zshenv` holds a GitHub token; OCRecipes has `.env` files with real keys. Neither may ever reach a box.
- Laptop: arm64, 10 CPUs; Docker's VM has ~8 GB memory. OCRecipes needs Node `24.x`.

## 1. Pieces and where they live

**Laptop** (tiny; exists even when the drive is unplugged, so failures are a clear message, never "command not found"):

- `~/.local/share/sandbox-run/` — its own local git repo (not pushed anywhere): `sandbox-run` (bash),
  `image/Dockerfile`, `tests/run.sh`, `README.md`.
- `~/.local/bin/sandbox-run` → symlink to the script in that repo.

**Drive**, under `/Volumes/U34Bolt/_shared/sandbox/` (laptop-wide, like the other `_shared` material):

- `runs/<YYYYMMDD-HHMMSS>-<6 hex>/` — one folder per run: everything the code wrote to `/out`, plus `run.log`
  (command, folder seen, internet on/off, hidden files, exit code, duration).
- The image `sandbox-run:1` and the dependency volumes live inside Docker's disk image, which is already on the drive.

**Image** (`image/Dockerfile`): `node:24-bookworm-slim` plus `python3`, `git`, `curl`, `ca-certificates`; a non-root user
`sandbox` (uid 1000); no `sudo`.

**Command line:**

```
sandbox-run [--net | --build | --prune] [--dir <folder>] [--keep-deps <name>] [--timeout <dur>] -- <command…>
```

- `--net`, `--build` and `--prune` are only accepted as the **first** argument; anywhere else the script refuses. Claude
  Code permission rules match a command by its start, so this keeps the "ask" rules from being sidestepped.
- `--dir` defaults to the current directory; it is resolved to its real path before any check.
- `--keep-deps <name>` mounts the Docker volume `sandbox-deps-<name>` over `/work/node_modules` (default name: the
  folder's basename plus a short hash of its real path).
- `--timeout` defaults to `10m`.
- `--build` builds (or rebuilds) the image — it needs the internet, so it shares the "ask" rule with `--net`.
- `--prune` deletes `runs/` folders older than 14 days. Nothing is ever deleted automatically.

## 2. What one run can and cannot do

**Mounts — the only things from the host the box sees:**

| In the box              | From                                                   | Mode                                                                       |
| ----------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| `/work`                 | `--dir`                                                | read-only                                                                  |
| `/work/node_modules`    | volume `sandbox-deps-<name>` (only with `--keep-deps`) | read-write; covers the host's macOS `node_modules`, which is never touched |
| `/out`                  | the run's folder on the drive                          | read-write                                                                 |
| `/tmp`, `/home/sandbox` | memory (`tmpfs`)                                       | read-write, gone after the run                                             |

**Locks on every run** (`docker run` flags):

- `--network none`; with `--net`, the default bridge network.
- `--user 1000:1000`, `--cap-drop ALL`, `--security-opt no-new-privileges`.
- `--read-only` root filesystem.
- `--memory 4g`, `--cpus 4`, `--pids-limit 512`.
- `--rm` — the box is deleted after every run.
- Environment: nothing from the host. Only `HOME`, `PATH`, `TERM` and `CI=1` are set.
- Never mounted: the Docker socket, `~/.ssh`, shell config files, the home folder.

**Secret files are hidden.** Before each run the script finds, under `--dir` (skipping `node_modules`):
`.env*`, `*.pem`, `*.key`, `*.p8`, `*.p12`, `.npmrc`, `.netrc`, and `.git/config` (which may carry credential URLs).
Each is covered by an empty read-only file mounted at the same path. `run.log` lists every hidden path. Git commands that
read the remote config therefore do not work inside the box; that is accepted.

**Refused folders:** `--dir` that is `/`, the home folder itself, anything under `~/.ssh` or `~/.claude`, or the top
level of `/Volumes/U34Bolt`.

**Known limit of `--net` runs:** Docker Desktop routes `host.docker.internal` to the laptop, so a `--net` run could reach
services listening on the laptop (local Postgres, the dev server). The script overrides `host.docker.internal` and
`gateway.docker.internal` to an unroutable address; a test checks whether the laptop's Postgres port is still reachable.
If it is, the README states it plainly as a limit of `--net` runs. This is one more reason `--net` always asks.

## 3. Approvals and failures

**Approval rules** in `~/.claude/settings.json` (laptop-wide, so every project and agent gets them):

- `permissions.allow`: `Bash(sandbox-run:*)`
- `permissions.ask`: `Bash(sandbox-run --net:*)`, `Bash(sandbox-run --build:*)` — "ask" outranks "allow".
- `autoMode.allow`: the offline form only, since auto mode has its own classifier layer.

Claude Code blocks edits to its own settings, so the finished file is staged, validated with `json.load`, and handed to
the owner as one `cp` command.

**Failures** — one clear message each; nothing half-runs:

| Situation                                | Behaviour                                                                                                                                               | Exit       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Drive not mounted (the `df` check)       | "U34Bolt is not mounted — plug it in." Docker is not touched.                                                                                           | 2          |
| Docker not running                       | "Docker Desktop is not running — open it."                                                                                                              | 2          |
| Image missing                            | "Run `sandbox-run --build` once (needs internet)."                                                                                                      | 2          |
| Refused folder, or a mode flag not first | Refuses and names the reason.                                                                                                                           | 2          |
| Time limit reached                       | Box killed; `run.log` records it.                                                                                                                       | 124        |
| The code fails                           | Its own exit code is passed back unchanged.                                                                                                             | code's own |
| Parallel runs                            | Each gets its own box and `runs/` folder. A run that installs into a shared dependency volume takes a per-volume lock (`mkdir` lock); the second waits. | —          |

## 4. Testing

Tests are written first (TDD) in `tests/run.sh`. They start real boxes, so they need the drive and Docker. They run on the
laptop, not in OCRecipes CI. Every lock has a check that it blocks AND a control proving the allowed path works — without
the control, a box that can do nothing would pass every "blocked" test.

| Lock            | Must fail                                                  | Control that must work                                             |
| --------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| Internet        | `curl https://example.com` without `--net`                 | the same `curl` with `--net`                                       |
| Laptop services | with `--net`, connecting to the laptop's Postgres port     | (result recorded; see Known limit)                                 |
| Read-only       | writing to `/work`                                         | writing to `/out`; the file appears in the run folder on the drive |
| Secrets hidden  | a fixture `.env` with a marker reads empty                 | an ordinary fixture file reads normally                            |
| Environment     | a fake token exported in the calling shell is absent       | `CI=1` is present                                                  |
| Normal user     | uid is not 0; `sudo` is absent                             | writing to `/tmp` works                                            |
| Docker socket   | `/var/run/docker.sock` is absent                           | —                                                                  |
| Time limit      | `sleep 30` with `--timeout 2s` → exit 124                  | a quick command → exit 0                                           |
| Exit codes      | `exit 7` → 7                                               | `exit 0` → 0                                                       |
| Refusals        | `--dir ~` refused; `--net` given second refused            | `--dir <fixture>` runs                                             |
| Drive unplugged | script pointed at a fake drive path → "plug it in", exit 2 | the real path runs                                                 |
| Docker down     | `DOCKER_HOST` at a dead socket → "open Docker", exit 2     | the real socket runs                                               |

**Real-life checks after the tests pass:**

1. OCRecipes in the box: one `--net --keep-deps` run of `npm ci`, then an offline run of one `client/components/*-utils`
   test passes; a database test fails with a clear connection error within the time limit (no hang).
2. Approval rules: Claude runs an offline command (no prompt); then a `--net` command which the owner declines — the
   decline returns to Claude as a rejected tool call, which is the evidence.
3. Disk: laptop free space measured before and after; the image, runs and volumes add nothing to the laptop.

## Docs and memory

- Drive README: a Layout line for `_shared/sandbox/` and an Unplugged note (the command refuses with a message).
- Global `~/.claude/CLAUDE.md`: a short "sandbox-run" section (what it is, `--net` asks, no database tests).
- Memory: a project entry once the real-life checks pass.
