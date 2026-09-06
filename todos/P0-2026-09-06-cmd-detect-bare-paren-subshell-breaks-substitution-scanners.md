---
title: "lib/cmd-detect.sh: a bare-paren subshell inside $(...) desynchronises the shared substitution scanner, defeating the outward-CLI guard"
status: backlog
priority: critical
created: 2026-09-06
updated: 2026-09-06
assignee:
labels: [security, harness, cmd-detect]
github_issue:
---

# A bare `(` subshell inside `$(...)` desynchronises the shared substitution scanner

## Summary

`lib/cmd-detect.sh`'s substitution scanner counts depth for `$(` but not for a **bare** `(`,
so the first `)` of an inner subshell is read as closing the OUTER `$(...)`. Every consumer
built on that scanner then renders the command wrongly, and
`.claude/hooks/guard-outward-cli.sh` silently **ALLOWS** a real OTA publish:

```
e$( (:) )as update --branch preview     ->  ALLOW   (argv: eas update --branch preview)
```

Found by `security-auditor` during the round-3 review of PR #926 (finding C4), reproduced
independently by execution. **Not a regression** — `main` allows it identically — and **not
closed by PR #926**, whose vanishing-sigil work is what makes the gap reachable to fix.

## Background

`guard-outward-cli.sh` is the PreToolUse gate that stops an agent invoking outward-facing
CLIs unattended. This repo has a real incident from exactly that class (an accidental OTA
publish caused by an agent executing a PATH-resolved outward CLI —
`project_ota_accidental_publish_2026_08_16`), so a silent ALLOW here is critical, not
theoretical.

PR #926 added `cmd_words_vanished`, a rendering that DELETES constructs provably capable of
expanding to empty so a verb split by a vanishing sigil rejoins into the word bash actually
builds (`e` + `$(:)` + `as` -> `eas`). That closed the split-binary-name class for every
mechanism tested. This todo is the one spelling it does **not** close, and the cause is one
level below it, in the scanner the rendering is built on.

### The mechanism, measured

The scanner tracks quote state and increments depth on `$(`, but a bare `(` is an ordinary
character to it. In `$( (:) )` the first `)` therefore closes the outer construct three
characters early, and everything after it is re-scanned as if it were outside the
substitution.

Both scanner-derived functions desynchronise identically (executed, not inferred):

```
cmd_words_vanished 'e$( (:) )as update --branch preview'
  ->  'e )as update --branch preview'          # stray ')', 'eas' never forms
cmd_words_vanished 'e$(: $(:))as update --branch preview'
  ->  'eas update --branch preview'            # NESTED $( ) is handled correctly

printf '%s' 'e$( (:) )as update' | cmd_extract_substitutions
  ->  ' (:'                                    # want ' (:) '
```

The `cmd_extract_substitutions` half is **present on `main`** and mis-parses there too, so
this is a property of the shared scanner shape and not of the new rendering.

`cmd_words_deep` consumes `cmd_extract_substitutions` and therefore inherits the truncation —
but measured, it is **not exploitable through that path today**, and the todo should not claim
otherwise. Because deep APPENDS the extracted body, losing the trailing `) ` does not lose the
verb inside it:

```
cmd_words_deep 'echo $( (eas update --branch preview) )'
  -> appends ' (eas update --branch preview'    # truncated, verb intact
guard verdict: DENY
```

So the exploitable consumer is the SUBTRACTIVE one. That asymmetry is the point worth carrying
into the fix: an appending rendering degrades gracefully under a truncated extraction, a
deleting one does not, because what it deletes is decided by where it thinks the span ends.
Fix the scanner regardless — a consumer that is safe today is one refactor from not being.

### Guard impact, all four execution paths

Measured at `bf5b782e` (re-measured after the round-3 repair landed, not copied forward):

| construction                          | precise   | no-jq     | no-lib    | no-awk    | real argv                   |
| ------------------------------------- | --------- | --------- | --------- | --------- | --------------------------- |
| `e$( (:) )as update --branch preview` | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | an OTA publish to end users |
| `g$( (:) )h pr merge 42`              | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | a PR merge                  |
| `n$( (:) )pm publish`                 | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | a package publish           |
| `rail$( (:) )way up`                  | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | a deploy                    |

A `case` arm's `)` is the same defect through a different grammar and behaves identically:
`e$(case x in a) : ;; esac)as update --branch preview` -> ALLOW on all four.

Control, isolating the bare paren as the only variable — the same shape with the inner
subshell removed DENIES on all four paths:

```
e$(:)as update --branch preview          ->  DENY  ('eas update/publish/submit')
e$(: $(:))as update --branch preview     ->  DENY  (a NESTED $( ) is handled correctly)
```

An earlier draft of this table recorded no-jq/no-lib as DENY. That was real at the time but
came from a `_OUT_CRUDE_GREEDY` rendering in `guard-outward-cli.sh` which the round-3 repair
then deleted as unsound — it was the only rendering reconstructing the needle, so its
over-deletion was itself a miss. The table above is the post-repair measurement. **Re-measure
rather than trusting either version**: this row's verdict has already moved twice for reasons
unrelated to the defect itself.

## Acceptance Criteria

