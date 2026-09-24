---
title: "React Compiler silently skips 61 of 226 client .tsx files, and nothing in lint or CI surfaces a bailout"
status: backlog
priority: medium
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, performance, tooling]
github_issue:
---

# React Compiler silently skips 61 of 226 client .tsx files, and nothing in lint or CI surfaces a bailout

## Summary

The project rule "React Compiler is ACTIVE — don't add manual memo" holds only for components that actually compile. Measured on 2026-09-23: 61/226 client `.tsx` files contain a skipped component, including CoachChat, HomeScreen, MealPlanHome and RecipeBrowser. There is no lint or CI signal.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M1** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- Skip reasons (babel-plugin-react-compiler 1.0.0 with a logger, positive control ThemedText compiles): value mutation 29, `eslint-disable` of react-hooks rules inside the function 27, ref access during render 25, `try/finally` (unsupported in 1.0.0) 21, memo-not-preserved 5. The measurement recipe is in the manifest's Post-Audit Notes and the `react_compiler_active` memory.
- `eslint-plugin-react-hooks` is 5.2.0 (transitive via eslint-config-expo), which predates the compiler lint rules. `babel-plugin-react-compiler` is not pinned in package.json.
- `docs/rules/performance.md:10` states the premise unqualified, and reviewers use it as a dedup rule.
- Research (react.dev: panicThreshold default `none`; eslint-plugin-react-hooks `recommended-latest`; compiler source `DEFAULT_ESLINT_SUPPRESSIONS` scope = whole function): `confirmed`.

## Acceptance Criteria

- [ ] A CI-enforced signal exists for NEW bailouts: either `eslint-plugin-react-hooks` v6+/v7 with the compiler rules, or a script that uses the compiler logger and fails on bailouts beyond a checked-in baseline of the current skipped set
- [ ] `babel-plugin-react-compiler` pinned explicitly in devDependencies
- [ ] `docs/rules/performance.md` qualified: manual memo is redundant only for components that compile; how to check
- [ ] Regenerate `.github/copilot-instructions.md` if docs/rules changed (`npm run build:copilot-instructions`)
- [ ] Do NOT fix the 61 bailouts here — this todo makes them visible; hot-screen instances are tracked in their own todos

## Implementation Notes

A baseline-ratchet script (like the type-aware ESLint ratchet) is the least disruptive option. Upgrading react-hooks to v7 could introduce new lint errors repo-wide — measure before choosing.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `eslint.config.js`
  - `package.json`
  - `scripts/ (new check script if chosen)`
  - `docs/rules/performance.md`
  - `.github/copilot-instructions.md (regenerated)`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- A lint-plugin major bump can cascade into many new errors; the ratchet approach avoids a big-bang fix.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M1).
