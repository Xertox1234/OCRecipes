---
title: "Review subagents cannot load the binding rules: tsx fails with EPERM in their sandbox"
status: backlog
priority: low
created: 2026-11-26
updated: 2026-11-26
assignee:
labels: [deferred, harness]
github_issue:
---

# Review subagents cannot load the binding rules: tsx fails with EPERM in their sandbox

## Summary

The review dispatch prompt tells each reviewer to run
`npx tsx scripts/lib/path-domains.ts --typescript-crosscut <files>` to learn which
`docs/rules/*.md` files bind the diff. Inside the reviewer's sandbox `tsx` cannot create its
IPC pipe (`listen EPERM ... /tmp/claude-501/tsx-501/<pid>.pipe`), so the command fails. Most
reviewers then skip the rules files entirely and judge from the code alone.

## Background

Seen on every review of the coach chat audit bundle H PRs on 2026-11-26 (#2069, #2070, #2072,
#2073, #2075, #2076): code-reviewer, server-reviewer, ai-reviewer and mobile-reviewer each
reported the EPERM and said the rules were not loaded. One security-auditor run did read them.
The main session hits the same error running `npx tsx` sandboxed; it works with the sandbox off.

## Acceptance criteria

- A reviewer dispatched with the standard prompt gets the rules domain list for its files
  without a sandbox failure (for example: precomputed by the dispatcher and passed in the
  prompt, a plain-node entry point that needs no tsx IPC, or the pipe directory allowed).
- A reviewer that still cannot get the list says so and reads the rules for the obvious
  domains of its paths instead of skipping them.

## Notes

Medium/Low per CLAUDE.md, so filed as a todo. Not a `.claude/hooks/**` finding: the prompt
text comes from the review-dispatch mod, the failure is the subagent sandbox.
