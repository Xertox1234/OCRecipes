<!-- Filename: P3-2026-07-03-claude-md-trim.md -->

---

title: "Trim CLAUDE.md (~199 → ~110 lines): cut package.json/architecture restatements, keep footguns"
status: backlog
priority: low
created: 2026-07-03
updated: 2026-07-03
assignee:
labels: [deferred, harness]
github_issue:

---

# Trim CLAUDE.md (~199 → ~110 lines): cut restatements, keep footguns

## Summary

CLAUDE.md is ~199 lines and reloads into context every session. The audit recommended ~110 by
cutting content that merely restates package.json scripts, the architecture stack, and sections
already living in auto-memory / skills / hooks — while KEEPING the footgun annotations and the
env-var inventory. From the 2026-07-02 harness audit (`docs/research/2026-07-02-harness-audit.md`,
CONSOLIDATE #5).

**This is a manual/local task — CLAUDE.md is gitignored, so it is a local working-copy edit,
not a PR, and is NOT `/todo`-automatable.** (See below.)

## Background

CLAUDE.md is always-loaded context, so every duplicated line taxes every session's token
budget — which itself works against the drift goal (more surface to keep in sync). The audit
found large chunks duplicate: the package.json "Development Commands", the "Architecture"
stack lists (derivable from code), and sections restated verbatim in `MEMORY.md`, a skill, or
a hook.

## Acceptance Criteria

- [ ] CLAUDE.md reduced toward ~110 lines by removing: - Development Commands that only restate `package.json` — **but KEEP the footgun
      annotations** (e.g. the EAS `--message`/`--platform` locks, `--allow-prod-seed`,
      `db:push` pg_trgm note). - "Architecture" stack lists that are derivable from the code / already in `MEMORY.md`. - Any section duplicated verbatim in `MEMORY.md`, a `.claude/skills/*/SKILL.md`, or a hook.
- [ ] KEEP intact: Workflow Standards, the Key Patterns / inject-hook mechanics, the
      Deferred-Todos policy, and the **full Environment Variables inventory** (no `.env.example`
      exists — CLAUDE.md is the only inventory of them).
- [ ] Each cut diff-reviewed to confirm it is a restatement, not a unique fact — no loss of the
      footgun knowledge the audit explicitly flagged as load-bearing.

## Implementation Notes

- **CLAUDE.md is gitignored** (see the `project_claude_md_untracked` memory) — edits are
  local-only and invisible to CI/PRs. Do this **by hand in the working copy**, not via a
  `todo-executor` worktree (which would fork from committed HEAD, produce a throwaway local
  diff, and land nothing).
- Judgment-heavy (restatement vs unique fact) — wants a human or an interactive session, not an
  autonomous `/todo` run. Cross-check each candidate cut against `MEMORY.md` and the relevant
  skill/hook before deleting.

## Dependencies

- Light coupling to `todos/P3-2026-07-02-solutions-kb-markdown-canonical.md`: that todo's AC
  rewrites CLAUDE.md's "Key Patterns" section to the markdown-only injection flow. Do this trim
  **after** it (or fold the Key-Patterns rewrite in) to avoid editing the same section twice.

## Risks

- Over-trimming a unique footgun. Mitigation: diff every cut against the sources above.
- Because CLAUDE.md is gitignored there is **no PR review net** — the diff-check is entirely
  manual, so err toward keeping a line when unsure it's a pure restatement.

## Updates

### 2026-07-03

- Initial creation. Filed from the 2026-07-02 harness audit (CONSOLIDATE #5). Flagged
  manual/local (gitignored) and NOT `/todo`-automatable — pick it up in an interactive session.
