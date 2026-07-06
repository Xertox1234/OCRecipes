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

- **`mutation-non-excluded.yml`** — every target in `stryker.targets.mjs` except the
  Hard-Exclusion ones (the current non-excluded set, as of 2026-07-05:
  `macro-gap-context`, `verification-consensus`, `cook-session-merge`,
  `chat-history-truncate`, `notebook-budget`, `carousel-builder`,
  `subscription-tier-cache`). This list has drifted from the workflow before — treat
  `stryker.targets.mjs` (registry) and `docs/mutation-testing/baselines.md` (achieved
  scores + residual notes) as the source of truth, not this bullet.
- **`mutation-goal-safety.yml`** — `goal-calculator` (break=100), under the read-only protocol.

A target gets a `breakThreshold` only after a stable baseline; Stryker exits non-zero when
the score drops below it, so a test regression that lets a mutant survive fails the gate.

## Baselines

See `baselines.md` for the tracked mutation scores. Equivalent-mutant handling
depends on the module:

- **Non-excluded** modules: either suppress inline in source with
  `// Stryker disable next-line <mutator> -- <reason>`, or — when the equivalent can't
  be isolated to one line — leave `breakThreshold` with margin below the achieved score
  and document the reasoning in the target's `stryker.targets.mjs` comment plus
  `baselines.md` (the precedent used by `chat-history-truncate`, `notebook-budget`,
  `carousel-builder`, and `subscription-tier-cache`).
- **Hard-Exclusion** modules (read-only): NEVER suppress in source — record the
  equivalent in `accepted-equivalents.json` (`file:line:mutator` + reason). The
  target's CI `break` is set to its achieved score (below 100) to account for the
  immovable equivalent.
