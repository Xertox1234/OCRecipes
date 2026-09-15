---
title: "A root-position flag whose VALUE is a bare dash hides the namespace from both merge guards — gh's own documented stdin spelling"
status: backlog
priority: high
human_led: true
blocked_reason: "Closing this is a DESIGN decision, not a spec. Telling `gh --no-color pr merge 42` (no-arg flag, namespace next) apart from `gh -F - pr merge 42` (value-taking flag whose value is a dash) requires the tool's FLAG TABLE — which flags consume an argument — and a regex does not have one. The two candidate directions have opposite costs and neither is obviously right: (a) re-name the separate-arg flags, which re-imports the enumeration the whole root-position fix exists to avoid and goes stale the next time `gh` ships a flag; (b) let the value arm accept a leading dash, which breaks the no-arg case that is currently pinned as a two-sided control (`gh --no-color pr merge 42` would stop resolving) and re-opens a different family. An unattended run would pick whichever is cheaper to implement and write it up as a settled decision record — for a merge gate, on lib/cmd-detect.sh, which feeds main's required Outward-CLI guard corpus check."
created: 2026-09-15
updated: 2026-09-15
assignee:
labels: [deferred, harness, security]
github_issue:
---

# A root flag whose value is a bare dash hides the namespace from both merge guards

## Summary

`gh -F - pr merge 42 -R other/org` is a **cross-repository merge that both
`guard-outward-cli.sh` and `merge-review-guard.sh` allow**. `-` is not an invented spelling:
`man gh-pr-merge` documents `-F, --body-file <file>` as _"Read body text from file (use `-` to
read from standard input)"_, so it is a gh-authored value that begins with a dash.

This is the last live member of the root-position family that
`todos/archive/P0-2026-09-13-repo-retarget-flag-in-root-position-defeats-both-merge-guards.md`
closed. It is **pre-existing** — it is allowed on `main` today and was allowed before that P0's
work began, which neither opened nor closed it.

## Measured 2026-09-15

Fed to the real hooks as `PreToolUse` JSON envelopes, empty stamp root, `env -u
SKIP_MERGE_REVIEW -u ALLOW_OUTWARD_CLI`, bash 5.3.15. Cells are outward-guard / merge-review.

**On `main` (ca06d0bb) — the value arm has not landed yet, so the whole family is open:**

| command                      | verdict       |
| ---------------------------- | ------------- |
| `echo hello` _(control)_     | ALLOW / ALLOW |
| `gh pr merge 42` _(control)_ | DENY / DENY   |
| `gh -F notes.md pr merge 42` | ALLOW / ALLOW |
| `gh -F - pr merge 42`        | ALLOW / ALLOW |

**On `fix/gh-root-flag-property-arm` (7bee4c5b) — after the value arm, the ordinary value closes
and the dash value does not:**

| command                            | verdict         |
| ---------------------------------- | --------------- |
| `gh -F notes.md pr merge 42`       | **DENY / DENY** |
| `gh -F - pr merge 42`              | ALLOW / ALLOW   |
| `gh --body-file - pr merge 42`     | ALLOW / ALLOW   |
| `gh -F - pr merge 42 -R other/org` | ALLOW / ALLOW   |

**The ordinary-value row is the isolating control** — same flag, same position, only the value
differs — which is what places the mechanism in the VALUE SHAPE rather than in the flag or the
arm.

> **Sequencing note.** Until that branch merges, this todo describes a gap inside a larger gap.
> Its distinctive claim — that the dash spelling survives a fix which closes every other value
> — only becomes true on main when the value arm lands. Re-measure before working it.

## Mechanism

`_CMD_GH_GLOBALS`'s generic arm is `-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?`.
The value token must NOT begin with `-`. A bare `-` therefore matches neither:

- the **value** arm (it begins with a dash), nor
- a fresh **flag** arm (`-[^[:space:]]+` needs at least one character after the dash).

So the globals run ends at the `-`, the needle never reaches `pr`, and every consumer goes
blind at once. Verified at the grammar level: ` -F notes.md` spans, ` -F -` refuses.

