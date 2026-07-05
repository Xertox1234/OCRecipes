---
title: A symbol-existence grep passes while the claim about the symbol is wrong — verify the predicate at the source
track: bug
category: logic-errors
module: shared
severity: medium
tags: [verification, fact-checking, agents, prompts, documentation, grep, review, drift]
symptoms: [Doc or agent-file prose cites real symbols but states wrong relationships between them (order, exclusivity, tier assignment, wrong owning file), A pre-merge fact-check grepped every cited symbol and came back green, Adversarial review later confirms several claims false against source comments and existing tests]
applies_to: [.claude/agents/**/*.md, .claude/skills/**/*.md, docs/**/*.md]
created: '2026-07-05'
---

# A symbol-existence grep passes while the claim about the symbol is wrong — verify the predicate at the source

## Problem

PR #512 rewrote `.claude/agents/prompt-engineer.md` with a "repo convention" section
citing real code symbols. The pre-merge fact-check grepped each cited symbol —
`SYSTEM_PROMPT_BOUNDARY`, `sanitizeUserInput`, `MODEL_FAST`/`MODEL_HEAVY`,
`getSystemPromptTemplateVersion` — every one resolved, so the section shipped.
Adversarial review then confirmed four of the claims false:

- the stated system-message shape put the boundary constant **second**, while the repo
  convention is boundary-**last** (a deliberate injection defense, stated in a
  `nutrition-coach.ts` comment and asserted by a unit test);
- "user strings enter prompts **only** via `sanitizeUserInput()`" — five call sites
  route non-user-role content through `sanitizeContextField()`;
- judge determinism conventions were attributed to `evals/judge.ts`, a thin wrapper —
  the implementation lives in `evals/lib/judge-generic.ts`;
- the tier split "`MODEL_FAST` text, `MODEL_HEAVY` vision" contradicted the tier
  comments in the very file it cited.

## Symptoms

- Prose cites identifiers that all resolve, yet states wrong order, exclusivity,
  attribution, or assignment between them.
- The fact-check log shows only existence greps (`grep -n '<symbol>' <file>`), no reads
  at the claim site.
- Review verifiers refute claims by quoting a comment or test one screen away from the
  grep hit.

## Root Cause

Repo-fact claims are **predicates** — _A comes after B_, _only X does Y_, _X is for
text and Y for vision_, _the mechanism lives in F_. An existence grep verifies only the
**referent**: that the identifier resolves somewhere. It cannot validate order,
exclusivity, attribution, or assignment. Generated or paraphrased prose (LLM output,
checklist copies) drifts precisely at the predicate level while keeping the real
identifiers, so symbol-level checks systematically pass on wrong claims.

## Solution

For each repo-fact claim, name the predicate, then check **that predicate** at the
cited source:

- **Order claims** ("boundary goes after the role line") → read the assembly code plus
  its comments and any test asserting position (`nutrition-coach.ts` had both).
- **Exclusivity claims** ("only via X") → grep for the alternates, not the named
  function (`sanitizeContextField` falsified "only `sanitizeUserInput`").
- **Attribution claims** ("the judge lives in `evals/judge.ts`") → open the named file
  and confirm the behavior is implemented there, not re-exported from elsewhere.
- **Assignment claims** ("FAST = text, HEAVY = vision") → read the source-of-truth
  comments/config the claim cites.

Per-claim adversarial verifiers (each prompted to _refute_ one claim) caught all four
defects that the symbol-existence pass had approved.

## Prevention

- Prefer pointers to the authoritative source over restated mechanism snapshots; when a
  fact must be inlined, keep it at the principle level and name the file to read.
- Treat sections flagged "repo convention, not published evidence" as the priority
  target for claim-level verification — in this incident (and the `ai-reviewer.md`
  cache-bump staleness that preceded it), every confirmed defect sat in exactly such a
  section.
- When a doc restates another doc's checklist, verify against the **code**, not the
  other doc — the upstream copy may itself have drifted (the cache-bump claim was
  faithfully transcribed from an already-stale checklist).

## Related Files

- `.claude/agents/prompt-engineer.md` — the agent definition whose convention section shipped the four defects
- `server/services/nutrition-coach.ts` — boundary-last comment + test; the auto-hash the stale cache claim missed
- `server/lib/ai-safety.ts` — `sanitizeUserInput` vs `sanitizeContextField`
- `evals/lib/judge-generic.ts` — judge implementation (`evals/judge.ts` is a thin wrapper)

## See Also

- [assert-command-absent-grep-matches-doc-comment-strip-first](assert-command-absent-grep-matches-doc-comment-strip-first-2026-07-05.md) — sibling lesson: a green grep can be testing the wrong predicate entirely
- [../conventions/cross-reference-code-by-stable-name-not-line-numbers-2026-07-03.md](../conventions/cross-reference-code-by-stable-name-not-line-numbers-2026-07-03.md) — anchor prose to stable names so references survive refactors
- [../best-practices/mechanism-retirement-prose-vocabulary-sweep-2026-07-03.md](../best-practices/mechanism-retirement-prose-vocabulary-sweep-2026-07-03.md) — the retirer-side duty; this file is the writer/verifier-side counterpart
- [../conventions/agent-file-edits-take-effect-on-reload-not-save-2026-07-02.md](../conventions/agent-file-edits-take-effect-on-reload-not-save-2026-07-02.md) — why read-only agents never see auto-injected rules and need explicit pointers
