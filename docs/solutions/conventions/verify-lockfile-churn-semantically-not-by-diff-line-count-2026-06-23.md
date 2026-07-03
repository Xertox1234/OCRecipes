---
title: 'Verify lockfile churn semantically (parse + per-path compare), never by git diff line count'
track: knowledge
category: conventions
module: shared
tags: [npm, lockfile, package-lock, dependencies, code-review, git-diff]
applies_to: [package-lock.json]
created: '2026-06-23'
---

# Verify lockfile churn semantically (parse + per-path compare), never by git diff line count

## Rule

When a `package-lock.json` change shows a large `git diff`, **do not judge the blast radius by the diff line count or `--stat`.** Parse both lockfiles and compare the `packages` map **by path**, then categorize the real changes (added paths / removed paths / version changes). Only commit a lockfile change once you've confirmed *which* packages actually changed.

## Smell patterns

- A one-line `package.json` change (e.g. adding a single devDependency) produces a `git diff --stat` of tens of thousands of lines on `package-lock.json`.
- Reviewers balk at an "unreviewable" lockfile diff and either rubber-stamp it or block on volume alone.
- A claim like "this dependency bump churned 1400 packages" derived purely from `grep -c '"version":'` on the diff.

## Why

Git stores file **content**, not diffs. A huge `git diff` is often a **rendering artifact** of the default Myers algorithm aligning a structurally-shifted JSON file poorly — not real churn. In the esbuild fix (PR #439), adding one devDependency rendered as a **29,051-line** Myers diff, yet:

- the two files differed by **one line** (23915 → 23916),
- `--diff-algorithm=histogram --ignore-all-space` showed the real diff was **~1,189 lines**, and
- a semantic per-path parse showed the change was **esbuild-only**: 27 paths added, 27 removed, 23 version changes, **0 non-esbuild packages affected** (react-native / expo / metro byte-identical).

Trusting the line count would have falsely flagged a surgical fix as a dangerous tree-wide churn (the exact RN/Metro-toolchain churn the project warns against) — or, inversely, could hide a real upgrade buried in the noise.

## Examples

**Semantic per-path comparison (authoritative):**

```bash
python3 - <<'PY'
import json, subprocess
old=json.loads(subprocess.check_output(['git','show','HEAD:package-lock.json']))['packages']
new=json.load(open('package-lock.json'))['packages']
common=set(old)&set(new)
ver_changed=[(p,old[p].get('version'),new[p].get('version'))
             for p in common if old[p].get('version')!=new[p].get('version')]
print("paths added:  ", len(set(new)-set(old)))
print("paths removed:", len(set(old)-set(new)))
print("version changes:", len(ver_changed))
# filter to the package(s) you expect to change; assert everything else is untouched
PY
```

**Quick sanity levers (supporting, not authoritative):**

```bash
git diff --stat --ignore-all-space --diff-algorithm=histogram -- package-lock.json   # truer size
echo -n "HEAD lines:    "; git show HEAD:package-lock.json | wc -l                    # raw length delta
echo -n "working lines: "; wc -l < package-lock.json
```

**Isolate npm-version drift from your change:** restore both manifests, regenerate the lockfile with **no** source change, and confirm zero churn — this proves the lockfile is in sync with your npm version and any later churn is attributable to *your* edit:

```bash
git checkout HEAD -- package.json package-lock.json
npm install --package-lock-only --no-audit   # 0 version-line changes ⇒ no drift
```

## Exceptions

- A genuine `npm audit fix --force` / version-range widening *will* legitimately churn many packages — the semantic compare is what tells you it's real, not a reason to skip the check.
- `lockfileVersion` bumps (e.g. 2 → 3) reformat the whole file legitimately; compare semantically and confirm versions are stable.

## Related Files

- `package-lock.json`
- `package.json`

## See Also

- [a peerDependency resolves the wrong root-hoisted transitive](../code-quality/peer-dependency-resolves-stale-root-hoisted-transitive-2026-06-23.md) — the fix whose lockfile this verification rule was extracted from
