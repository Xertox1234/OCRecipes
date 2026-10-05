---
title: "Route the two sibling vitest configs (vitest.mutation.config.mts, vitest.integration.config.mts) to testing + typescript: add their basenames to the config-file rule in scripts/lib/path-domains.ts and regenerate domain-map.sh + copilot-instructions.md by script"
status: in-progress
priority: low
created: 2026-10-02
updated: 2026-10-02
assignee:
labels: [deferred, harness, testing]
github_issue:
---

# Route the two sibling vitest configs to the testing domain

## Summary

The `config-file` rule in `scripts/lib/path-domains.ts` lists only the basenames `vitest.config` and `eslint.config` (`scripts/lib/path-domains.ts:282`), so the two sibling configs `vitest.mutation.config.mts` and `vitest.integration.config.mts` route to no domain at all. An `Edit`/`Write` on either injects neither the Testing nor the TypeScript rules (hook probe at ec26b972: about 1.2 KB of discipline preamble with no rules headers, versus 9.0 KB carrying `# Testing Rules` + `# TypeScript Rules` for `vitest.config.mts`), and every solution doc tagged `testing`/`typescript` whose `applies_to` names them is inert. Add the two basenames to the rule, add the test rows, and regenerate the two generated artifacts by script.

## Background

- Noticed during the `/todo` sweep PR #1222 and verified 2026-10-02 against `main` ec26b972: `npx tsx scripts/lib/path-domains.ts vitest.mutation.config.mts` prints nothing (same for `vitest.integration.config.mts`, with or without `--typescript-crosscut`), while `vitest.config.mts` prints `testing, typescript`. The hook probe (`.claude/hooks/inject-patterns.sh` fed stdin JSON for each file, `PATTERN_INJECT_NO_LOG=1`, no `session_id` so dedup is off) reproduces it at the injection layer: 9026 B with both rules headers for the main config, 1228 B / 1231 B with none for the siblings.
- Why this is a todo rather than a fix bundled into the sweep (the governance point): `.claude/hooks/**` is frozen by owner ruling 2026-09-22 (`docs/harness-residuals.md:3`). `.claude/hooks/lib/domain-map.sh` is a GENERATED file (`.claude/hooks/lib/domain-map.sh:2-3`: "GENERATED FILE — do not edit by hand. Regenerate with: npm run build:domain-map"), and `docs/rules/harness.md:7` is the binding rule: never hand-edit it; edit `scripts/lib/path-domains.ts`, run `npm run build:domain-map` + `npm run build:copilot-instructions`, commit both. Regenerating by script is the sanctioned path and the only one this todo uses. The adversarial re-check found zero post-freeze precedent for regenerating it (as of 2026-10-02 the last commit touching either file was 3f8dcf27 on 2026-08-30, before the freeze; re-run `git log --oneline --since=2026-09-22 -- .claude/hooks/lib/domain-map.sh scripts/lib/path-domains.ts` before relying on that), which is why the sweep did not bundle it. The owner approved filing it on 2026-10-02 knowing that. The executor must disclose the regenerated diff under its own heading in the PR body.
- The freeze is not crossed: `.claude/hooks/inject-patterns.sh` is not edited. The hook consumes the generated map (`_add()` at `.claude/hooks/inject-patterns.sh:89`, `source "$SCRIPT_DIR/lib/domain-map.sh"` at `:91`); its `*.ts|*.tsx` fallback at `:109` is irrelevant once the config-file rule matches. Only a generic ".mts counts as TypeScript" fallback would need the frozen hook; that variant is a recorded residual and is NOT what this todo does.
- The automerge guard HOLDs this PR regardless of the `low` priority: `scripts/` and `.github/` are structurally sensitive (`scripts/todo-automerge-guard.sh:232`) and `.claude/hooks/lib/domain-map.sh` is not on the safe allowlist (`scripts/todo-automerge-guard.sh:98`). It gets a human merge, which is appropriate given the point above.
- A concrete casualty beyond the missing rules: `docs/solutions/best-practices/vite-native-config-loader-mts-migration-2026-09-23.md` was written for exactly these two siblings (`applies_to` at `:7` includes `vitest.*.config.mts`; tags at `:6` include `testing` and `typescript`), but per `docs/rules/harness.md:33` retrieval selects by the file's routed domain first, so that `applies_to` glob is inert for them today.

## Acceptance Criteria

