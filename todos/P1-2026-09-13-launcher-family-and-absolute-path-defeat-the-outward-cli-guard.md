---
title: "A launcher prefix (npx / npm exec / bunx / pnpm dlx) or an absolute path defeats guard-outward-cli.sh, and `npm exec eas update` is a live OTA path"
status: backlog
priority: high
created: 2026-09-13
updated: 2026-09-13
assignee:
labels: [deferred, harness, security]
github_issue:
---

# A launcher prefix or an absolute path reaches a real publish

## Summary

`guard-outward-cli.sh` anchors its detectors on the bare command word (`eas`, `railway`, `npm`,
`pnpm`, `yarn`, `gh`) in command position. Two shapes never present that word where the guard
looks:

1. **A launcher prefix** — `npx eas update`, `npm exec eas update`, `bunx eas-cli update`,
   `pnpm dlx`, `yarn dlx`. The gated binary is an _argument to another binary_.
2. **An absolute or relative path** — `/opt/homebrew/bin/eas update`. `_OUT_POS_PREFIX`
   (`:1606`) anchors on a shell-metacharacter class with no path-separator branch.

**`npm exec eas update --branch preview` is ALLOW today and publishes a real OTA to real
`preview` users.** `/opt/homebrew/bin/eas` is the real CLI on this machine.

## Background

Filed 2026-09-13 out of the security review of PR #952, which ruled the design of the
complementary PATH wrapper (`todos/P1-2026-09-07-outward-cli-path-wrapper.md`). That todo's
ruling 4 keeps the wrapper at three binaries (`eas`, `railway`, `gh`) and **assigns this
coverage to the guard-text layer** rather than to a shim, because shimming `npm`/`npx` would put
a refusal in front of husky, lint-staged and `preflight:fast`.

**This is a live gap, not a hypothetical one.** The guard's own header already concedes the
launcher half at `.claude/hooks/guard-outward-cli.sh:147-149` and the path half at `:179-181` —
both as known limitations. What is new is the measurement that one of them is a reachable OTA
publish.

### Measured 2026-09-13

Text-only: PreToolUse envelopes fed to the hook on stdin. **Nothing was executed.** Interpreter
asserted in the probe output (`bash 5.3.15`).

| command                                   | guard verdict |
| ----------------------------------------- | ------------- |
| `npm exec eas update --branch preview`    | **ALLOW**     |
| `eas update --branch preview` _(control)_ | DENY          |
| `ls -la` _(control)_                      | ALLOW         |

Both controls held, so the harness renders both verdicts rather than one for everything. A wider
grid run during the PR #952 review found **ten** ALLOW launcher forms, including `npx`, `npx -y`,
`npx --yes`, `npm exec`, `bunx`, `bun x`, `bun run`, `pnpm dlx`, `yarn dlx`.

**Population note, and it matters:** `bunx`, `bun`, `pnpm` and `yarn` are **not installed** on the
reference machine — only the `npm`/`npx` forms are live here. Do not quote the ten-row figure as
ten live paths. Re-derive the live subset on whatever machine the fix is verified on, and quote
the count with the corpus that produced it.

### A second control splits the two shapes — do not treat them as one

`merge-review-guard.sh` is a separate live control on `gh pr merge`, and it does **not** miss both:

| command                                     | merge-review-guard |
| ------------------------------------------- | ------------------ |
| `gh pr merge 42 --squash` _(control)_       | DENY               |
| `npx gh pr merge 42 --squash`               | **DENY**           |
| `/opt/homebrew/bin/gh pr merge 42 --squash` | **ALLOW**          |

So the launcher shape is already caught on that one route while the path shape slips it —
consistent with this repo's known path-qualified extractor gap
(`todos/P1-2026-09-12-merge-review-guard-extractor-miss-is-a-silent-allow.md`). Any claim about
"the" control being defeated must name the hook.

## Acceptance Criteria

- [ ] Reproduce each row above against unmodified `main` first, per shape. If a row does not
      reproduce, report that rather than fixing something that is not broken.
- [ ] The launcher family DENIES for every gated binary: the gated word is detected when it
      appears as the **argument of a launcher**, not only in command position.
- [ ] Absolute- and relative-path invocation DENIES — `/opt/homebrew/bin/eas update`,
      `./node_modules/.bin/eas update`, `../eas update`.
- [ ] **Corpus GENERATED from its dimensions** (launcher form × binary spelling × gated verb ×
      path form), never hand-listed, with every count quoted together with the corpus that
      produced it **and its applicable denominator**. Mark which rows are live on the machine
      used, since four of the launcher families are not installed on the reference host.
- [ ] **A false-positive sweep in the same pass**, because widening a command-position anchor is
      the direction that invents denials. `npx tsc`, `npx prettier --write`, `npm exec vitest`,
      `npx eas-cli --version`-shaped read-onlys, `/usr/bin/git status`, and ordinary prose
      mentioning these words must all stay ALLOW.
- [ ] No ALLOW → DENY transition for any row outside the two named shapes; the change must be
      strictly tightening on the axes it touches.
- [ ] Mutation-verified per shape, not in aggregate: reverting the launcher clause reddens only
      launcher rows, and reverting the path clause reddens only path rows.
- [ ] `.claude/hooks/repro-outward-cli-corpus.sh` passes with per-path verdicts and deny
      attribution unchanged, or the pin is updated with the delta explained. **It is a REQUIRED
      check on `main`** — mutation-verify against **branch ⊕ current main**, never the bare tip.
- [ ] The guard's header residuals at `:147-149` and `:179-181` are updated to say what is now
      closed, rather than left describing a gap that no longer exists. (Leaving a stale "CONFIRMED
      LIVE" entry in that block is exactly what caused two wrong citations during the PR #952
      review.)

## Implementation Notes

- **Never execute an outward-facing CLI to test this**, `--help`/`--version` included. Feed
  PreToolUse envelopes to the hook on stdin; if a probe needs argv, shadow with argv-printing
  stubs writing to a sentinel FILE, never stdout (a redirect in the construction swallows stdout
  and the probe then reports "not invoked" for something that really did invoke).
- **Write the envelope to a file and redirect it in.** Putting the gated text directly in a Bash
  command line trips the guard against your own probe.
- The launcher and path shapes are **two axes, not one family** — the `merge-review-guard.sh`
  table above proves they are covered differently by a second hook. Close them as two clauses
  with two mutation tests, and do not let one axis's green stand in for the other's.
- Check whether `lib/cmd-detect.sh` should own the launcher grammar so
  `merge-review-guard.sh` and `git-safety.sh` inherit it, rather than spelling a third private
  copy in `guard-outward-cli.sh`. A hand-spelled class is invisible to a constant sweep and is
  this file's most-repeated defect.

## Related

- `todos/P1-2026-09-07-outward-cli-path-wrapper.md` — the PATH wrapper. Its ruling 4 (re-ruled
  2026-09-13) assigns this coverage here rather than to a shim. The wrapper and this todo are a
  **union**: the wrapper closes bare-name `PATH` resolution, this closes the two spellings that
  never resolve that way.
- `todos/P1-2026-09-12-merge-review-guard-extractor-miss-is-a-silent-allow.md` — the
  path-qualified extractor gap the `gh` table above touches.
- `.claude/hooks/guard-outward-cli.sh:147-149`, `:179-181` — the guard's own concessions.
