---
title: 'Mirror inject-patterns.sh applies_to matching exactly — bash glob semantics PLUS the **/-elision compensation'
track: knowledge
category: conventions
module: shared
tags: [inject-patterns, applies_to, glob, bash, pattern-matching, harness, tooling, sp2]
symptoms: [Reimplementing the applies_to matcher with picomatch/minimatch globstar instead of the hook's own two-test rule, A reimplemented matcher disagrees with the hook on whether `client/**/*.tsx` matches `client/Foo.tsx`, An applies_to glob that looks obviously correct never promotes its solution]
applies_to: [.claude/hooks/inject-patterns.sh, .claude/hooks/**/*.sh, scripts/**/*.ts]
created: '2026-06-13'
last_updated: '2026-08-06'
---

# Mirror inject-patterns.sh applies_to matching exactly — bash glob semantics PLUS the `**/`-elision compensation

## Rule

When reimplementing the `applies_to:` glob matcher outside the hook, replicate what the hook
**actually does today**: two tests OR'd together, not one.

```bash
alt="${pat//\*\*\//}"                                     # the pattern with every "**/" removed
[[ "$file" == $pat ]] || [[ "$file" == $alt ]]            # match if EITHER form matches
```

Neither test alone is the hook. Standard globstar is also not the hook.

## Smell patterns

- Reaching for `picomatch`/`minimatch` — those implement real globstar, a third semantics that
  agrees with the hook on some inputs and not others.
- Implementing only `[[ "$file" == $pat ]]` and concluding `dir/**/*.ext` cannot match
  `dir/file.ext`. That was true before 2026-08-06 and is the exact thing the compensation fixed.
- A "preview the hook" tool with no test pinning `dir/**/*.ext` against BOTH `dir/file.ext` and
  `dir/sub/file.ext`.

## Why

Bash `[[ ]]` has no globstar. Inside it `*` (and therefore `**`, which is just two `*`) matches
any run of characters **including `/`**, but the literal `/` separators in the pattern are
**required**. So `client/**/*.tsx` reads as `client/` + `<any>` + `/` + `<any>` + `.tsx` — the
middle `/` must be present, and `client/Foo.tsx` (zero intermediate segments) does not match.

That behaviour was a live defect, not a design choice. **523 of the corpus's 695 `applies_to`
files use the `dir/**/*.ext` form** — because `docs/solutions/README.md` gave it as the canonical
example — and every one of them was silently inert for files sitting directly in the named
directory, which is most of them. `client/screens/**/*.tsx` missed all 38 flat screens.

Rather than rewrite 523 files, the hook now also tests the pattern with `**/` elided, so
`dir/**/*.ext` matches both `dir/file.ext` and `dir/sub/file.ext` — what authors evidently meant.
Any mirror must do the same or it diverges.

## Examples

```ts
// Mirrors the hook: bash-glob semantics (`*` spans '/'), tested against BOTH the literal
// pattern and its **/-elided form.
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      while (glob[i + 1] === "*") i++;
      re += ".*";
    } else if (c === "?") re += ".";
    else re += c.replace(/[.+^${}()|[\]\\/]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}

export function matchesGlob(file: string, glob: string): boolean {
  return (
    globToRegExp(glob).test(file) || globToRegExp(glob.replaceAll("**/", "")).test(file)
  );
}
```

Lock all three consequential cases in tests — `client/**/*.tsx` matches `client/a/Foo.tsx` (true),
matches `client/Foo.tsx` (true, post-2026-08-06), and does **not** match `other/Foo.tsx` (false).
The negative control is what stops an over-broad elision from passing.

## Exceptions

If the hook's semantics change again, update the mirror and this rule together — the invariant is
"the mirror matches the live hook", not any particular glob dialect.

## Related Files

- `.claude/hooks/inject-patterns.sh` — the live matcher, in `solutions_from_markdown`
- `.claude/hooks/test-inject-patterns-relevance.sh` — pins both the match and the negative control

## See Also

- [truncate-before-rank discards the best candidates](../logic-errors/truncate-before-rank-discards-best-candidates-2026-08-06.md) — the other half of the same retrieval defect
- [tags and applies_to are a two-part routing precondition](tags-and-applies-to-are-a-two-part-routing-precondition-2026-08-06.md) — a correct glob is still inert without a matching tag