- [ ] Routing: `npx tsx scripts/lib/path-domains.ts vitest.mutation.config.mts` prints `testing, typescript`, and so does `npx tsx scripts/lib/path-domains.ts vitest.integration.config.mts`; `vitest.config.mts` and `eslint.config.js` still print `testing, typescript`; a nested `some/dir/vitest.mutation.config.mts` still prints nothing (the rule stays root-anchored, as `some/dir/vitest.config.mts` is today).
- [ ] Tests added first (TDD; red at ec26b972): two rows in the `cases` table of `describe("rulesDomainsForPath")` in `scripts/lib/__tests__/path-domains.test.ts`, directly after the `eslint.config.js` row at `:163`: `["vitest.mutation.config.mts", ["testing", "typescript"]]` and `["vitest.integration.config.mts", ["testing", "typescript"]]`; and the same two paths appended to `PARITY_CORPUS` after `"eslint.config.js"` at `:330`. `npx vitest run scripts/lib/__tests__/path-domains.test.ts` passes after the source edit, and `npx vitest run scripts/__tests__/build-domain-map.test.ts scripts/__tests__/build-copilot-instructions.test.ts` still passes.
- [ ] Generated artifacts regenerated by script, never by hand: after `npm run build:domain-map` and `npm run build:copilot-instructions`, `npm run build:generated:check` exits 0 and `shellcheck .claude/hooks/lib/domain-map.sh` is clean (CI runs both in `.github/workflows/copilot-instructions-check.yml:47-51`). The `git diff` of `.claude/hooks/lib/domain-map.sh` is exactly the one condition line (`:53` today) gaining the four globs `*/vitest.mutation.config.*`, `vitest.mutation.config.*`, `*/vitest.integration.config.*`, `vitest.integration.config.*`; the diff of `.github/copilot-instructions.md` is exactly the one table row (`:41` today) gaining the two new patterns.
- [ ] Injection: `printf '{"tool_name":"Edit","tool_input":{"file_path":"%s/vitest.mutation.config.mts"}}' "$PWD" | PATTERN_INJECT_NO_LOG=1 bash .claude/hooks/inject-patterns.sh` now emits both the `# Testing Rules` and `# TypeScript Rules` headers (same for `vitest.integration.config.mts`), matching what `vitest.config.mts` emits today.
- [ ] PR body carries the regenerated diff of both generated files under its own heading (for example `## Regenerated artifacts`), and the only file under `.claude/hooks/` in the PR's changed-file list (`git diff --stat main`) is `.claude/hooks/lib/domain-map.sh`.

## Implementation Notes

Mechanism, all in `scripts/lib/path-domains.ts`:

- The `config-file` matcher variant (`scripts/lib/path-domains.ts:56-57`) compiles three ways from one `basenames` list: `compileToRegExp` (`:443-446`) emits the root-anchored regex `^(b\.[^/]+|...)$` per basename (the `[^/]+` is why the `.mts` extension already matches; there is no extension list anywhere); `compileToBashConditions` (`:472-473`) emits the glob pair `*/b.*` and `b.*` per basename for the generated shell; the rule's `description` (`:285`) is the human string the Copilot table renders (`scripts/build-copilot-instructions.ts:38`, currently the row at `.github/copilot-instructions.md:41`).
- Why the siblings miss today: `vitest\.config\.[^/]+` is anchored at `^`, and `vitest.mutation.config.mts` does not start with `vitest.config.`; the bash globs `vitest.config.*` / `*/vitest.config.*` need the literal `vitest.config.` prefix too. The explicit basename list is the whole gap. (The re-check confirmed every other root config, `babel.config.js`, `drizzle.config.ts`, `metro.config.js`, `react-native.config.js`, is also unrouted; do NOT widen to those, see Risks.)

Edits, in TDD order:

1. `scripts/lib/__tests__/path-domains.test.ts`: add the two `cases` rows after `:163` (keep the `// --- package manifests` comment at `:164` below them) and the two `PARITY_CORPUS` entries after `:330`. Run `npx vitest run scripts/lib/__tests__/path-domains.test.ts`: the two new `it.each(cases)` rows (`:244-246`) fail with `[]`; the two parity rows pass trivially today because both compiled forms miss, and become the regression pin once the rule exists.
2. `scripts/lib/path-domains.ts:282` and `:285` become exactly (each pattern ends in `.*`, as the current `:285` value does):

   ```ts
   basenames: ["vitest.config", "vitest.mutation.config", "vitest.integration.config", "eslint.config"],
   description: "`vitest.config.*`, `vitest.mutation.config.*`, `vitest.integration.config.*`, `eslint.config.*`",
   ```

   Order within the list has no matching effect; keep the vitest basenames adjacent so the generated line reads naturally. Re-run the test file: green.

