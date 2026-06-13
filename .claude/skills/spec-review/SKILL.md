---
name: spec-review
description: "Review feature specs, design docs, and brainstorm-produced implementation plans before coding. Use for docs/superpowers/specs files, feature proposals, or planning docs that need correctness, scope, security, pattern-fit, drift, and rollout scrutiny."
argument-hint: "Path to the spec file, plus optional focus areas or known concerns"
user-invocable: true
---

# Spec Review

Review a feature spec before implementation. Default target is a brainstorm-produced spec under `docs/superpowers/specs/`, but this workflow also applies to brainstorm docs and planning docs when the user wants an earlier review pass.

This is a review workflow, not an implementation workflow. Do not edit product code unless the user explicitly asks.

## When to Use

- A brainstorm session produced a spec and you need to decide whether it is safe and ready.
- A brainstorm doc or implementation plan needs a review before it is promoted into a final spec.
- A feature plan needs validation against existing OCRecipes architecture, domain rules, or known repo patterns.
- You want to catch scope creep, security gaps, migration risk, missing tests, or repo-specific drift before coding starts.
- A spec proposes work in risky areas such as routes, storage, AI services, TanStack Query flows, navigation, or data ownership.

## Inputs

- A spec, brainstorm, or plan path, ideally under `docs/superpowers/specs/` or another planning-doc location.
- Optional focus areas from the user, such as `security`, `scope`, `testing`, `drift`, or `architecture`.

If no path is given, first ask for the spec file.

Adapt to the document that is actually provided. Do not assume fixed headings, a final-spec structure, or named sections such as Acceptance Criteria, Out of Scope, or Validation. Infer the structure from the document first, then review what is there.

## Review Standard

Treat the spec as the contract for implementation. The review must answer all of these:

1. Is the requested behavior technically correct for this codebase?
2. Is the scope explicit, bounded, and consistent with the real files and ownership boundaries?
3. Does it follow established repo patterns instead of inventing parallel structure?
4. Does it avoid forbidden or human-plan-required areas unless the spec explicitly calls that out?
5. Does it prevent known drift hazards: duplicated sources of truth, stale tool names, copied constants, hand-synced contracts, or generated-artifact mismatch?
6. Does it specify verification strong enough to prove the change worked?

Before setting the review bar, calibrate against prior similar specs in this repo. Do not review the current document in isolation when historical precedent is available.

## Procedure

### 1. Find relevant prior specs

Before reviewing the current document, inspect a small sample of prior specs or plans that appear related by feature area, subsystem, or workflow.

Use an explicit search strategy instead of a vague similarity pass.

Search in this order:

1. Same basename across `docs/superpowers/specs/` and `docs/superpowers/plans/`
2. Same subsystem tokens in the filename or title
3. Same workflow family, such as `audit`, `todo`, `kimi`, `copilot`, `coach`, `recipe`, `camera`, `ocr`, `eval`, `lsp`, `eslint`, `timezone`, or `worktree`
4. Same architectural surface, such as client UX, client-state, server routes, storage, AI workflow, or review infrastructure
5. Same document intent, such as design, hardening, rollout, verification, or reliability

Build the prior-spec sample from 2 to 4 documents, not a broad corpus dump.

Practical matching heuristics:

- Strip the leading date and trailing `-design` when comparing filenames
- Split remaining names on hyphens and match the strongest nouns first
- Prefer exact token overlaps such as `coach`, `ocr`, `todo`, `audit`, `kimi`, `eval`, or `recipe`
- If the current file is in `specs/`, check whether a same-topic file exists in `plans/`, and vice versa
- Prefer newer precedents when several candidates are similarly close

Prefer the closest precedents first:

- Same feature family or subsystem
- Same layer or domain, such as client-state, routes, storage, AI workflow, or review infrastructure
- Same document type, such as design doc, implementation plan, or hardening plan

Use the prior specs for calibration, not for blind template enforcement. Extract:

- Common structure patterns that recur in similar docs
- Typical detail level for files, decisions, risks, and validation
- Repeated design constraints or review concerns
- Places where prior specs were more precise than the current one, or where they were intentionally lighter

