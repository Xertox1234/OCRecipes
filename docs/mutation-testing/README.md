# Mutation Testing

Mutation testing measures whether tests _assert_, not just _execute_. Stryker
corrupts each line (e.g. `<=` → `<`, delete a `return`); a **survivor** is a line a
test runs but does not check — a tautological-test signal and a worklist item.

## Run

    MUTATION_TARGET=<name> npm run test:mutation

Targets are defined once in `stryker.targets.mjs`. Default target:
`macro-gap-context`. HTML reports land in `reports/mutation/` (gitignored).

## Scope & policy

Only non-excluded, logic-dense modules are targeted. Auth, goal-safety, IAP,
health-data, secrets, and schema/migrations are Hard Exclusions
(`.github/copilot-instructions.md`) and require a separate human-authored plan.

## Baselines

See `baselines.md` for the tracked mutation scores. Equivalent mutants are
suppressed inline in source with `// Stryker disable next-line <mutator> -- <reason>`.