3. `npm run build:domain-map`, then `npm run build:copilot-instructions` (`package.json` scripts: `build:domain-map` = `tsx scripts/build-domain-map.ts .claude/hooks/lib/domain-map.sh`; `build:copilot-instructions` = `tsx scripts/build-copilot-instructions.ts .github/copilot-instructions.md`). Then `npm run build:generated:check` (both `--check` modes) must exit 0. Both checks were green at ec26b972, so any hunk beyond the one line / one row described in the acceptance criteria means something else drifted: stop and look before committing.
4. Commit all four files in one commit; put `git diff main -- .claude/hooks/lib/domain-map.sh .github/copilot-instructions.md` verbatim in the PR body under its own heading.

Notes for the executor:

- `.claude/hooks/lib/domain-map.sh` is sourced on the hook hot path with no tsx at runtime (`scripts/build-domain-map.ts:10-15`); `generateDomainMap` emits one `bashLine` per rule (`scripts/build-domain-map.ts:21-28`), so the new globs land on the existing `_add testing; _add typescript;` line, not on a new one.
- `.claude/hooks/test-inject-patterns.sh:225-227` (the hook self-test) asserts only `vitest.config.ts`; it is frozen (`docs/harness-residuals.md:88-96`) and stays untouched. The `cases` rows plus the hook probe in the acceptance criteria are the regression coverage.
- The typescript-fallback-suppression trap in `docs/solutions/conventions/routing-new-domain-can-suppress-typescript-fallback-2026-08-28.md` does not bite here: the rule itself carries `typescript` (`scripts/lib/path-domains.ts:284`), and the siblings never had the fallback (it is `*.ts|*.tsx` only at `.claude/hooks/inject-patterns.sh:109`; both files are `.mts`).
- Parity detail: the new rows are root paths, so the TS regex and both bash globs agree (the symmetric branch at `scripts/lib/__tests__/path-domains.test.ts:402-403`); the `isConfigFileDepthMismatch` allowance (`:396-401`) is not exercised. The root-anchoring pin in the first acceptance criterion mirrors the existing `client/lib/package.json` decline row (`:170`).
- `npx tsx scripts/lib/path-domains.ts` needs the worktree's `node_modules` (a `/todo` executor worktree gets the symlink).

## Scope Contract

- **Mechanisms to use:** the existing `config-file` matcher's `basenames` list and `description` string; the existing `cases` and `PARITY_CORPUS` tables; the two existing generators run through their npm scripts (`build:domain-map`, `build:copilot-instructions`, `build:generated:check`). Nothing new.
- **Files in scope:** `scripts/lib/path-domains.ts`, `scripts/lib/__tests__/path-domains.test.ts`, `.claude/hooks/lib/domain-map.sh` (generated; regenerate only, never hand-edit), `.github/copilot-instructions.md` (generated; regenerate only).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR #1222 is merged; the owner's 2026-10-02 approval to regenerate the frozen-tree generated file is recorded under Background and Updates.

## Risks

- Scope creep: `babel.config.js`, `drizzle.config.ts`, `metro.config.js` and `react-native.config.js` are also unrouted. Do not fold them in; each is a separate human routing decision (the "human decision" comment block at `scripts/lib/path-domains.ts:288-299` shows the bar), and this todo's claim was verified for the two vitest siblings only.
- The regenerated `.claude/hooks/lib/domain-map.sh` is the first post-freeze touch of that path. Keep its diff to the single line, disclose it in the PR body, and expect a human merge (the automerge guard HOLDs on `scripts/`, `.github/` and the un-allowlisted `.sh`).
- `shellcheck` on the generated file (`.github/workflows/copilot-instructions-check.yml:51`): the new globs are plain `[[ "$f" == glob ]]` operands like the existing ones, so no new warnings are expected; the acceptance criteria check it anyway.
- If `main` moves `scripts/lib/path-domains.ts` or the test file before this runs, the cited line numbers shift; re-anchor on the `basenames: ["vitest.config", "eslint.config"]` literal and the `eslint.config.js` rows rather than on the numbers.

## Updates

### 2026-10-02

- Filed from the 2026-10-02 deferred-warnings triage of the /todo sweep (#1213–#1226); claim verified against main ec26b972 by workflow wf_7d969d8d-ce1 and upheld by an adversarial re-check; filing approved by the owner 2026-10-02.
