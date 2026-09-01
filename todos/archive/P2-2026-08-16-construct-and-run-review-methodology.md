---
title: "Codify 'construct the failing input and run it' as review methodology — and require controls on the reviewer's own probe harness"
status: done
priority: medium
created: 2026-08-16
updated: 2026-08-31
assignee:
labels: [harness, agents, testing, workflow, docs]
github_issue:
human_led: true
blocked_reason: "The user reserved the expansion for themselves ('so I can come back to this and expand the idea into other areas'). The core AC is deciding WHICH surfaces this should reach — reviewer agent definitions, the Review Policy, /codify, /audit, todo templates, or none of them — which is a judgment call about process weight, an area where the user has corrected the agent before (feedback_calibrate_process_weight_to_task_size). An unattended run would pick a subset and write it up as settled."
---

# "Construct the failing input and run it" — make it the review method, not a habit

## Summary

Across a 12-PR review round on 2026-08-16, **every CRITICAL finding came from building
the failing input and executing it.** None came from reading the code and reasoning about
it. That is a strong enough signal to be worth encoding somewhere, rather than depending
on whichever reviewer happens to work that way.

A second, subtler lesson came with it: **an ad-hoc probe harness is itself an artifact
that can lie**, and a negative result from an unvalidated one is not evidence.

## Background — the evidence

Two internal review rounds had already passed on most of these PRs. The independent round
found 5 CRITICALs. How each was found:

| Finding                                                                        | Found by                                                              |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Trailing `;` disarms every predicate in the outward-CLI deny gate              | Enumerating bypass strings and piping each to the hook                |
| The repo's own OTA publish script was allowed by that gate                     | Piping the literal command string                                     |
| A line-continuation split bypassed both degraded paths                         | A byte-level fixture checked with `od -c`                             |
| Missing `awk` made the gate allow everything, no crafting needed               | Building a restricted PATH and running it                             |
| `"12,5 millilitres"` parsed as 5, corrupting a self-consistency shield         | Running `main`'s and the branch's parser side by side on a case table |
| A partial-escape SQL mutant passed all 7 assertions of a delete-perimeter test | Building the mutant and rendering the real SQL                        |
| An IDOR regex over-matched non-function exports                                | Running the branch's script against synthetic fixtures                |
| A new guard rejected a config that parses correctly today                      | Running the parser with the guard removed                             |

Contrast — what **reading** did catch, so this is not framed as an absolute: scope-contract
violations, a solution doc claiming a regression test that was a one-line comment edit
(found by `git diff --unified=0` against the claim), and an ALLOWLIST count that was 45 not
55 (found by counting). The honest generalisation is **verify the claim against the
artifact, and prefer execution wherever execution is possible** — not "never read."

### The probe-harness half

While verifying one of those CRITICALs I reported "still not fixed" from a harness whose
restricted PATH was missing `grep` as well as the target binary, and which sourced a stale
copy of a shared lib. Both defects pushed toward a false negative. The corrected harness
showed the fix was fine.

A probe needs the same two-sidedness the repo already demands of gate _tests_
(`docs/solutions/conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md`):

- a **positive control** — something that must produce the "bad" verdict, proving the
  harness can see anything at all;
- a **negative control** — something that must produce the "good" verdict, proving it is
  not just denying everything.

Without both, a probe that outputs `allow` for every input looks exactly like a clean bill
of health.

## The question to answer

**Which surfaces should carry this, and at what weight?** Candidates, roughly in
increasing cost — pick, do not do all:

- `.claude/agents/code-reviewer.md` and `security-auditor.md` — a line in each: for a
  guard, a parser, or a predicate, construct the input it must reject and run it; report
  the command and its output, not a conclusion.
- `docs/AI_WORKFLOW.md` → Review Policy — the roster's shared contract, so it reaches every
  dispatched reviewer including the generic-skill ones.
- The reviewer **dispatch prompt template** in that same section — where per-review
  instructions actually get written.
- `/codify` — should a solution doc claiming a behavioural fact carry a runnable repro line?
- `/audit` — same question for audit findings.
- `todos/TEMPLATE.md` — a "how this was verified" field, so a filed claim carries its
  provenance.
- Nothing: accept that this is what a good reviewer already does and that encoding it adds
  process weight for little gain.

## Acceptance Criteria

- [x] A human decides which of the surfaces above (if any) carry the rule, and records the
      reasoning — including an explicit "not these, because" for the ones left out
- [x] Wherever it lands, the wording distinguishes the two halves: (a) construct-and-run as
      the review method, (b) controls on the reviewer's own probe harness. They are separate
      claims and (b) is the one nothing currently covers
- [x] The chosen wording does NOT duplicate
      `gate-test-needs-two-sided-negative-control-2026-07-25.md`, which governs how gate
      TESTS are authored; this is about how REVIEWS are conducted and how scratch tooling is
      validated. Cross-reference rather than restate
- [x] If a solution doc is written, it cites the evidence table above rather than asserting
      the pattern abstractly
- [x] Closes with zero follow-ups

## Implementation Notes

- Resist making this long. A paragraph in the right place beats a new document nobody
  routes to. (For sizing: `docs/rules/harness.md` was 4621 bytes of its 6500 cap on
  2026-08-16, so there is room there — but rules files are injected WHOLE before every edit
  in their domain, so spending that headroom has an ongoing per-edit cost, not a one-off
  one.)
- If it goes in a reviewer agent definition, remember those take effect on session reload,
  not on save, and that `docs/solutions/**` frontmatter `tags:` is a routing key — an
  untagged doc never injects.
