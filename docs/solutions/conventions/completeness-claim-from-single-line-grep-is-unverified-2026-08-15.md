---
title: "A completeness claim backed by a single-line grep is unverified — the formatter decides where the syntax breaks"
track: knowledge
category: conventions
tags: [harness, react-native, testing, typescript, grep, prettier, verification, completeness, codemod]
module: shared
applies_to: [scripts/**/*.js, scripts/**/*.ts, client/screens/**/*.tsx, todos/**/*.md]
symptoms: ['A todo, PR body, or audit finding asserts "these N are the remaining instances" and cites a grep as the evidence', 'A cleanup lands, and a later structural scan finds instances the original grep never saw', 'The missed instance uses a different identifier than the one grepped for, or is wrapped across lines by the formatter', 'A lint guard added to prevent a defect class fails immediately on pre-existing code the bounding grep declared clean']
created: '2026-08-15'
---

# A completeness claim backed by a single-line grep is unverified — the formatter decides where the syntax breaks

## Rule

When you bound a defect class — "these are the remaining instances", "this is the
last one", "N call sites need updating" — a `grep` for a literal fragment is
**evidence of the instances it found, never evidence that no others exist.**

Before writing the count into a todo, a PR body, or an audit manifest, verify it
with a scan that is **structural** (matches the code shape, not one spelling of
it) and **whitespace-tolerant** (`\s*` wherever the formatter is free to insert a
line break). If the class is worth counting, it is usually worth a committed
checker — which also converts the one-shot count into an invariant.

## Smell patterns

- A completeness claim whose stated evidence is `git grep "<literal>"`.
- A pattern containing adjacent syntax tokens (`Foo<{`, `) => {`, `import {`)
  with no whitespace tolerance, run over a Prettier/ESLint-formatted repo.
- A grep keyed to an **identifier** (`type RouteParams`) rather than the
  **construct** the rule is actually about.

## Why

Two independent failure modes, and a real case that hit both at once.

`todos/P3-2026-07-31-latent-route-param-shadows-label-photo-analysis.md` asserted
that two screens were the remaining instances of a route-param shadow. It was
bounded by `git grep "type RouteParams" client/screens/`. During implementation a
second grep, `grep -rn "RouteProp<{" client/`, returned the same two files and
appeared to independently confirm the count.

Both were wrong. `client/screens/ItemDetailScreen.tsx` was a third instance:

```ts
type ItemDetailRouteProp = RouteProp<
  { ItemDetail: { itemId: number } },
  "ItemDetail"
>;
```

- The **name-based** grep missed it because it does not use the identifier
  `RouteParams` at all. A grep for a name can only find the instances that chose
  that name.
- The **structural** grep missed it because Prettier had wrapped the type
  argument across four lines, so the characters `RouteProp<{` are never adjacent
  anywhere in the file. `RouteProp<\s*\{` matches it; `RouteProp<{` cannot.

The second one is the general trap. **You do not control where the line breaks
are — the formatter does**, and it re-decides every time the surrounding code
changes length. A pattern that matches today's formatting silently stops matching
when someone renames a variable and pushes the line over the print width. The
grep does not fail; it returns fewer results and looks exactly like a clean run.

Note what was *not* available as a fallback: `tsc` could not have found these.
The shadow is type-*correct* by construction — that is the entire defect (see
`local-route-param-type-shadows-canonical-paramlist-2026-07-30.md`). When the
compiler is the authority, use it; here there was no authority except a scan.

## Examples

```bash
# BAD — the evidence for a completeness claim
git grep "type RouteParams" client/screens/     # finds 2 of 3
grep -rn "RouteProp<{" client/                  # finds the same 2 of 3
```

```js
// BETTER — structural, whitespace-tolerant, and committed as a guard
const INLINE_PARAMLIST = /RouteProp\s*<\s*\{/g;
```

("Better", not "good": this guard was later replaced outright. See **Where this
ended up** below — the residuals it had to document turned out to be properties
of scanning text, not of this particular pattern.)

Two properties make the committed form worth the extra file over a better
one-off grep:

