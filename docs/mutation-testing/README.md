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

(`adaptive-goals` was an approved target on 2026-06-05 but was deleted in #384; it is
no longer registered or approved.)

## Enforced in CI

Two required, self-scoping gates run Stryker only when a target or the harness changes:

- **`mutation-non-excluded.yml`** — `macro-gap-context`, `verification-consensus`,
  `cook-session-merge` (break=100), `chat-history-truncate` (break=88, achieved 90.58%;
  the residual is a dev-only `console.warn` plus provable equivalents).
- **`mutation-goal-safety.yml`** — `goal-calculator` (break=100), under the read-only protocol.

A target gets a `breakThreshold` only after a stable baseline; Stryker exits non-zero when
the score drops below it, so a test regression that lets a mutant survive fails the gate.

## Baselines

See `baselines.md` for the tracked mutation scores. Equivalent-mutant handling
depends on the module:

- **Non-excluded** modules: suppress inline in source with
  `// Stryker disable next-line <mutator> -- <reason>`.
- **Hard-Exclusion** modules (read-only): NEVER suppress in source — record the
  equivalent in `accepted-equivalents.json` (`file:line:mutator` + reason). The
  target's CI `break` is set to its achieved score (below 100) to account for the
  immovable equivalent.
