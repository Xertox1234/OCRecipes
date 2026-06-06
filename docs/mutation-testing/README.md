# Mutation Testing

Mutation testing measures whether tests _assert_, not just _execute_. Stryker
corrupts each line (e.g. `<=` → `<`, delete a `return`); a **survivor** is a line a
test runs but does not check — a tautological-test signal and a worklist item.

## Run

    MUTATION_TARGET=<name> npm run test:mutation

Targets are defined once in `stryker.targets.mjs`. Default target:
`macro-gap-context`. HTML reports land in `reports/mutation/` (gitignored).

## Scope & policy

Non-excluded, logic-dense modules are targeted freely. Hard Exclusions (auth,
goal-safety, IAP, health-data, secrets, schema/migrations;
`.github/copilot-instructions.md`) may be targeted ONLY under a human-authored plan
with a `HUMAN_APPROVED_EXCLUSIONS` entry in `stryker.targets.mjs`, and ONLY read-only:
their **source is never edited** (no inline `// Stryker disable`, no dead-code
removal). See the gated-protocol solution doc.

### Approved Hard-Exclusion targets

| Module                               | Approved   | Plan                                 |
| ------------------------------------ | ---------- | ------------------------------------ |
| `server/services/goal-calculator.ts` | 2026-06-05 | Goal-safety gated read-only protocol |
| `server/services/adaptive-goals.ts`  | 2026-06-05 | Goal-safety gated read-only protocol |

## Baselines

See `baselines.md` for the tracked mutation scores. Equivalent-mutant handling
depends on the module:

- **Non-excluded** modules: suppress inline in source with
  `// Stryker disable next-line <mutator> -- <reason>`.
- **Hard-Exclusion** modules (read-only): NEVER suppress in source — record the
  equivalent in `accepted-equivalents.json` (`file:line:mutator` + reason). The
  target's CI `break` is set to its achieved score (below 100) to account for the
  immovable equivalent.