**The refusal is deliberate and load-bearing elsewhere.** It is exactly what lets a NO-ARG flag
sit immediately before the namespace — `gh --no-color pr merge 42` resolves only because the
engine declines the optional value group rather than eating `pr`. That row is pinned as a
two-sided control in `test-cmd-detect.sh`. Any fix must keep it.

## Acceptance Criteria

- [ ] `gh -F - pr merge 42 -R other/org` is DENIED by both layers, on the **retarget** reason
      for the outward guard rather than a generic one.
- [ ] `gh -F - pr merge 42` and `gh --body-file - pr merge 42` are DENIED by both layers.
- [ ] The three tripwire rows in `test-cmd-detect.sh` (search `KNOWN GAP: a documented stdin
    value`) are **converted**, not deleted — they currently pin the gap as open.
- [ ] Two-sided in the same run, all still ALLOW/resolve: `gh --no-color pr merge 42`,
      `gh -q -v --no-color pr close 42`, `gh -R o/r pr list`, `gh -t x pr view 42`, and a commit
      message naming the shape.
- [ ] The decision recorded with its reasoning — see `blocked_reason`. Whichever direction is
      taken, say why the other was rejected.
- [ ] Corpus rows generated from the product of {flag} × {value shape} × {verb}, not hand-listed,
      with at least one flag that does not exist in `gh` (the property-not-a-list control).
- [ ] `Outward-CLI guard corpus` re-pinned green against branch ⊕ main.

## Implementation Notes

The constant is `_CMD_GH_GLOBALS` in `.claude/hooks/lib/cmd-detect.sh` — cite by name, not line;
that block moved repeatedly during the P0 work. The residual is already disclosed in its header
(search `OPEN RESIDUAL, AND IT IS THE HEADLINE CLASS WEARING A DIFFERENT VALUE`) with the
measurement inline; update that block rather than adding a second account.

**Derive the value-taking flag set from the tool if you go that route:**

```
man /opt/homebrew/share/man/man1/gh-pr-<verb>.1 | col -b \
  | grep -oE '^[[:space:]]*(-[A-Za-z], )?--[a-z-]+ <[^>]+>'
```

Grep the placeholder as `<[^>]+>`, not `<[a-z-]+>` — the narrower class silently drops
`--match-head-commit <SHA>` on the placeholder's case.

**Read first:**
`docs/solutions/logic-errors/an-invented-enumeration-is-not-the-space-ask-the-tool-2026-09-13.md`
— why option (a) is a trap, written from the defect that produced this family.
`docs/solutions/logic-errors/widening-is-monotone-on-a-boolean-read-not-on-a-count-2026-09-14.md`
— before widening the arm for option (b), classify every consumer by direction AND arity. That
step was skipped once already on this constant and produced a deny→allow regression at the merge
gate's one extraction-fed allow-shaped read.

## Risks

- `lib/cmd-detect.sh` feeds `merge-review-guard.sh`, `pr-verify.sh` and `pr-preflight-guard.sh`,
  and the corpus is main's 9th **required** check with no `paths:` filter — a careless edit
  wedges every open PR.
- **Over-denial has no per-command escape in the merge gate.** `SKIP_MERGE_REVIEW` is read from
  the launching shell only, so a false deny costs a session restart and gets the gate switched
  off. Pair every new deny row with a prose-still-allowed row in the same run.
- The `--auto` carve-out in `guard-outward-cli.sh` is the one grant-shaped read in that file;
  three live false grants were found there during the P0 work. Measure against it explicitly.

## Dependencies

None blocking. Sequenced after `fix/gh-root-flag-property-arm` (PR #957) only in the sense that
the gap's shape changes when that lands — see the sequencing note above.

## Updates

### 2026-09-15

Filed at the user's explicit direction after being surfaced as a high-severity finding rather
than auto-filed, per the repo's never-auto-file bar. Independently reproduced by a second
session during a review sweep before filing. Disclosed in `lib/cmd-detect.sh` and pinned with
three tripwire rows plus an isolating control in `test-cmd-detect.sh` on
`fix/gh-root-flag-property-arm`; this todo is the tracking half of that disclosure.
