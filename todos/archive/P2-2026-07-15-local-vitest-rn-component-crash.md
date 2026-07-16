---
title: "Local vitest crash on all RN component/hook tests: 'No such built-in module: node:'"
status: backlog
priority: medium
created: 2026-07-15
updated: 2026-07-15
assignee:
labels: [testing, infra]
github_issue:
---

# Local vitest crash on all RN component/hook tests

## Summary

Every React Native component/hook test (anything rendering via the RN/jsdom shim layer) currently fails to even collect on this local machine, crashing with `Error: No such built-in module: node:`. Pure-function tests are unaffected.

## Background

Found during end-to-end validation of the new `/todo-fast` skill (docs/superpowers/plans/2026-07-15-todo-fast-skill.md, PR #632). Scoped and ruled out as a code/branch issue:

- Reproduces with `npx vitest run client/screens/__tests__/LoginScreen.test.tsx` (and any other RN component/hook test file tried).
- Reproduces on a completely unmodified main checkout (branch `guard/merge-approval-hook`, zero of the `/todo-fast` branch's commits) — not caused by that branch's changes.
- Does **not** reproduce in CI: GitHub's `CI` workflow is green on recent `origin/main` commits (checked via `gh run list --branch main`), meaning a clean-environment run of the same suite passes.

Conclusion: local-machine-specific (stale `node_modules`, a cache, a Node/Vite version mismatch, or similar), not a defect in the repository's code or dependencies. Not root-caused further — that's this todo's job.

One clue not yet chased down: the crash is immediately preceded by a vite warning —

```
[vite] (client) warning: Module "node:module" has been externalized for browser compatibility,
imported by "test/setup.ts". See https://vite.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility
```

— suggesting the RN/jsdom test path's Vite transform is choking on a `node:` built-in import somewhere in `test/setup.ts`'s (or a dependency's) resolution chain, specifically in this local environment.

## Acceptance Criteria

- [ ] Root-cause why this local environment hits the crash (stale `node_modules`, Node version, Vite/vitest version drift, corrupted cache, or something else)
- [ ] `npx vitest run client/screens/__tests__/LoginScreen.test.tsx` (or any other RN component test) passes locally
- [ ] Confirm the fix isn't needed repo-wide (i.e., don't "fix" something that was never broken for other developers/CI) before changing any tracked config

## Implementation Notes

- Start by ruling out the obvious local-environment culprits before touching any tracked file: `rm -rf node_modules && npm ci`, check `node --version` against whatever the project expects, clear any Vite/vitest cache directories.
- If a tracked config or dependency version does turn out to be the cause, treat that as a much higher-severity finding — it would mean CI got lucky rather than the repo actually being healthy — and re-verify against CI green/red before concluding a code fix is needed.
- `test/setup.ts` is the file the vite warning names — start there.

## Dependencies

None.

## Risks

- Could be difficult to reproduce/diagnose if it's tied to something environment-specific to this one machine (stale global npm cache, an nvm version switch, etc.) that isn't easily inspectable from within a session.

## Updates

### 2026-07-15

- Filed after discovery during `/todo-fast` plan validation (PR #632) — confirmed pre-existing, repo-wide-reproducible-locally-only, CI unaffected.
