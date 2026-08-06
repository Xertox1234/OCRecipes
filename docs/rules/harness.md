# Harness Rules

Binding for the repo's own tooling — `.claude/hooks/**`, `.claude/skills/**`, `.claude/agents/**`, `scripts/**` — not app code.

## Generated artifacts and path routing

- Never hand-edit a generated file. `.claude/hooks/lib/domain-map.sh` and `.github/copilot-instructions.md` are built from `scripts/lib/path-domains.ts` — edit the source, run `npm run build:domain-map` + `npm run build:copilot-instructions`, commit both. On a conflict in a generated file, merge the source and re-run the generator.
- **Never write a path rule matching bare `.claude/`.** Worktrees live at `.claude/worktrees/<name>/` and routing matches paths, not tracked files — a `.claude/**` rule tags every file in every worktree, suppressing its real domains and silently degrading a concurrent agent's context. Scope to `.claude/hooks`, `.claude/skills`, `.claude/agents`.
- `recursive-dir` matchers cannot be root-anchored (`FILE_PATH` may be absolute), so a `scripts` rule also matches `server/scripts/**`. Say so in the rule's `description` — it renders into the Copilot table.

## Bash (target bash 3.2 — stock macOS)

- No `mapfile`, `${var,,}`, or associative arrays. Under `set -u`, `"${arr[@]}"` on an empty array aborts — guard with `[ "${#arr[@]}" -gt 0 ]`. Every word of a `local` expands before the builtin runs, so `local nl=$'\n' x="$nl"` fails; declare separately.
- `$(...)` unsets `errexit`, so every command inside `var=$(fn)` runs as if `set +e` and only `fn`'s **final** status can propagate — checking `$?` does not recover the failure of an earlier statement inside `fn`, and inside `read ... <<<"$(fn)"` no status is checked at all. For must-not-fail side effects, call the function **bare** and return results via a file; guard only the failures you intend to tolerate (`x=$(...) || x=""`). `set -e` is likewise suspended for a function that is the subject of `if !`, `&&`, or `||`.
- Early-exiting readers fail OPEN under `pipefail` — `cmd | grep -q`, `| head`, `| sed q` all exit at first match, the writer takes SIGPIPE, and the pipeline reports failure though the read succeeded. Capture first, then read: `grep -q ... <<< "$var"`.
- `jq -r '.k'` prints literal `null` for an absent key (`-e` only changes the exit code) — use `jq -r '.k // empty'` whenever the value keys state, a path, or a filename.
- `for p in $var` pathname-expands as well as word-splits, so a glob in `$var` silently becomes a real filename. Wrap in `set -f` and restore.
- Scripts run under `bash`, not the interactive zsh you paste into: zsh does not word-split unquoted expansions and applies csh modifiers to an unbraced `$VAR` before a colon.
- A glob-driven runner loop passes green when the glob matches nothing. Count iterations and `exit 1` on zero.

## Hooks and their tests

- Hooks fail open and silent: `exit 0` on unparseable input or a missing field; never block a tool call on an infrastructure error. Side-effecting telemetry needs an env kill switch, and every self-test must set it (`PATTERN_INJECT_NO_LOG=1`) so tests never write the shared lab DB.
- Run hook self-tests via `scripts/run-hook-tests.sh` — never re-implement its loop. It strips the git env (`env -u GIT_DIR ...`); an inherited absolute `GIT_DIR` overrides `git -C <tmp>` and mutates the real repo.
- A gate test needs a two-sided negative control: assert the gate FIRES on a bad payload, not only that it passes a good one. If mutating the code under test leaves the suite green, the test is a decoration — fix the claim rather than adding a second decoration.

## Knowledge-base plumbing

- `docs/rules/*.md` are injected WHOLE before every edit in their domain — keep each under 6500 B (`scripts/check-rules-file-size.js`, CI). Terser is better: two domains share one budget.
- `docs/solutions/**` frontmatter arrays must stay single-line inline flow; retrieval is line-anchored, which is why `docs/solutions/` is in `.prettierignore`.
- `tags` and `applies_to` are a two-part precondition: retrieval selects by `tags` matching the file's routed domain FIRST, then partitions by `applies_to`. A glob whose paths never route to one of the solution's own tags is inert however precise it is. Check with `npx tsx scripts/lib/path-domains.ts <path>`.
- `applies_to` is matched with bash `[[ ]]`, which has no globstar; the hook also tries the `**/`-elided form, so `dir/**/*.ext` matches both `dir/file.ext` and `dir/sub/file.ext`.
- Edits to `.claude/agents/*.md` and `.claude/skills/**` take effect on session reload, not on save — never claim a behavior change works without verifying it in a fresh session.
