---
title: 'madge counts `import type` edges as cycles — re-run with skipTypeImports to see only runtime cycles'
track: knowledge
category: best-practices
module: shared
severity: low
tags: [harness, architecture, audit, scanners, madge, circular-dependencies, typescript, import-type, tooling]
symptoms: [madge --circular reports 100+ cycles through client/types/navigation.ts, every audit triage re-rules the madge rows false-positive by hand, a cycle report that cannot tell a load-order bug from a type-only edge]
applies_to: [scripts/audit-scanners.ts, shared/schema.ts]
created: '2026-11-19'
---

# madge counts `import type` edges — use skipTypeImports

## Rule

Before triaging madge's circular-dependency rows, re-run it with type-only
imports skipped. Only the cycles that survive are real (runtime) cycles; the
rest are erased by TypeScript at compile time and cannot cause a load-order
bug.

## Why

Plain `madge --circular` treats `import type { X }` as a dependency. In this
repo the navigation param types (`client/types/navigation.ts`) and the shared
schema (`shared/schema.ts` ↔ `shared/constants/allergens.ts`, `shared/types/family.ts`)
form many such type-only loops. Three audits (2026-09-23, 2026-10-25,
2026-11-19) each spent triage ruling 20+ madge rows type-only by reading
edges one at a time. On 2026-11-19 madge reported 117 cycles; with type
imports skipped it reported **0**.

madge 8 has no `--rc` flag: it reads a `.madgerc` from the working
directory. `detectiveOptions` must name both `ts` and `tsx`.

## Examples

```bash
# from the repo root
echo '{"detectiveOptions":{"ts":{"skipTypeImports":true},"tsx":{"skipTypeImports":true}}}' > .madgerc
npx madge@8.0.0 --circular --extensions ts,tsx --ts-config tsconfig.json --json client server shared
rm .madgerc
```

Control the zero: confirm by hand that at least one reported cycle has an
`import type` edge (e.g. `client/lib/mutation-defaults.ts:5` imports
`ChatConversation` as a type from `useChat`), so the filter is shown to remove
a known type-only cycle rather than silently matching nothing.

## Related Files

- `scripts/audit-scanners.ts` — the madge invocation (`NPX_PINS.madge`)
- `client/types/navigation.ts` — the hub of the type-only cycles

## See Also

- `docs/solutions/logic-errors/fail-open-scanner-wrapper-error-envelope-not-clean-scan-2026-07-12.md`
- `todos/P3-2026-11-19-audit-scanner-madge-skip-type-imports.md`
