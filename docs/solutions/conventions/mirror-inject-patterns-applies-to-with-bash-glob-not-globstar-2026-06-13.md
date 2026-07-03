---
title: 'Mirror inject-patterns.sh applies_to matching with bash glob semantics, not standard globstar'
track: knowledge
category: conventions
module: shared
tags: [inject-patterns, applies_to, glob, bash, pattern-matching, solutions-db, sp2]
symptoms: [Reimplementing the applies_to matcher with picomatch/minimatch globstar instead of bash semantics, A reimplemented matcher matches `client/Foo.tsx` against `client/**/*.tsx` (standard globstar) — diverging from the hook]
applies_to: [scripts/solutions-db/lib/globs.ts, .claude/hooks/inject-patterns.sh]
created: '2026-06-13'
---

# Mirror inject-patterns.sh applies_to matching with bash glob semantics, not standard globstar

## Rule

When reimplementing the `applies_to:` glob matcher outside the hook (e.g. for a DB-backed preview tool, or the eventual SP2 rewrite of the injection hook), replicate **bash `[[ "$path" == $glob ]]` semantics**, not standard globstar. In bash `[[ ]]` pattern matching, `*` (and therefore `**`, which is just two `*`) matches any run of characters **including `/`**, and the literal `/` separators in the glob are **required**.

## Smell patterns

- Reaching for `picomatch`/`minimatch` to match `applies_to` globs — those use globstar, where `client/**/*.tsx` matches zero intermediate segments (`client/Foo.tsx`). The hook does **not**.
- A new dependency added "for correctness" when the goal is fidelity to an existing bash matcher.

## Why

`.claude/hooks/inject-patterns.sh` matches each solution file's `applies_to` globs against the edited file path with `[[ "$_FILE_REL" == $_pat ]]` (see its lines ~164-186). The hook's own comment notes that in bash 3.2, `*` inside `[[ ]]` matches any string including `/`, so `**` works for nested paths without `shopt -s globstar`. Consequence: `client/**/*.tsx` expands to `client/ <any> / <any> .tsx` — the middle `/` is literal and required, so `client/Foo.tsx` (zero intermediate segments) does **not** match, but `client/a/Foo.tsx` does.

A standard globstar library would match `client/Foo.tsx` too — a *different* matcher. A "preview the hook" tool that diverges defeats its purpose. The faithful (and dependency-free) implementation is `*`-run → `.*`, escape every other char, anchor `^…$`.

## Examples

```ts
// Mirrors bash [[ == ]]: * (and **) span '/', literal separators required.
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") { while (glob[i + 1] === "*") i++; re += ".*"; }
    else if (c === "?") re += ".";
    else re += c.replace(/[.+^${}()|[\]\\/]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}
```

Lock the consequential case in a test: `client/**/*.tsx` matches `client/a/Foo.tsx` (true) but **not** `client/Foo.tsx` (false).

## Exceptions

If a future SP2 deliberately *changes* the hook's semantics (e.g. adopts real globstar everywhere), update both the hook and this matcher together and revise this rule — the invariant is "the preview tool matches the live hook", not "bash semantics forever".

## Related Files

- `scripts/solutions-db/lib/globs.ts` — `globToRegExp` / `matchesAnyGlob`
- `.claude/hooks/inject-patterns.sh` — the live matcher this mirrors (lines ~164-186)