- The strongest single sentence from the round, if a quote is wanted: a reviewer proved a
  test could still pass after the exact mutation it existed to catch. That is the shape —
  green is not evidence until you have seen it go red for the right reason.
- Worth weighing against `feedback_calibrate_process_weight_to_task_size` (auto-memory): the
  user has twice corrected an over-heavy process. The minimal viable version is probably one
  line in `code-reviewer.md` plus one in `security-auditor.md`.

## Scope Contract

- **Mechanisms to use:** existing agent-definition files, the existing Review Policy
  section, and at most one new or extended `docs/solutions/` file — no new skill, no new
  hook, no new checklist mechanism
- **Files in scope:** `.claude/agents/code-reviewer.md`, `.claude/agents/security-auditor.md`,
  `docs/AI_WORKFLOW.md`, `docs/solutions/conventions/`, `todos/TEMPLATE.md` — whichever
  subset the decision selects
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. All the source PRs (#831–#847) are merged or open-and-reviewed.

## Risks

- **Process weight.** This is a methodology rule, and methodology rules are cheap to write
  and expensive to live with. The "nothing" option is genuinely on the table.
- **Restating an existing doc.** Three adjacent docs already exist
  (`gate-test-needs-two-sided-negative-control`, `lookalike-test-of-a-reimplemented-predicate-guards-nothing`,
  `a-stated-invariant-is-not-an-enforced-one`). A fourth that overlaps them dilutes
  retrieval rather than improving it — the injection budget is finite and date-ranked.

## Updates

### 2026-08-16

- Filed at the user's request after the #833–#847 review round, to hold the idea for a
  human-led expansion. The evidence table is the deliverable; the decision is not made.

### 2026-08-31 — decision made, todo closed

**The human decision (AC1).** The rule lands on **exactly one** reviewer-facing surface:
the `#### Dispatch prompt (per selected reviewer)` block in `docs/AI_WORKFLOW.md`. The
rationale is preserved in one new solution doc,
`docs/solutions/conventions/a-reviewers-own-probe-is-a-test-and-inherits-its-rules-2026-08-31.md`.
Nothing else changes.

Why the dispatch prompt and nothing else: it is the only text that reaches all five
standalone reviewers in a single write (there is no shared or included agent file), and the
Review Policy's own opening paragraph routes **generic-skill** review steps — superpowers'
`subagent-driven-development` task-reviewer and `requesting-code-review` — through the same
policy, so the rule reaches those dispatches too.

**Not these, because:**

- **`.claude/agents/code-reviewer.md` + `security-auditor.md`** (the todo's own guessed
  "minimal viable version") — writing one rule into two files is exactly the dual-write
  drift banned by this file's `#### Self-improving` paragraph and restated at
  `.claude/skills/codify/SKILL.md:164` ("a review rule lands in exactly ONE owning reviewer
  file"). Both already carry narrower versions — `code-reviewer.md:204` requires the command
  behind an _enumeration_ claim, `security-auditor.md:357` says "run it — do not guess" for
  command-safety gates — and a line appended to an 88 KB / 42 KB checklist has far less
  reach than three sentences every reviewer reads on every dispatch.
- **`docs/rules/harness.md`** — `:25` already occupies the two-sided-control slot, and the
  file is injected WHOLE before every in-domain edit, so ~1.9 KB of a shared 6500 B budget
  is an ongoing per-edit cost rather than a one-off. The reachability nuance is worth
  recording accurately: rules files are not _auto-injected_ into read-only reviewers
  (`inject-patterns.sh` fires on Edit/Write/MultiEdit only), but that alone is not
  disqualifying — the established workaround is an explicit pointer in the agent
  definition, and all five reviewers already carry one for `docs/rules/lsp.md`. That
  workaround is what makes this option _worse_: reaching the reviewers from `harness.md`
  means adding the same pointer line to five agent files, which is the dual-write drift
  above.
- **`/codify`** — no step verifies a finding against the code at all, so there is nothing to
  hang a repro requirement on; and making it a required frontmatter key would fail CI for
  all 823 existing docs, since `scripts/check-solution-frontmatter.js` runs whole-corpus.
- **`/audit`** — already requires per-fix verification and forbids marking `verified`
  without running tests. Its gap is discovery-time evidence, which is not worth an edit to a
  52 KB skill on this todo's budget.
- **`todos/TEMPLATE.md`** — mechanically cheap (nothing parses it), but a provenance field
  that nothing enforces is precisely the shape
  `conventions/a-stated-invariant-is-not-an-enforced-one-2026-08-06.md` warns about.

**AC2 correction.** The AC asserted that half (b) — controls on the reviewer's own probe —
"is the one nothing currently covers." That was true when filed and is no longer:
`code-quality/harness-that-never-bound-its-config-reads-as-a-verdict-2026-08-15.md` covers a
probe that never bound its config and still emitted verdicts, and
`logic-errors/an-uncontrolled-ambient-input-makes-the-check-agree-with-what-it-checks-2026-08-31.md`
covers the ambient-input face. Half (a) had prior art too —
`logic-errors/section-header-regex-must-be-whole-line-anchored-2026-08-16.md:120` states
"Construct the failing input and run it" almost verbatim, but inside a single regex
write-up whose `applies_to` makes it unroutable for general review work. The new doc is
therefore written as the **synthesis** with a `## See Also` that cross-references all four
rather than restating them, satisfying AC3.

**AC5.** Closed with zero follow-up todos.