When the sample contains both a plan and a design/spec for the same topic, use that pairing to infer maturity: the plan often shows the lighter planning shape, while the design/spec shows the bar expected before implementation.

If no useful precedent exists, continue with the current document alone and say so.

### 2. Triage the spec

Read the spec file and identify the structure it actually uses. Then extract, where present or reasonably inferable:

- Goal and user-visible outcome
- Explicit in-scope work
- Explicit out-of-scope work
- Files, subsystems, and domains the spec expects to touch
- Open questions, assumptions, and unresolved decisions
- Proposed validation steps

Do not turn every omitted section into a finding by default. A missing section is only a finding when the absence creates ambiguity, risk, or implementation drift that matters for this repo.

Examples:

- A brainstorm note may be acceptable without formal headings if the intended change, boundaries, and major risks are still recoverable.
- A final implementation spec should usually be more concrete; if key execution or validation details are absent, flag the missing information as a finding.

Use the prior-spec sample to decide what level of precision is normal for this class of document in this repo.

### 3. Map the affected domains

Convert the document's touched paths into repo **rules-domains** from the single source of truth rather than a hand-maintained list. For a concrete set of files:

```bash
npx tsx scripts/lib/path-domains.ts <file1> <file2> ...
```

This prints the rules-domains union (routing-only labels such as `camera` are excluded — spec-review needs rules-domains, since Step 4 reads `docs/rules/<domain>.md`). The mapping is defined once in `scripts/lib/path-domains.ts` and is also rendered into the "Path → domain mapping" table in `.github/copilot-instructions.md`; consult that table when you only have path patterns rather than concrete files.

Always include `typescript` for `.ts` and `.tsx` surfaces.

### 4. Load the minimum binding context

Read only the docs needed to judge the spec:

- `.github/copilot-instructions.md` for hard exclusions and path-domain mapping
- `docs/rules/<domain>.md` for each affected domain
- `docs/legacy-patterns/<domain>.md` only when a rule or pattern needs clarification
- `docs/AI_WORKFLOW.md` or `docs/AI_DRIFT_CHECKLIST.md` when the spec changes AI workflow, review flow, tool wiring, or generated artifacts
- Nearby implementation files only when the spec claims a pattern or boundary that needs verification

Do not broad-map the repo. Read just enough to validate the controlling boundaries and the highest-risk claims.

Let the spec drive the depth of the review. A rough brainstorm may need more inference and more open questions. A detailed design doc should be reviewed against a higher bar for precision and completeness.

Let the precedent sample adjust that bar too. If similar approved specs in this repo consistently include decision tables, touched-file lists, rollout order, or explicit failure paths, treat their absence in the current doc as a stronger signal. If the historical precedent is intentionally lightweight, do not demand ceremony that the repo itself does not use.

### 5. Run the review lenses

Evaluate the spec through each lens below.

#### Correctness and architecture

- Does the plan place behavior in the right layer: routes -> services -> storage -> db?
- Does it preserve current ownership and dependency direction?
- Does it name the real integration points already used by the app?
- Does it avoid thin wrappers, duplicated orchestration, or speculative abstractions?

#### Scope and execution safety

- If the doc includes acceptance criteria or equivalent outcomes, are they concrete and testable?
- Is the change split into mergeable slices if it is large?
- Does the spec quietly expand into migrations, auth, receipts, health data, or broad architecture overhaul?
- If a hard-exclusion area is implicated, does the spec correctly mark it as human-reviewed or blocked pending plan approval?

#### Security and data ownership

- Are user ownership boundaries explicit for routes, storage, and caches?
- Does the plan preserve JWT bearer-token assumptions rather than introducing cookie/session behavior?
- Are upload, AI, and external-call boundaries validated?
- Does the spec avoid creating IDOR, SSRF, prompt-injection, or unsafe background-work holes?

#### Pattern fit and consistency

- Does the spec reuse existing modules, helpers, route helpers, query-key patterns, theme/navigation conventions, and service boundaries?
- Does it describe current repo conventions accurately, or is it inventing a new pattern when a repo standard already exists?
- Are shared contracts, enums, or constants sourced from one place?
- Does it align with how similar previous specs in this repo framed the same problem space, unless there is a clear reason to depart?

