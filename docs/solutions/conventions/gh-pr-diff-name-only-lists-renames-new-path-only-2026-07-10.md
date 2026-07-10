---
title: gh pr diff --name-only lists renames by new path only — patch parsing misses renamed-file content
track: knowledge
category: conventions
module: shared
tags: [gh, github-cli, pr-diff, rename, similarity-index, frontmatter, automation]
symptoms: ['A PR-inspecting script sees no frontmatter for a file that was renamed in the PR', 'Automation keyed on gh pr diff output silently skips todos/archive moves']
applies_to: [scripts/**, .claude/hooks/**, .claude/skills/**]
created: '2026-07-10'
---

# gh pr diff --name-only lists renames by new path only — patch parsing misses renamed-file content

## Rule

When automation needs a renamed file's content (frontmatter, config values) from a PR, fetch the file via the GitHub contents API — never parse it out of `gh pr diff` output.

## Why

For a rename with similarity index < 100%, `gh pr diff --name-only` lists only the destination path, and the unified patch contains only the changed hunks — the file's unchanged content (typically the frontmatter) never appears in the patch at all. Todo-archive moves (`todos/X.md` → `todos/archive/X.md`) are renames, so an "optimization" that parses the patch instead of calling the contents API is a correctness regression precisely for the files the /todo pipeline inspects most.

## Exceptions

Pure existence checks ("did this PR touch path X?") can use `--name-only` — just remember the OLD path of a rename will not appear.

## Related Files

- `scripts/todo-automerge-guard.sh` — inspects changed-file lists for auto-merge eligibility

## See Also

- [bounded CLI fetch guard — count equals limit](bounded-cli-fetch-guard-count-equals-limit-2026-07-02.md) — sibling gh-CLI output-completeness gotcha
