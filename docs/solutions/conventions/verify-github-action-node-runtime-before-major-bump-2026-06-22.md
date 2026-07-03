---
title: Verify a GitHub Action's Node runtime via runs.using before bumping its major
track: knowledge
category: conventions
module: shared
tags: [github-actions, ci, node-runtime, deprecation, version-pinning]
applies_to: [.github/workflows/**]
created: '2026-06-22'
---

# Verify a GitHub Action's Node runtime via runs.using before bumping its major

## Rule

Before bumping an `actions/*` or `github/codeql-action/*` major **to clear a
Node-runtime deprecation**, read the **pinned tag's `action.yml` `runs.using`**
to confirm the target major actually ships the newer runtime. Do not trust the
releases-page summary, the "latest" label, or the assumption that a higher major
number means a newer Node runtime.

## Smell patterns

- A CI annotation warns an action runs on a deprecated Node runtime (e.g.
  node20), and the reflex is "bump it one major" or "bump to latest-minus-one."
- Picking a version from the GitHub releases page without opening the tag's
  `action.yml`.

## Why

Action major versions **do not track the Node runtime linearly**. Concretely
(verified 2026-06):

- `actions/upload-artifact`: **v5 still runs node20**; **v6 is the first node24
  major**; v7 is latest (node24). So "bump upload-artifact one major" (v4→v5)
  lands you **back on node20** and does NOT clear the deprecation.
- `github/codeql-action`: **v4 is the current node24 major**; there is no v5
  (the tag 404s). `init` and `analyze` must move together to the same major.
- `actions/checkout`, `actions/setup-node`: v5 = node24 (bumped in #424).

Only reading `runs.using` on the exact tag you intend to pin tells you the
truth; the version-to-runtime map is not monotonic.

## Examples

```bash
# read runs.using for the tag you plan to pin.
# QUOTE the URL — an unquoted "?" triggers zsh globbing ("no matches found").
gh api "repos/actions/upload-artifact/contents/action.yml?ref=v7" \
  --jq '.content' | base64 -d | grep -A2 '^runs:'
# → using: node24   ✅ pin @v7   (the same probe on @v5 shows node20 ❌)
```

- #424 cleared `checkout` / `setup-node` (→ v5 = node24).
- #434 cleared the tail: `upload-artifact@v4→v7`, `codeql-action/{init,analyze}@v3→v4`
  — each verified against its own `action.yml` `runs.using` before pinning, not
  the releases page.

## Exceptions

- A SHA-pinned action (`@<40-char-sha>`) freezes both code and runtime; when
  bumping it, resolve the SHA to its tag and check that tag's `runs.using`.
- `.github/dependabot.yml` can automate these bumps **only** if a
  `github-actions` ecosystem entry exists — this repo deliberately has none
  (npm-only), so action bumps are manual and won't be auto-PR'd.

## Related Files

- `.github/workflows/*.yml` — every `uses: org/action@vN` pin
- `.github/dependabot.yml` — no `github-actions` ecosystem entry (intentional)

## See Also

- [promote a ci check to a required status check without bricking prs](../best-practices/promote-ci-check-to-required-status-check-2026-06-22.md) — the sibling branch-protection lesson from the same session
