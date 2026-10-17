# Harness Rules

Binding for the repo's own tooling — `.claude/hooks/**`, `.claude/skills/**`, `.claude/agents/**`, `scripts/**` — not app code.

## Generated artifacts and path routing

- Never hand-edit a generated file: `.claude/hooks/lib/domain-map.sh` and `.github/copilot-instructions.md` come from `scripts/lib/path-domains.ts` — edit the source, run `npm run build:domain-map` + `npm run build:copilot-instructions`, commit both (on a conflict, merge the source and regenerate).
- **Never write a path rule matching bare `.claude/`** — worktrees live at `.claude/worktrees/<name>/` and routing matches paths, so a `.claude/**` rule tags every worktree file and degrades a concurrent agent's context. Scope to `.claude/hooks`, `.claude/skills`, `.claude/agents`.
- `recursive-dir` matchers can't be root-anchored (`FILE_PATH` may be absolute), so a `scripts` rule also matches `server/scripts/**` — say so in its `description` (rendered into the Copilot table).

## Bash (target bash 3.2 — stock macOS)

- No `mapfile`, `${var,,}`, or associative arrays. Under `set -u`, `"${arr[@]}"` on an empty array aborts — guard with `[ "${#arr[@]}" -gt 0 ]`. Every word of a `local` expands before the builtin runs (`local nl=$'\n' x="$nl"` fails) — declare separately.
- `$(...)` unsets `errexit`: inside `var=$(fn)` only `fn`'s **final** status propagates, and `read ... <<<"$(fn)"` checks none. For must-not-fail side effects call the function **bare** and return results via a file; guard only failures you mean to tolerate (`x=$(...) || x=""`). `set -e` is likewise suspended for the subject of `if !`, `&&`, or `||`.
- Early-exiting readers fail OPEN under `pipefail` — `cmd | grep -q`, `| head`, `| sed q` exit at first match, the writer takes SIGPIPE, the pipeline reports failure. Capture first, then read: `grep -q ... <<< "$var"`.
- `jq -r '.k'` prints literal `null` for an absent key (`-e` only changes the exit code) — use `.k // empty` whenever the value keys state, a path, or a filename.
- `for p in $var` pathname-expands as well as word-splits (a glob in `$var` becomes a real filename) — wrap in `set -f` and restore. Scripts run under `bash`, not the interactive zsh you paste into: zsh does not word-split unquoted expansions and applies csh modifiers to an unbraced `$VAR` before a colon.
- A glob-driven runner loop passes green when the glob matches nothing — count iterations and `exit 1` on zero.

## Hooks and their tests

- Hooks fail open and silent: `exit 0` on unparseable input or a missing field; never block a tool call on an infrastructure error. Side-effecting telemetry needs an env kill switch that every self-test sets (`PATTERN_INJECT_NO_LOG=1`) so tests never write the shared lab DB.
- Run hook self-tests via `scripts/run-hook-tests.sh` — never re-implement its loop; it strips the git env (`env -u GIT_DIR ...`) because an inherited absolute `GIT_DIR` overrides `git -C <tmp>` and mutates the real repo.
- A gate test needs a two-sided negative control: assert the gate FIRES on a bad payload, not only that a good one passes. If mutating the code under test leaves the suite green, the test is a decoration — fix the claim, don't add another.
- **The outward-CLI guard corpus (`corpus-detect` + `repro-outward-cli-corpus.sh`) is relevance-gated:** every `.claude/hooks/**` edit and every push to `main` (unless `paths-ignore` skips it) runs it; other PRs skip it. Detect diffs with `--no-renames` (a move out of the hooks dir must still list its old path). It runs sharded (`--shard I/N`) — re-pin only from a completed `--aggregate` run over the shard union (or a local no-arg run), never one shard's totals; a nightly unsharded run is the drift backstop. A required-check gate keys on `corpus-detect`'s output, never on bare `skipped` (also means "aggregate never completed") — see `.github/workflows/ci.yml`'s job comments.

## Knowledge-base plumbing

- `docs/rules/*.md` are injected WHOLE before every edit in their domain — keep each under the cap in `scripts/check-rules-file-size.js` (CI). Terser is better: two domains share one budget.
- `docs/solutions/**` frontmatter arrays stay single-line inline flow; retrieval is line-anchored (hence `docs/solutions/` in `.prettierignore`). `tags` and `applies_to` are a two-part precondition: retrieval selects by `tags` matching the file's routed domain FIRST, then partitions by `applies_to` — a glob whose paths never route to one of the solution's own tags is inert; check with `npx tsx scripts/lib/path-domains.ts <path>`. `applies_to` is matched with bash `[[ ]]` (no globstar); the hook also tries the `**/`-elided form, so `dir/**/*.ext` matches both `dir/file.ext` and `dir/sub/file.ext`.
- Edits to `.claude/agents/*.md` and `.claude/skills/**` take effect on session reload, not on save — verify a behavior change in a fresh session before claiming it works.

## Session coordination v2 (checkpoints and the collision block)

- Before every Agent dispatch and command-position `git checkout/restore/reset/stash/clean/switch` (not `/usr/bin/git …` — `docs/harness-residuals.md`), `.claude/hooks/checkpoint.sh` snapshots each dirty worktree to `refs/checkpoints/<sid8>/<worktree>` (local, 14-day retention; never touches HEAD, index, or files). Recover: `bash scripts/checkpoint.sh list`, then `git restore --source=<ref> --worktree -- <path>`.
- Editing a file another live session touched in the last 15 min is blocked once per file/holder/agent per 15 min (up to 5 holders judged, 3 checked live; two live holders = two blocks). The block names the most recent live editor; ask the user, then the retry goes through. A sibling subagent only gets a warning; `SKIP_COLLISION_BLOCK=1` makes every block a warning.