- [ ] Reproduce first, on the current tree, before changing anything: run each construction
      above through the hook and record the ACTUAL exit code. If any does not reproduce, that
      is a finding — report it rather than fixing something that is not broken.
- [ ] The scanner tracks bare-paren depth (or otherwise resolves the desynchronisation) so
      that `cmd_words_vanished 'e$( (:) )as update'` renders `eas update` and
      `cmd_extract_substitutions` on the same input yields `(:)`.
- [ ] The fix is applied to **every** function sharing the scanner shape, not just the one
      named in the reproduction. `cmd_extract_substitutions` and `cmd_words_vanished` both
      desynchronise today; check `cmd_words_deep` and every other consumer, and fix them in
      ONE change. Widening a detector without its sibling consumers is this file's documented
      recurring defect (`occurrence-ambiguity-guard-applied-selectively-not-uniformly-2026-08-17.md`).
- [ ] Quote state is preserved: a `(` or `)` inside single quotes, double quotes or ANSI-C
      quoting must not affect depth. The existing differential pins in `test-cmd-detect.sh`
      (`cmd_words_vanished` vs `cmd_extract_substitutions` on the same input) must stay green
      and be EXTENDED to the bare-paren cases — the two functions must agree.
- [ ] Two-sided, mutation-tested regression coverage: revert the fix, confirm the NAMED
      assertions fail, restore, confirm they pass. Per row, never in aggregate.
- [ ] All four execution paths re-checked (precise / no-jq / no-lib / no-awk), each deny
      **attributed by its REASON string** — a DENY is not evidence the intended check fired.
- [ ] False-positive population measured by EXECUTION, not estimated: a bare `(` inside
      `$(...)` is ordinary shell (`x=$( (cd /tmp && pwd) )`), so a depth change here can
      alter renderings for real commands. Harvest historical commands and diff decisions
      before/after; validate the harness on a known flip before trusting a zero.
- [ ] Corpus rows added to `repro-outward-cli-corpus.sh` for the bare-paren mechanism at the
      TOOL, VERB and FLAG positions — generated from the mechanism axis, not hand-listed.
- [ ] `docs/solutions/` entry via `/codify` if the root cause generalises.

## Implementation Notes

- **Never execute an outward-facing CLI**, including `--help` or `--version`. Feed
  constructions to the hook as JSON text:
  `jq -cn --arg cmd '<construction>' '{tool_name:"Bash",tool_input:{command:$cmd}}' | bash .claude/hooks/guard-outward-cli.sh`
  Where real argv must be proven, shadow a binary with an argv-printing stub on `PATH` —
  never strip `PATH`.
- Writing about these constructions trips the guard's own heredoc-prose false positive
  (`todos/P3-2026-08-16-command-guards-fire-on-heredoc-prose.md`), and `ALLOW_OUTWARD_CLI=1`
  clears only the single check that fired. Use file tools (`Write`/`Edit`), never route the
  content through a shell command string.
- The scanner is BSD `awk` under bash 3.2. `cmd_words_vanished`'s header already documents
  why quote states are gated the way they are (a `)` met inside a double-quoted span nested in
  an outer `$(...)` body does NOT close the outer construct) — read that before touching the
  close conditions; an earlier draft that shared the close condition across states corrupted
  everything after the first `)`.
- `cmd_words_vanished`'s header also states "NO BALANCED-BRACE WALK IS NEEDED, and that is
  not an oversight" — that claim is about `${...}` BODIES being brace-free by construction.
  It says nothing about parentheses, and must not be read as covering this case. If the fix
  changes what that paragraph asserts, update it in the same change.
- Deletion is the dangerous direction here. `cmd_words_vanished` is SUBTRACTIVE, so a wider
  deletion can DISARM a presence check — see
  `docs/solutions/logic-errors/deletion-pass-must-prove-construct-can-be-empty-2026-09-02.md`
  and the "UNIONED IN, never SUBSTITUTED FOR" rule now stated on the function itself.

## Scope Contract

- **Files in scope:** `.claude/hooks/lib/cmd-detect.sh`, `.claude/hooks/test-cmd-detect.sh`,
  `.claude/hooks/repro-outward-cli-corpus.sh`, `.claude/hooks/test-guard-outward-cli.sh`,
  and this todo.
- **Mechanism:** fix the depth/quote tracking in the shared scanner. Do NOT add a second
  hand-rolled scanner, and do NOT compensate for it inside `guard-outward-cli.sh` — a
  guard-local workaround would leave every other consumer of the lib wrong while reading as
  though the class were closed.
- No new mechanisms, files, or abstractions beyond those listed.

## Related

- PR #926 / `todos/P0-2026-09-02-outward-cli-guard-boundary-and-absorber-bypasses.md` — the
  folded repair that introduced `cmd_words_vanished` and closed every other spelling of the
  split-binary-name class.
- `todos/P0-2026-09-06-outward-cli-guard-interior-redirect-defeats-every-family.md` — a
  separate, also-open critical gap in the same guard. Different mechanism (an interior
  redirect, not a substitution scanner); do not fold them.
- `docs/solutions/logic-errors/quoted-command-substitution-always-executes-2026-08-17.md`
