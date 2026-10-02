---
title: "Operator tooling imports production policy from a db-free leaf module — extract, re-export, and pin with a spawned no-env import test"
track: knowledge
category: design-patterns
tags: [architecture, import-graph, module-side-effects, operator-tooling, policy-drift, barcode]
module: server
applies_to: ["scripts/**/*.ts", "server/services/**/*.ts"]
created: 2026-07-24
last_updated: 2026-10-01
---

# Operator tooling imports production policy from a db-free leaf module

## When this applies

A script or tool outside the server runtime (a remediation CLI, a verify script,
an audit helper) needs to apply the SAME policy the production code applies —
tolerances, matching rules, normalization — and the module that owns that policy
has load-time side effects in its import graph. In this repo the canonical side
effect is `server/db.ts`, which **throws at module load when `DATABASE_URL` is
unset** and is reached via `server/storage/index.ts` (32 storage modules
import `db` directly) from almost every service.

## Rule

1. **Never mirror the policy.** A re-implemented `valuesMatch` or a hardcoded
   copy of a tolerance silently diverges the day the server retunes it — and the
   tool keeps reporting verdicts production would not produce, which defeats its
   purpose entirely.
2. **If the real module is importable side-effect-free, just import it.**
   (`server/lib/verification-consensus.ts` — relocated in #219 for
   import-direction reasons — is the precedent for policy living in a pure,
   freely importable module.)
3. **If the import graph is tainted, extract the pure policy into a leaf
   module** (e.g. `server/services/barcode-policy.ts`): verbatim moves only, no
   behavior edits. The leaf may import only other pure leaves.
4. **Re-export from the original module** (`export { … } from "./barcode-policy"`
   + `export type { … }` for types under isolatedModules) so every existing
   consumer keeps its import path — zero consumer churn, live bindings intact.
5. **Pin the leaf property with a spawned import test**: a `spawnSync` of
   `node --import=tsx -e "await import('<abs path>')"` with the offending env
   var **deleted** from the child env, asserting exit 0. Any future import that
   reaches the tainted graph turns into a test failure instead of the operator
   tool suddenly demanding production credentials.

## Why

The failure mode without step 5 is silent and delayed: someone adds one
innocent-looking import to the leaf, nothing breaks in CI (test env has
`DATABASE_URL`), and months later the "read-only" operator tool crashes at boot
on a machine without db credentials — or worse, invites the operator to point
`DATABASE_URL` at prod to run a "read-only" check. The spawned test makes the
structural property (db-free) regression-detectable, the same move as enforcing
a facade with a source-grep guard test.

## Exceptions

- Scripts that genuinely need the database (`scripts/cleanup-junk-recipes.ts`,
  `scripts/migrate-recipe-ingredients.ts`) use the other sanctioned pattern:
  `import "dotenv/config"` first, then relative imports into `server/`. Don't
  extract a leaf for a consumer that legitimately wants the runtime.
- Don't move a symbol into the leaf just because it's near the policy — only
  what the external consumer needs plus what those functions require. Keep
  calibrated constants module-private when consumers only need the function
  that encapsulates them (`ATWATER_MACRO_TOLERANCE` stayed private;
  `offMacrosCorroborateEnergy` is the public policy surface).

## A "needs no database" claim is a reachability claim — import to check it, don't grep

_Added 2026-10-01 (Lane C, PR #1208)._

The Lane C spec said the eval job needs no Postgres, "verified by grep". The
grep looked for direct storage imports in the eval services and found one,
`server/services/recipe-generation.ts:26` (`import { storage } from "../storage"`).
An import probe with `DATABASE_URL` deleted showed **three of the five**
services throw `DATABASE_URL must be set` at load: nutrition-coach,
recipe-chat and recipe-generation. Two of them reach `server/db.ts`
transitively, which no grep for the service's own imports can see. The
workflow needed the same Postgres service as `ci.yml`.

- To find out whether X needs Y at load, **import X in a child process with
  Y's env var deleted** and read the exit code. That is step 5's probe, used
  as a one-off check instead of a pinned test.
- A source-regex "imports nothing" test (for example the `imports nothing`
  case in `evals/__tests__/bootstrap.test.ts`) is weaker than step 5's
  spawned import. Its regex `/^\s*import\b|\brequire\(/m` misses
  `export … from` re-exports, and it misses a dynamic `import()` unless the
  call starts a line (`const m = await import("x")` passes). Use it only for a module that must stay completely leaf (no
  imports at all). Where the property is "importable without env", use the
  spawned import.
- A placeholder `DATABASE_URL` makes the import succeed but only moves the
  failure. In the evals case, the coach's tools call storage during a run,
  and `LOG_LEVEL=silent` would have hidden the resulting connection errors.

## Related Files

- `server/services/barcode-policy.ts` — the extracted leaf (barcodeVariants,
  offMacrosCorroborateEnergy, offEnergyKcal, ZERO_CAL_MAX_MACRO_KCAL_100G)
- `server/services/__tests__/barcode-policy.test.ts` — the spawned
  no-`DATABASE_URL` import guard
- `server/services/barcode-lookup.ts` — re-export site; consumers unchanged
- `scripts/verify-barcode-cache-candidates.ts` — the operator CLI consumer
- `server/lib/verification-consensus.ts` — the relocation precedent
- `evals/lib/bootstrap.ts` + `evals/__tests__/bootstrap.test.ts` — a no-imports leaf pinned by a source regex (the weaker form)
- `.github/workflows/evals-nightly.yml` — the Postgres service the import probe showed was needed

## See Also

- [facade-only-enforced-by-source-grep-guard-test](facade-only-enforced-by-source-grep-guard-test-2026-06-26.md) — same move: a structural property enforced by a cheap automated guard
- [../logic-errors/remediation-classifier-must-apply-production-criterion-2026-07-24.md](../logic-errors/remediation-classifier-must-apply-production-criterion-2026-07-24.md) — importing real primitives is necessary but not sufficient; the composition can still drift
- [../logic-errors/parallel-filter-paths-drift-2026-05-13.md](../logic-errors/parallel-filter-paths-drift-2026-05-13.md) — the underlying disease: duplicated logic paths diverge
- [../conventions/run-twice-equality-cannot-detect-a-lost-seed-2026-10-01.md](../conventions/run-twice-equality-cannot-detect-a-lost-seed-2026-10-01.md) — the same leaf module's determinism test