#### Drift prevention

- Does the plan create duplicated sources of truth across docs, code, generated files, tests, or configs?
- Does it rely on brittle tool names, stale workflow assumptions, or manual hand-sync steps?
- Does it require a drift check, generated-file check, or smoke test to keep paired artifacts aligned?

#### Validation strength

- Are the proposed tests the narrowest checks that would falsify the main behavior claims?
- Does the spec include typecheck, lint, targeted tests, or review steps where appropriate?
- Are risky behavioral claims backed by executable validation rather than diff inspection alone?
- Does the validation plan match the strength seen in comparable prior specs for similar risk?

### 6. Verify the spec against live code where needed

If a claim depends on the current codebase, confirm it:

- Read the owning file or call site.
- Use symbol-aware tools for definitions or references when a spec assumes a rename, shared helper, or existing abstraction.
- If the spec says a pattern is already established, verify that pattern exists before approving the plan.

Flag any mismatch between the written spec and actual code as drift.

### 7. Decide the verdict

Use one of these outcomes:

- `approve` — ready to implement as written
- `approve-with-edits` — small spec corrections needed, but the design is sound
- `revise` — important gaps or risks; implementation should wait for spec updates
- `split` — valid direction, but scope should be broken into smaller slices first
- `reject` — conflicts with repo rules, architecture, or hard exclusions

Escalate to `reject` when the spec crosses a hard-exclusion area without the required human plan or proposes an architecture that contradicts established boundaries.

## Output Format

Return findings first, ordered by severity.

Base the findings on what the document is trying to be. Review brainstorms as early-stage planning artifacts, and review finalized specs as implementation contracts. Do not criticize a brainstorm for not being a finished spec unless that gap would mislead implementation.

When historical precedent materially informed the review, say so briefly. Cite the relevant prior spec(s) as calibration points and explain whether the current document matches, exceeds, or falls short of the repo's normal pattern for similar work.

For each finding, include:

- Severity: `critical`, `high`, `medium`, or `low`
- Spec section or heading
- Why it is a problem in OCRecipes specifically
- The repo rule, pattern, or code fact it conflicts with
- The exact revision needed

Then provide:

1. `Verdict:` one of `approve`, `approve-with-edits`, `revise`, `split`, `reject`
2. `Required changes:` only the must-fix items before implementation
3. `Open questions:` any unresolved decisions that the spec still leaves ambiguous
4. `Validation plan:` the concrete checks implementation should run if the spec is accepted

If there are no findings, state that explicitly and still note residual risks or assumptions.

## Review Heuristics For This Repo

- Prefer extending an existing route, service, storage module, hook, or navigator over creating a parallel abstraction.
- Specs should name concrete file surfaces whenever the touched area is already known.
- Avoid plans that require humans to manually keep two lists, schemas, constants, or generated artifacts in sync without a check.
- If a feature is non-trivial, prefer mergeable phases with clear rollback points.
- For AI-workflow or harness changes, explicitly check for tool-name drift, stale review routing, and generated-instructions drift.
- For client state, verify the plan fits TanStack Query and existing context ownership rather than introducing ad hoc caches.
- For Express work, expect route helpers, explicit ownership checks, and service/storage separation.
- For React Native work, expect navigation typing, theme-system alignment, accessibility considerations, and performance awareness on hot paths.

## Optional Specialist Pass

If the spec spans multiple risky domains, run targeted specialist reviews after the initial pass. Typical mappings:

- `api` or route-heavy spec -> `api-specialist`
- storage, schema-adjacent, or data-integrity-heavy spec -> `database-specialist`
- cross-layer ownership or service-boundary changes -> `architecture-specialist`
- AI, evals, or prompt-safety changes -> `ai-llm-specialist`
- React Native interaction or navigation changes -> `rn-ui-ux-specialist`
- verification or test-strategy questions -> `testing-specialist`
- security-sensitive surfaces -> `security-auditor`

Use specialists to deepen the review, not to replace the core verdict.
