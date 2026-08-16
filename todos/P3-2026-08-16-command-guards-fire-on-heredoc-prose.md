---
title: "Writing ABOUT a guarded command in a commit message or PR body trips the command guards"
status: backlog
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, harness, agents]
github_issue:
---

# A heredoc body reads as command position, so documenting a deny trips the deny

## Summary

`.claude/hooks/lib/cmd-detect.sh`'s command-position anchors are per-line (`^`-anchored),
and `cmd_bare` blanks quoted spans but not heredoc bodies. So a commit message or PR body
written with `<<'EOF'` that _mentions_ a guarded command on its own line is seen as an
invocation. Documenting a guard's behaviour trips that guard.

## Background

Hit twice in one session, 2026-08-16, both while doing the correct thing:

1. **`pr-preflight-guard.sh`** blocked a `git commit` whose heredoc message body contained
   a line-initial `gh pr create` (reported by the PR #844 executor, which reworded the
   message rather than bypassing).
2. **`guard-outward-cli.sh`** blocked a `gh pr create` whose `--body` heredoc contained a
   table of `npm run … update:preview` bypass spellings — i.e. the PR _explaining_ the fix
   was blocked by the fix. Worked around with `--body-file`, which keeps the guard fully
   armed because the command string itself is then clean.

Both are **fail-safe** (a deny, never a silent allow) and both have clean workarounds, so
this is friction, not a hole. But it has a real cost: the natural way to document a guard
is to quote the commands it blocks, and an agent that hits the deny may reword the
documentation into vagueness — degrading exactly the record that makes the guard
understandable later.

Note this is NOT the quoted-mention case, which is already handled correctly:
`git commit -m "add eas update guard"` allows, because `cmd_bare` blanks the quoted span.
It is specifically heredoc bodies.

## Acceptance Criteria

- [ ] Decide and record the intended behaviour: either (a) heredoc bodies are blanked like
      quoted spans, or (b) they deliberately are not, and `--body-file` / `--message-file`
      is the documented pattern
- [ ] If (a): `cmd_bare` blanks `<<'EOF' … EOF` / `<<EOF … EOF` bodies, with a two-sided
      test — a heredoc _mentioning_ a guarded command allows, while a heredoc that actually
      _pipes_ one into a shell still denies
- [ ] If (b): the residuals block in `guard-outward-cli.sh` and the equivalent in
      `pr-preflight-guard.sh` name this case explicitly, so the next agent recognises it
      instead of rewording its commit message
- [ ] Either way, `docs/AI_WORKFLOW.md` or the relevant skill notes `--body-file` as the
      way to write about a guarded command
- [ ] Closes with zero follow-ups

## Implementation Notes

- Option (b) is probably right and is much cheaper. Blanking heredoc bodies weakens a
  genuine attack surface — `bash <<'EOF' … eas update … EOF` really is an invocation — and
  distinguishing "heredoc fed to an interpreter" from "heredoc fed to `gh --body`" means
  parsing which command consumes the redirect. That is a parser, not a regex.
- If (b), the cheapest real improvement is the deny message: add one line pointing at
  `--body-file`/`--message-file` when the matched text sits inside a heredoc. Even a crude
  "the match was inside a `<<` body — if you are documenting rather than invoking, use
  `--body-file`" would have saved both incidents.
- Do not weaken the anchors to fix this. Both guards are deny gates; a fail-safe false
  positive with a documented workaround is the correct trade.

## Scope Contract

- **Mechanisms to use:** the existing `cmd_bare` / anchor machinery and the existing deny
  messages — no new parser unless option (a) is chosen and justified
- **Files in scope:** `.claude/hooks/lib/cmd-detect.sh`, `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/pr-preflight-guard.sh`, their co-located `test-*.sh`, and one doc note
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR #844 and the follow-up #846 are the source incidents.

## Risks

- Option (a) risks a real bypass: anything that blanks a heredoc body also blanks a heredoc
  actually piped into `bash`/`sh`/`eval`. If (a) is chosen, that pairing must be pinned as
  a deny test first.
- Low urgency — both failures are denies with working workarounds.

## Updates

### 2026-08-16

- Filed during the review round for PRs #833–#845, after the same class fired twice: once
  on `pr-preflight-guard.sh` (reported by #844's executor) and once on
  `guard-outward-cli.sh` while opening #846.
