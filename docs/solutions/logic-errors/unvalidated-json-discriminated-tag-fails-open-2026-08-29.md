---
title: "An unrecognized discriminated-tag value from JSON.parse falls through to the permissive branch without a runtime guard"
track: bug
category: logic-errors
module: shared
severity: high
tags: [typescript, harness, testing, validation, json, type-guard]
applies_to: ["scripts/**/*.ts"]
symptoms: ["A discriminated-union field parsed from JSON.parse (typed `any`) is checked with a single `=== \"literal\"` comparison and no else/exhaustiveness branch", "A typo, wrong separator, or wrong-case value in the field silently takes the LESS restrictive code path instead of being rejected", "The bug is invisible to TypeScript — the compiler only ever sees the post-JSON.parse variable through its declared (unchecked) type annotation", "A malformed-but-syntactically-valid payload (missing a required field, wrong shape) crashes with an uncaught runtime error instead of a clean rejection"]
created: '2026-08-29'
---

# An unrecognized discriminated-tag value from JSON.parse falls through to the permissive branch without a runtime guard

## Problem

`scripts/todo-scheduler.ts`'s `main()` read a JSON object from stdin and assigned it directly
into a variable typed `SchedulerInput` — `input = JSON.parse(raw)` — with no runtime check that
the parsed value actually matched the shape. The scheduler's core safety invariant hinges on a
`tag` field with exactly two valid values (`"independent"` / `"must-run-alone"`), enforced by
`if (candidate.tag === "must-run-alone") { ...safety path... }` and falling through to the
independent/concurrent-dispatch path for anything else.

A code review caught that an unrecognized tag — e.g. `"must_run_alone"` (underscore instead of
hyphen), a stray space, or wrong case — was never rejected: it simply failed the `===` check and
fell into the permissive branch, getting dispatched CONCURRENTLY with everything else. This
defeated the exact invariant the field exists to enforce (preventing a DB-serial migration todo
from running alongside anything else, on the theory that a concurrent process could read
half-migrated schema).

## Symptoms

- A discriminated-union field parsed from `JSON.parse` (typed `any`) is checked with a single
  `=== "literal"` comparison and no else/exhaustiveness branch.
- A typo, wrong separator, or wrong-case value in the field silently takes the LESS restrictive
  code path instead of being rejected.
- The bug is invisible to TypeScript — the compiler only ever sees the post-`JSON.parse`
  variable through its declared (unchecked) type annotation, never the real runtime shape.
- A malformed-but-syntactically-valid payload (missing a required field, wrong shape entirely)
  crashes with an uncaught runtime error (`TypeError: Cannot read properties of undefined`)
  instead of a clean rejection — a secondary symptom of the same missing-validation root cause.

## Root Cause

`JSON.parse` returns `any`. Assigning that directly into a variable annotated with a specific
interface (`let input: SchedulerInput; input = JSON.parse(raw);`) does not validate anything —
it is a compile-time-only annotation with zero runtime effect. Every field, including a
discriminated `tag`, arrives completely unchecked. A binary `if (x === "must-run-alone") {
strict path } else { permissive path }` check then treats "not exactly this one literal" as
synonymous with "the other literal" — silently absorbing every malformed value into the
permissive branch instead of rejecting it. This is the general TypeScript-boundary trap: type
annotations describe intent to the compiler, they do not enforce anything at runtime, and a
binary equality check on an unvalidated field always has an implicit "everything else" branch
that inherits whichever side it was written to fall through to.

## Solution

Add an explicit runtime type guard between `JSON.parse` and the code that trusts the result. The
guard must:

1. Check every field's shape (not just the ones the immediate bug touched) — `cap` is a number,
   `queue`/`running` are arrays, each item has a string `id`, a string-array `files`.
2. For a discriminated field, check it against the FULL enumerated set of valid values with an
   explicit rejection for anything else — never let "didn't match the strict case" imply "matches
   the permissive case." A pattern like `if (tag !== "independent" && tag !== "must-run-alone") {
   reject with a descriptive message }` fails closed; `if (tag === "must-run-alone") { strict }
   else { permissive }` fails open.
3. Return a descriptive, actionable error (which field, what was expected, what was actually
   received) rather than a boolean — the caller (here, an LLM orchestrator constructing the JSON
   by hand each run) needs to know exactly what it got wrong, not just that something failed.
4. Reject with a clean error message and a distinct exit code, not an uncaught exception — a
   `TypeError` stack trace is much less actionable for whatever is consuming the tool's stderr.

See `scripts/todo-scheduler.ts`'s `validateSchedulerInput` for the concrete implementation, and
its test file's `describe("validateSchedulerInput")` / `describe("CLI")` blocks for the
regression tests — including a test that asserts the exact typo'd-tag scenario is now rejected,
not silently dispatched.

## Prevention

Whenever a value crosses from `JSON.parse` (or any other `any`-typed boundary — `req.body`,
`process.env`, a config file) into code that trusts a specific TypeScript type, write a runtime
type guard for that boundary before writing the code that consumes it — the guard IS the actual
contract; the type annotation is just documentation for the compiler. For a discriminated field
specifically, always check against the enumerated allow-list with an explicit reject branch,
never a single-case `===` with an implicit permissive fallthrough. `code-reviewer.md`'s existing
"Type guards implemented for all runtime boundaries" checklist item covers this generically —
this is a worked example of exactly the failure it exists to catch.

## Related Files

- `scripts/todo-scheduler.ts` — `validateSchedulerInput`, `main()`
- `scripts/__tests__/todo-scheduler.test.ts` — regression tests for the exact typo'd-tag and
  malformed-shape scenarios
- `.claude/agents/code-reviewer.md` — the general "validate external data at the edge" checklist
  item this is a precedent for

## See Also

- [../conventions/fail-closed-guard-at-dangerous-op-call-site-2026-06-25.md](../conventions/fail-closed-guard-at-dangerous-op-call-site-2026-06-25.md) — the same "the exception path must deny, not allow" principle at a different call site
- [../conventions/rate-limiter-fail-closed-on-error-2026-05-13.md](../conventions/rate-limiter-fail-closed-on-error-2026-05-13.md) — another instance of an error/unknown-state path defaulting to the dangerous direction instead of the safe one
