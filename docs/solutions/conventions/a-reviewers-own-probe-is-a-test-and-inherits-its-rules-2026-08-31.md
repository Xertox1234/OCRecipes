---
title: "A reviewer's own probe is a test and inherits every rule tests have — construct the failing input, run it, and control the instrument"
track: knowledge
category: conventions
tags: [harness, testing, agents, code-review, probes, evidence, negative-control]
module: shared
applies_to: [.claude/agents/*.md, .claude/hooks/*.sh, .claude/skills/*/SKILL.md]
created: '2026-08-31'
---

# A reviewer's own probe is a test and inherits every rule tests have

## Rule

Two separate claims. Both are about how a **review is conducted**, not about how the code
under review is written.

1. **Verify a behavioural claim against the artifact — prefer execution wherever execution
   is possible.** For a guard, parser, or predicate, "this input is rejected" / "this form
   slips through" / "this string mis-parses" is settled by constructing that input and
   running it, never by reading the implementation and reasoning about it. Report the
   command and its output; a conclusion without the command behind it is an opinion.

2. **A probe you build to check a claim is itself a test, so it needs controls.** Give it a
   **positive control** — an input that MUST produce the bad verdict, proving the harness
   can see anything at all — and a **negative control** — an input that MUST NOT, proving
   it is not simply failing everything. Without both, a probe that answers "fine" to every
   input is indistinguishable from a clean bill of health.

## When this applies

At review time, for any finding whose truth is a runtime behaviour. It does **not** replace
reading: enumeration and bounding claims, scope-contract violations, and "the doc says X but
the diff does Y" are settled by reading and counting, and reading found all three of those
in the round below. The honest generalisation is *verify the claim against the artifact*,
not "never read."

## Smell patterns

- A finding that describes what the code "will" do, with no command and no output.
- A probe whose every row agrees with the conclusion the reviewer already held.
- A negative result from a harness that was never shown to produce a positive one.
- "Still not fixed" from a scratch script built in the same session as the claim.
- A restricted-PATH or stubbed-binary probe with no assertion that the stub actually resolved.

## Why

Across a 12-PR review round on 2026-08-16, **every CRITICAL came from building the failing
input and executing it.** Two internal review rounds, conducted by reading, had already
passed on most of these PRs and found none of them.

| Finding                                                                    | Found by                                                              |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Trailing `;` disarmed every predicate in the outward-CLI deny gate         | Enumerating bypass strings and piping each to the hook                |
| The repo's own OTA publish script was allowed by that gate                 | Piping the literal command string                                     |
| A line-continuation split bypassed both degraded paths                     | A byte-level fixture checked with `od -c`                             |
| A missing `awk` made the gate allow everything, no crafting needed         | Building a restricted PATH and running it                             |
| `"12,5 millilitres"` parsed as 5, corrupting a self-consistency shield     | Running `main`'s and the branch's parser side by side on a case table |
| A partial-escape SQL mutant passed all 7 assertions of a perimeter test    | Building the mutant and rendering the real SQL                        |
| An IDOR regex over-matched non-function exports                            | Running the branch's script against synthetic fixtures                |
| A new guard rejected a config that parses correctly today                  | Running the parser with the guard removed                             |

The counterweight, so this is not read as an absolute — **reading** caught the scope-contract
violations, a solution doc claiming a regression test that was actually a one-line comment
edit (`git diff --unified=0` against the claim), and an ALLOWLIST count that was 45, not 55.

**Why clause 2 is separate.** While verifying one of those CRITICALs, a reviewer reported
"still not fixed" from a harness whose restricted PATH was missing `grep` as well as the
target binary, and which sourced a stale copy of a shared lib. Both defects pushed toward a
false negative, and neither was visible in the output — the probe printed a confident
verdict either way. The corrected harness showed the fix was fine. The instrument and the
subject failed together, which is exactly the condition under which agreement carries no
information.

## Examples

Controlled, in the shape this rule asks for — the deny is read from the hook's JSON
`permissionDecision`, not from an exit code, because the hook exits 0 in every case:

```bash
run() { printf '%s: ' "$1"                                    # label, or the rows are
        jq -nc --arg c "$2" '{tool_name:"Bash", tool_input:{command:$c}}' \
        | bash .claude/hooks/guard-outward-cli.sh; echo; }     # indistinguishable
run CTRL-benign 'git commit -m "harmless message"'  # MUST allow (negative control)
run CTRL-real   'npm publish'                       # MUST deny  (positive control)
run SUBJECT     "$THE_INPUT_UNDER_TEST"             # the actual question
```

Note this does **not** violate the Exceptions rule below: the outward-facing string is
passed to the hook as JSON *data* and only inspected — no shell ever expands it. Probing a
gate with the command it exists to reject is safe precisely because the gate is the
subject; handing that same string to a shell is not.

Uncontrolled, and worthless: only the third line. It cannot distinguish "the subject is
safe" from "this harness denies nothing."

## Exceptions

**Never construct-and-run a fragment whose exec target is an outward-facing, PATH-resolved
CLI** (`eas`, `railway`, `npm publish`, mutating `gh`, remote `psql`). Reason from the
fragment's text instead. "Read-only" does not constrain Bash, and a probe is one typo from a
production mutation — a mis-named stub published a real OTA during a review on 2026-08-16.
If execution is genuinely required, stub the binary under its EXACT real name, prepend the
stub dir to `PATH`, verify with `command -v <name>` that the stub resolves, and assert a
stub-side sentinel answered. That verification step is the positive control of clause 2
applied to the stub itself.

## Related Files

- `docs/AI_WORKFLOW.md` — the Review Policy dispatch prompt carries both clauses; it is the
  single shared surface every dispatched reviewer reads, roster and generic-skill alike.
- `.claude/agents/code-reviewer.md` — its Read-Only Contract carries the outward-CLI
  prohibition above; its `## Remember` already requires the command behind a *bounding*
  claim, which clause 1 extends to *behavioural* ones.

## See Also

- `conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md` — the same
  two-sidedness required of authored, committed gate **tests**. This doc extends that
  discipline to the reviewer's own throwaway instrument; it does not restate it.
- `code-quality/harness-that-never-bound-its-config-reads-as-a-verdict-2026-08-15.md` — a
  probe that never bound its config still emitted confident verdicts; the canonical
  instance of clause 2.
- `logic-errors/an-uncontrolled-ambient-input-makes-the-check-agree-with-what-it-checks-2026-08-31.md`
  — the ambient-input face of the same failure, and where measurement provenance is argued.
- `logic-errors/section-header-regex-must-be-whole-line-anchored-2026-08-16.md` — the
  original construct-and-run incident, stated there inside a single regex write-up.
- `conventions/never-execute-an-outward-facing-cli-fragment-in-review-2026-08-16.md` — the
  Exceptions carve-out in full.