1. **It reports what it scanned.** `✓ ... in 697 files` distinguishes "checked
   and clean" from "checked nothing" — a sweep that silently matches zero inputs
   is green and meaningless.
2. **It is a two-sided control.** Run it *before* the fix and confirm it names
   every instance at the right line; a guard only ever observed passing is a
   decoration.

Both properties are about the guard, not about the guard's *implementation*, so
carry them across when you replace one. When this scanner became an ESLint rule
(below), property 1's implementation — a hard failure on a whole-tree run that
matched zero files — had no ESLint equivalent and was nearly dropped on the
floor. It became a test asserting the rule *resolves* to `error` for a client
path and to nothing for a server path, which pins the enabling glob rather than
a file count. A rule enabled under a `files:` glob that quietly stops matching is
the same vacuous green as a sweep over zero inputs, and nothing else in the
pipeline notices.

Two things the guard must NOT rely on:

- **Formatter ordering.** In `lint-staged`, `prettier --write` and a checker
  registered under a *different* glob key run **concurrently** — separate glob
  entries have no ordering relative to each other (only the commands inside one
  entry's array are sequential). The pattern has to tolerate both the wrapped and
  unwrapped forms on its own merits. The wrapped form also arrives via already-
  committed code, which is the case that actually bit here.
- **One syntactic shape standing in for the class.** A rule that matched only the
  inline literal was walked past by a two-line extract-variable refactor:

  ```ts
  type LocalParams = { Foo: { imageUri: string } };   // same shadow…
  type ScreenRoute = RouteProp<LocalParams, "Foo">;   // …invisible to a form-1-only rule
  ```

  Enumerate the *forms the defect takes*, then find a discriminator that separates
  them from the legitimate shape. Here it is `export`: a canonical ParamList is
  always `export type <Name>ParamList = {` in its navigator module, so an
  unexported object-literal alias is a shadow and an exported one is a source of
  truth — which also stops the navigators from flagging their own declarations.

  **Implement the discriminator you described, literally.** Two attempts at that
  `export` rule shipped before one was real, and both read as correct:

  | Attempt | Why it wasn't the stated rule |
  | --- | --- |
  | `(?!export\b)type` | Dead code. `[ \t]*` cannot consume `export`, so wherever the literal `type` matches, the text cannot also be `export…`. The lookahead could never reject anything the literal didn't already reject. |
  | `^[ \t]*type` (bare anchor) | *Positional, not semantic.* It excused every declaration with any leading token — so `declare type P = { … }`, valid and committable, silently passed. Only `export` was ever meant to be excused. |
  | `^[ \t]*((?:(?:export\|declare)[ \t]+)*)type` + skip when group 1 has `export` | Actually tests the stated condition. |

  The failure mode is subtle and worth naming: a comment describing a *semantic*
  rule, sitting above a regex implementing a *positional* approximation of it.
  The approximation agrees with the rule on every input anyone happened to try,
  so the comment reads as verified. Prefer a pattern that names the condition
  over one that merely correlates with it.

## The scanner is not exhaustive either — say where it stops

Replacing a grep with a structural scan raises the floor; it does not reach a
proof. The same discipline applies one level up: **write down the shapes your
scanner does not cover**, in the scanner, or the next reader inherits your tool as
a completeness guarantee it never was. For the route-param guard those are:

1. anything breaking the literal `type <Name> = {` adjacency the pattern requires —
   a type-parameter list between the name and `=` (**even an unused one over a
   plain object-literal RHS**, so the cause is the adjacency, not the RHS shape),
   or a non-literal RHS like `Readonly<{ … }>`;
2. an exported alias declared inside a screen, indistinguishable from a
   navigator's own canonical declaration;
3. a shadow declared in another module and imported — unreachable for a text
   scanner, and the natural next mutation of the very bug the rule was written
   for;
4. a same-line comment ahead of the declaration, which defeats the line anchor.

State plainly that such a list is what you have *considered*, not a proof of
exhaustiveness — the first version of this one omitted the `declare` case, and a
list presented as complete is worse than no list, because it stops the next
person looking.

Residual 3 was the important one to state, because it is a bound on the technique
rather than a gap in the regex. Knowing which residuals are "not yet handled" and
which are "cannot be handled here" is what tells the next person whether to extend
the tool or reach for a different one.

**But be exact about which technique the bound applies to.** This list originally
called residual 3 "unreachable **in principle** for a single-file scanner", and
that overstatement cost real design time: it made a 31-file source migration look
like the only way out, because detection appeared to be off the table. The true
statement is narrower — it is unreachable for a scanner that matches **text**. A
single-file *AST* rule reaches it easily, because the declaration is in another
file but the `import` statement is in this one, and scope analysis resolves the
binding without any cross-file program load.

"In principle" is a strong claim about a whole class of tools. Reserve it for
cases where the information genuinely is not present in the input; here the
information was sitting in the file's own import list.

## Where this ended up

`scripts/check-route-params.js` was deleted and replaced by the
`ocrecipes/no-shadowed-route-paramlist` ESLint rule
(`eslint-plugin-ocrecipes/index.js`), which resolves the ParamList argument of
`RouteProp` / `NativeStackScreenProps` through scope analysis and requires it to
bind to an import from a navigator module or the `@/types/navigation` barrel.

All four residuals above close at once, and not one at a time — they were all
symptoms of asking *what does the text near this look like* instead of *where is
this identifier bound*:

| Residual | Why it closed |
| --- | --- |
| 1 — `type P<T> = { … }`, `Readonly<{ … }>` | The rule never reads the declaration's syntax; a local binding is a local binding. |
| 2 — exported alias inside a screen | The navigator carve-out is by **filename**, so `export` is no longer load-bearing. That the regex had to trust `export` at all was a symptom, not a design choice. |
| 3 — cross-module import | The import statement is in the linted file. |
| 4 — same-line comment | There is no line anchor to defeat. |

The generalisable part: when a scanner's residual list stops being a set of
independent gaps and starts being one repeated sentence about its *technique*,
that is the signal to change technique rather than widen the pattern. Widening
was actively considered here and correctly declined — skipping a type-parameter
list textually needs `(?:\s*<[^{]*>)?`, which then breaks on a brace-containing
constraint (`<T extends { x: string }>`), trading a known gap for a new wrong
case.

Two things that made the replacement cheap, and are worth checking for before
concluding a rewrite is expensive: the destination already existed
(`eslint-plugin-ocrecipes` had five rules and a `RuleTester` harness), and the
rule needs no type information, so it runs in `lint-staged` *and* CI where a
`ts-morph`/program-load approach would have been CI-only.

## The replacement's own tests passed through the mechanism it abolished

The first cut of the AST rule ended its constructor check with a fallback: when
a type name resolved to no import, match the literal string `RouteProp`. It read
as harmless insurance. It was the old technique, smuggled back in at the new
rule's entry point — and the tests hid it, because **a test written before the
mechanism changed will still exercise the old one if the fixture allows it.**

Most `invalid` fixtures had been written as bare snippets — `type R =
RouteProp<LocalParams, "Foo">` with no `import` line, because under a text
scanner the import never mattered. Every one of them therefore reached the rule
with `RouteProp` unbound, matched the fallback, and reported. The suite was
green, and its header claimed it proved resolution "by binding, not spelling".
Deleting the fallback failed 11 of 14 cases.

The valid side was worse. The case pinning the navigator carve-out also omitted
the import, so the constructor was unrecognised and the rule short-circuited to
zero errors — indistinguishable from "correctly judged canonical". That test
would have passed against a rule that did nothing at all.

Three things generalise:

1. **Migrating a check to a new mechanism does not migrate its tests.** Fixtures
   encode the *old* mechanism's assumptions about what is irrelevant. Text
   scanners do not care where a name comes from, so nobody wrote the import
   down; the moment provenance became the whole rule, every fixture was
   under-specified — and silently, because under-specified fixtures still pass.
2. **Delete the branch you suspect and re-run.** Not "read it and reason about
   it": the fallback survived a self-review and a full green suite. One mutation
   run produced the count — 11 — that no amount of reading did.

   Then note what that single mutant does *not* prove. Breaking
   `importBindingOf` failed 15 of 15 invalid cases, which was read at the time as
   "the repair is real" — but it only proved the fixtures now route through
   binding resolution *for the forms already covered*. The same commit had added
   a second branch (namespace-qualified access), and three separate mutants of
   **that** branch each killed zero tests. One mutant is evidence about one
   branch. Scope the claim to the mutant, or run a battery: the eventual battery
   here was 7 mutants across every helper, and only a zero-survivor result is
   evidence about the rule.
3. **A compatibility fallback needs a named legitimate trigger.** "Covers the
   case with no import in scope" sounds like defensive engineering until you ask
   which compiling file that is. `RouteProp` is an ordinary named export, never
   an ambient global, so a real reference is *always* import-bound: the fallback
   could only ever fire on an unrelated type that shared the name. A fallback
   whose only reachable input is the false positive is not insurance, it is the
   bug.

## The same substitution, a third time — now in the allowlist

The rule's allowlist answered "is this ParamList canonical?" by testing the
import specifier's **text**:

```js
// BAD — three unanchored patterns, none of which is the condition
/(?:^|\/)navigation\/[A-Za-z0-9_$]+Navigator$/.test(source) ||
  /^\.{1,2}\/[A-Za-z0-9_$]+Navigator$/.test(source) ||
  /(?:^|\/)types\/navigation$/.test(source);
```

Every one of those matches from anywhere in the tree. `./FakeNavigator` sitting
next to a screen satisfied the second — so "extract the shadow to a shared file",
**the exact mutation residual 3 is named after**, was accepted whenever the
extracted file happened to be called `*Navigator`. Reproduced against the real
tree: a shadow in `client/screens/__probeFakeNavigator.ts`, imported by a sibling
screen, produced no diagnostic.

The condition is *where the module lives*. Spelling merely correlated with it.

The first attempt at that fix **was still a correlate**, and this is the part
worth reading twice:

```js
// STILL WRONG — resolves against the importing file, but anchors to nothing
const resolved = resolveSpecifier(source, filename); // "@/x" → "client/x"; "./x" → dirname + x
/(?:^|\/)client\/navigation\/[A-Za-z0-9_$]+Navigator$/.test(resolved);
```

`(?:^|\/)` matches wherever a slash precedes, and `resolveSpecifier` never
anchored to a known project root — so the test degraded from "lives in the
repo's `client/navigation/`" to "the resolved string happens to *end* in
`.../client/navigation/<Name>Navigator`". Both of these were accepted as
canonical, verified against the real eslint CLI with real planted files:

```ts
// a shadow nested under a screen, no traversal tricks at all
import type { P } from "@/screens/vendor/client/navigation/EvilNavigator";
// a path that climbs clean out of the repository
import type { P } from "../../../../evil-sibling/client/navigation/FooNavigator";
```

```js
// GOOD — resolve to a REPO-ROOT-relative path, then start-anchor
const PROJECT_ROOT = path.resolve(path.dirname(module.filename), ".."); // not process.cwd()
const resolved = resolveSpecifier(source, filename); // repo-root-relative
/^client\/navigation\/[A-Za-z0-9_$]+Navigator$/.test(resolved);
```

Two transferable details. **Derive the root from the tool's own location, not
`process.cwd()`** — cwd varies with how the linter was invoked, and a root that
moves is not a root. And **a path outside the root comes back from
`path.relative` with a leading `../`**, which a start-anchored pattern rejects
for free; that is why anchoring closes the climb-out case without a separate
check for it.

Note the shape of the miss. The *other* half of the same allowlist —
`isCanonicalParamListFile`, which decides whether the file being linted may
declare its own ParamList — was already location-based. One rule, two halves,
two different definitions of "canonical", and the weaker half was the one facing
the untrusted input.

**Count the instances before concluding it was bad luck.** In this one rule's
lineage the same substitution shipped four times:

| # | Condition | Correlate that shipped |
| --- | --- | --- |
| 1 | is this declaration a navigator's own? | does the line start with `export`? |
| 2 | is this constructor react-navigation's? | is it *spelled* `RouteProp`? |
| 3 | does this ParamList live in a navigator module? | does the specifier *look* like a navigator path? |
| 4 | …*same condition*, after fixing #3 | does the resolved path *end* in a navigator path? |

Each passed review. Each was green on the whole tree. Each failed on the first
input that separated the correlate from the condition — which is also the test
nobody writes, because the fixture that separates them is the one you have to
already suspect.

Row 4 is the one to internalise: **fixing a correlate is the moment you are most
likely to ship another one.** The fix for #3 was written, reviewed and shipped
as "test location, not spelling" — while still testing a *substring* of the
location. The intent was right and the implementation stopped one step short,
which is exactly the state that reads as done. Worse, the person who shipped it
had explicitly listed "a path containing a `client/navigation` segment that is
not the repo's" as an attack to check, and shipped it anyway: naming the attack
is not running it.

Three habits catch this where reading does not:

- **When a check has two halves, make both answer the question the same way.**
  Asymmetry is the tell. Here `isCanonicalParamListFile` (location-based) and
  `isCanonicalParamListModule` (text-based) disagreed for a full round, and the
  weaker half was the one facing untrusted input.
- **Plant the adversarial input; do not reason about the pattern.** Every one of
  these four was found by writing a file and running the real tool, and none by
  reading the regex — including by readers who were specifically looking.
- **Mutate the fix, then check what the mutant kills.** After #4 was fixed, a
  mutation reverting the anchor was killed by only 2 tests, and three other
  mutants survived outright — including one proving the suite could not tell a
  repo-rooted resolution from an unrooted one, because every fixture passed a
  *relative* filename while real eslint passes an *absolute* one. A suite that
  never sees production's input shape is not testing production.

Where the compiler *does* adjudicate, let it: an `interface`-based shadow needs no
rule at all, because interfaces get no implicit index signature and `tsc` rejects
them against `ParamListBase`.

## Exceptions

- A grep is fine as a **discovery** tool — the problem is only citing it as proof
  of exhaustiveness.
- When a type-level authority exists, prefer it: adding a required field to a
  shared DTO is completeness-checked by `tsc --noEmit`, not by any scan
  (see See Also). Reach for a structural scan when the defect is invisible to the
  compiler.
- A literal grep is sound over a corpus no formatter touches — which is why
  `docs/solutions/` is in `.prettierignore`: the inject hook's `^tags:` match is
  line-anchored and would break the same way.

## Related Files

- `eslint-plugin-ocrecipes/index.js` → `no-shadowed-route-paramlist` — the guard
  that replaced the scanner, with its own (much shorter) coverage-gap block
- `eslint-plugin-ocrecipes/__tests__/rules.test.ts` — keeps the Prettier-wrapped
  regression case, because that is the form a real violation takes, plus one case
  per residual the text scanner could not reach
- `client/screens/ItemDetailScreen.tsx` — the instance both greps missed
- `scripts/check-route-params.js` — **deleted**; the structural, whitespace-tolerant
  regex guard this doc was written about. Kept in the narrative because the
  residuals it was forced to document are the whole lesson.

## See Also

- [A grep-retrieved corpus needs a write-time format lint](grep-retrieved-corpus-needs-write-time-format-lint-2026-07-03.md) — the same formatter-vs-line-anchored-match collision, on the KB side
- [Adding a required field to a shared DTO — verify completeness with tsc, not just grep](required-field-on-shared-dto-needs-tsc-driven-fixture-sweep-2026-07-24.md) — the sibling case where a compiler IS available as the completeness authority
- [A local route param type shadows the canonical ParamList](../logic-errors/local-route-param-type-shadows-canonical-paramlist-2026-07-30.md) — the defect class this was counting
- [A verification that scans ZERO inputs is green and meaningless](../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md) — why the guard asserts its scanned count
- [Prettier wraps committed solutions-db fixtures, breaking the grep-based inject path](../logic-errors/prettier-wraps-fixture-tags-breaks-hook-equiv-grep-2026-06-21.md) — the same root cause inside the hook plumbing
