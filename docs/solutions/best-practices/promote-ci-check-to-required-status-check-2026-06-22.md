---
title: Promote a CI check to a required status check without bricking PRs (gate auto-merge)
track: knowledge
category: best-practices
module: shared
tags: [github-actions, branch-protection, ci, codeql, auto-merge, required-checks]
applies_to: [.github/workflows/**]
created: '2026-06-22'
---

# Promote a CI check to a required status check without bricking PRs (gate auto-merge)

## When this applies

You want a CI job — e.g. CodeQL `Analyze`, a lint job, an e2e smoke — to **gate
merges / auto-merge** by adding it to `main`'s branch-protection *required status
checks*. The trigger here: a non-gating check silently lets a **broken** scan
merge (a bad `codeql-action` bump that stops producing the Security tab would
auto-merge unnoticed because CodeQL wasn't a required check).

## Why

Adding a required check is a one-line API call with **three independent ways to
brick the merge queue**. Check each before flipping:

1. **PATCH the sub-resource, never the top-level PUT.** Use
   `gh api --method PATCH repos/<owner>/<repo>/branches/main/protection/required_status_checks`
   with the **full existing `checks` array plus the new entry** — each
   `{ "context": "...", "app_id": 15368 }` (15368 = the GitHub Actions app). The
   top-level `PUT .../branches/main/protection` *replaces the entire protection
   object* and silently drops `enforce_admins`, `required_pull_request_reviews`,
   etc. Read the current object first, append, PATCH only the sub-resource.

2. **Only require a check whose workflow runs on EVERY PR.** A required check
   that is never *reported* (its workflow was path-/event-filtered and didn't
   trigger on this PR) leaves the PR's status stuck "expected" → **BLOCKED
   forever, unmergeable**. Before requiring it, confirm the workflow's
   `on.pull_request` has **no `paths` / `paths-ignore`** that could skip it.
   (`codeql.yml`'s `pull_request: branches: ["**"]` has no path filter → runs on
   every PR → safe. Its `on.push` path filter is irrelevant to PRs.)

3. **The required `context` must EXACTLY match the job's reported check name.**
   Matrix jobs report as `<job name> (<matrix value>)` — `name: Analyze (${{ matrix.language }})`
   with `language: [javascript-typescript]` reports as
   `Analyze (javascript-typescript)`. A typo'd context never matches → permanent
   "expected" → block. Read the live name from `gh pr checks <pr>` before pinning.

Plus one semantic nuance for CodeQL specifically:

4. **CodeQL `Analyze` gates on the scan RUNNING, not on findings.** The check is
   green as long as init + analyze + upload succeed — it catches a *broken
   action / setup*, which is the goal. Code-scanning *alerts* (vulnerabilities
   found) stay non-blocking unless you separately require the "Code scanning
   results" check (noisier — promote that only after triaging initial findings).

**Always validate with a throwaway PR.** Push a trivial change (a comment)
through the new gate and watch it: the right context name + an always-running
workflow means it goes green and merges; a misconfig means it hangs "expected".
Proving it by-PR is the only way to be sure you didn't brick the merge queue —
do not trust the context name by eye.

## Examples

Append `Analyze (javascript-typescript)` to the existing required checks:

```bash
# 1. read current (note strict + every {context, app_id})
gh api repos/OWNER/REPO/branches/main/protection/required_status_checks

# 2. PATCH the SUB-resource with full array + the new check. Put the body in a file
#    to dodge shell-quoting on the "·" / "(...)" in context names:
#    { "strict": false, "checks": [ ...existing...,
#        { "context": "Analyze (javascript-typescript)", "app_id": 15368 } ] }
gh api --method PATCH repos/OWNER/REPO/branches/main/protection/required_status_checks --input checks.json

# 3. verify the write, then PROVE it with a throwaway PR (watch it merge through the gate)
gh api repos/OWNER/REPO/branches/main/protection/required_status_checks --jq '.contexts'
```

## Exceptions

- `enforce_admins: false` lets a repo admin/owner bypass required checks on a
  direct push, and an admin's auto-merge fires once the *required* checks pass.
  So a non-gating job (absent from the required list) won't block an owner's
  auto-merge even if it's red.
- If `required_pull_request_reviews.required_approving_review_count ≥ 1` is set,
  it only fails to block solo auto-merge PRs *because* `enforce_admins` is false.
  Re-enabling admin enforcement while a review requirement is set will suddenly
  block every solo auto-merge PR on the missing approval.

## Related Files

- `.github/workflows/codeql.yml` — the gated workflow; its header comment
  documents that `Analyze` is a required check and what that gates on
- Branch protection lives in GitHub settings / the `branches/main/protection`
  API, not a repo file

## See Also

- [verify a github action's node runtime before bumping its major](../conventions/verify-github-action-node-runtime-before-major-bump-2026-06-22.md) — the sibling CI-actions lesson from the same session
