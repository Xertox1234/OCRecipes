# Maintainability Audit Checklist (Structural-Quality Lens)

Used by the `/audit maintainability` scope and as a parallel discovery lens within
`pre-launch` and `code-quality` (see `SKILL.md` → "Maintainability Scope").

Adapted from Cursor's "Thermo-Nuclear Code Quality Review" skill, project-tuned —
600-line file threshold (not 1000), explicit dedup guard against sibling
reviewers. The unique value of this lens is **bias toward deletion over
rearrangement**: looking for the restructuring that makes whole branches,
helpers, modes, or layers disappear rather than polishing the same complexity.

For each finding, record in the manifest: `file:line`, severity
(Critical/High/Medium/Low), and — critical — the **simpler design** that would
replace the existing one. A finding with no proposed simpler structure is
incomplete: this lens flags opportunities, and an opportunity without a sketch
is not actionable.

## Core mindset (rule 0)

Be ambitious about structural simplification. Do not stop at "this could be a
bit cleaner." Actively search for "code judo" moves — reframings that preserve
behavior while making the implementation dramatically simpler, smaller, more
direct, and more elegant. Prefer the solution that makes the code feel
inevitable in hindsight.

If you see a path to **delete** complexity rather than rearrange it, push hard
for that path.

## Dedup with sibling reviewers (CRITICAL)

This lens runs alongside `server-reviewer` and `code-reviewer`. Do NOT re-flag
what they would catch — the manifest balloons and the "two perspectives"
benefit becomes noise:

- **Skip:** boundary violations, layer leaks, dependency-direction breaks
  (`server-reviewer` owns these as defects)
- **Skip:** missing types, unsafe casts as defects, Zod gaps, missing error
  handling, lint/type errors, untested boundaries (`code-reviewer` owns these)

**Your unique scope:**

- Missed simplifications where a re-organization deletes complexity entirely
- Spaghetti growth: new ad-hoc conditionals inserted into unrelated flows
- File size growth past 600 lines
- Thin wrappers / identity abstractions that add indirection without buying clarity
- Avoidable sequential / non-atomic orchestration where the simpler structure is obvious

If a finding could equally come from a pattern-driven reviewer, skip it. If a
finding overlaps but you can frame it as a _simpler design_ the reviewer
wouldn't propose (e.g., "the right fix is not to add a type guard here, it's to
delete this branch entirely by reshaping the input"), keep it — and make the
simpler design the heart of the finding.

## Non-negotiable standards

### Standard 1 — 600-line file size threshold

- No PR pushes a file from under 600 lines to over 600 lines without a strong
  structural reason. Treat as a presumptive blocker.
- Files already over 600: flag when the PR makes them meaningfully larger.
- Preferred remedy: extract helpers, subcomponents, or modules rather than
  letting the file sprawl.

### Standard 2 — No spaghetti growth in existing code

- New ad-hoc conditionals, scattered special cases, or one-off branches
  inserted into unrelated flows are a design problem, not a stylistic nit.
- Preferred remedy: push the logic into a dedicated abstraction, helper, state
  machine, policy object, or separate module.
- Call out changes that make the surrounding code harder to reason about,
  even if they technically work.

### Standard 3 — Clean the design, not just the working code

- If behavior can stay the same while the structure becomes meaningfully
  cleaner, push for the cleaner version.
- Strongly prefer simplifications that **remove moving pieces** over refactors
  that spread the same complexity around.
- Do not rubber-stamp "it works" implementations that leave the codebase messier.

### Standard 4 — Direct, boring, maintainable over hacky or magical

- Treat brittle, ad-hoc, or "magic" behavior as a code-quality problem.
- Be skeptical of generic mechanisms that hide simple data-shape assumptions.
- Flag thin abstractions, identity wrappers, or pass-through helpers that add
  indirection without buying clarity.

### Standard 5 — Type/boundary cleanliness (maintainability angle only)

- Question unnecessary optionality, `unknown`, `any`, or cast-heavy code **when
  a clearer type boundary could exist** — the maintainability cost is the
  structural complexity that follows, not the cast itself (`code-reviewer`
  owns the cast-as-defect angle).
- If a branch relies on silent fallback to paper over an unclear invariant, ask
  whether the boundary should be made explicit instead.

### Standard 6 — Canonical layer, reuse canonical helpers

- Call out feature logic leaking into shared paths or implementation details
  leaking through APIs (boundary angle only — `server-reviewer` owns the
  layer-violation defect angle).
- Prefer existing canonical utilities/helpers over bespoke one-offs.
- Push code toward the right package, service, or module instead of normalizing
  architectural drift.

### Standard 7 — Avoidable sequential / non-atomic orchestration

- If independent work is serialized for no good reason, ask whether the flow
  should run in parallel instead.
- If related updates can leave state half-applied, push for a more atomic structure.
- Do not over-index on micro-optimizations; flag only when the sequencing
  complexity makes the implementation more brittle.

## Approval bar (presumptive blockers)

Treat these as presumptive Critical blockers unless clearly justified:

- The change preserves a lot of incidental complexity when a plausible
  code-judo move would delete it
- The change pushes a file from below 600 lines to above 600 lines
- The change adds ad-hoc branching that makes an existing flow more tangled
- The change solves a local problem by scattering feature checks across
  shared code
- The change adds an unnecessary abstraction, wrapper, or cast-heavy contract
  that makes the design more indirect
- The change duplicates an existing canonical helper or puts logic in the
  wrong layer

## Tone

Be direct, serious, and demanding about quality. Do not be rude, but do not
soften major maintainability issues into mild suggestions. If the
implementation missed an opportunity for a dramatic simplification, say so
clearly.

Good phrasings:

- "this pushes the file past 600 lines. can we decompose first?"
- "this adds another special-case branch into an already busy flow. can we
  move this behind its own abstraction?"
- "this works, but it makes the surrounding code more spaghetti. let's keep
  the behavior and restructure the implementation."
- "this abstraction seems unnecessary. can we just keep the direct flow?"
- "i think there's a code-judo move here that makes this much simpler. can we
  reframe so these branches disappear?"
- "this refactor moves complexity around, but doesn't really delete it. is
  there a way to make the model itself simpler?"

## Output priority

Prioritize findings in this order:

1. Structural code-quality regressions (Standards 3, 4, 6)
2. Missed code-judo / dramatic-simplification opportunities (rule 0)
3. Spaghetti / branching complexity increases (Standard 2)
4. 600-line file size growth (Standard 1)
5. Boundary/type contracts that obscure the real design (Standard 5)
6. Avoidable orchestration complexity (Standard 7)

Do not flood the manifest with low-value nits when larger structural issues
exist. Prefer a small number of high-conviction findings over a long list of
cosmetic notes.
