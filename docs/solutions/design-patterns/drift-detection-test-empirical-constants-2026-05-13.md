---
title: Drift-detection test for empirically-derived constants
track: knowledge
category: design-patterns
module: shared
tags: [testing, vitest, constants, drift-detection, grep, codebase]
applies_to: ['**/__tests__/**/*.test.ts']
created: '2026-05-13'
---

# Drift-detection test for empirically-derived constants

## When this applies

When a constant is a hand-maintained list whose canonical source is something external (a `grep` over the codebase, a file listing, an API enumeration), pair it with a unit test that **re-runs the empirical scan at test time** and asserts the constant matches. The test acts as a guard so a new entry added to the source can't silently bypass the constant.

## Why

The constant exists because the runtime cost of re-running the grep on every invocation is unacceptable, OR the source data isn't available at runtime. The test trades a one-time test-time grep for a guarantee that the constant stays accurate. The sanity assertion (`length > 0`) guards against a grep that silently returns nothing (e.g., paths changed, regex broken) which would otherwise turn the drift check into a no-op.

## When to use

- Constants seeded from a `grep -l ...` over source files (e.g., "services that import an LLM client", "routes that use rate limiting middleware")
- Lists hand-curated from external API enumerations that change over time
- Allowlists / blocklists that mirror runtime behavior in a sibling system

## Examples

```typescript
it("matches the empirical grep result", () => {
  const result = execSync(
    `grep -l "openai\\|anthropic" server/services/*.ts || true`,
    { encoding: "utf8" },
  );
  const empirical = result
    .split("\n")
    .filter(Boolean)
    .filter((p) => !p.includes("/__tests__/"))
    .map((p) => p.replace(/^server\/services\//, ""))
    .sort();

  // Indirectly assert the constant matches by checking the consumer
  // (here: domainsForPath returns "ai-prompting" for each empirical hit).
  const missing = empirical.filter(
    (basename) =>
      !domainsForPath(`server/services/${basename}`).includes("ai-prompting"),
  );
  expect(missing).toEqual([]);
  expect(empirical.length).toBeGreaterThan(0); // sanity: grep isn't vacuous
});
```

## Pair with

`--check`-mode build script if the constant feeds a generated artifact — see `architecture.md` "CI Drift-Check for Generated Artifacts."

## Related Files

- `scripts/__tests__/delegate-copilot-issue.test.ts` — `LLM_TOUCHING_SERVICES drift detection` block

## See Also

- [Exhaustive-partition lock via shared-type enum](exhaustive-partition-lock-shared-enum-2026-05-13.md)
