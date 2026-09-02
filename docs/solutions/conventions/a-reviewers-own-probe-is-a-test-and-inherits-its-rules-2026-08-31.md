---
title: "A reviewer's own probe is a test and inherits every rule tests have — construct the failing input, run it, and control the instrument"
track: knowledge
category: conventions
tags: [harness, testing, agents, code-review, probes, evidence, negative-control]
module: shared
applies_to: [.claude/agents/*.md, .claude/hooks/*.sh, .claude/skills/*/SKILL.md]
created: '2026-08-31'
last_updated: '2026-09-01'
---

# A reviewer's own probe is a test and inherits every rule tests have

## Rule

Four separate claims. All are about how a **review is conducted**, not about how the code
under review is written. Clauses 3 and 4 were added on 2026-09-01 after each was violated —
in the same session, by the author of clauses 1 and 2.

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

3. **A probe runs in an environment, and inherits that environment's rules too.** Before
   trusting a probe, name the interpreter/runtime it actually ran under and assert it in the
   probe's own output. A probe that silently runs somewhere other than production does not
   fail — it answers confidently about the wrong system.

4. **A probe's verdict is bounded by its INPUTS, and a hand-listed corpus is a copy of your
   own blind spot.** Generate the corpus combinatorially from its dimensions rather than
   listing the cases you already suspect, and report any count together with the corpus that
   produced it — "9 regressions" reads as a property of the change when it is a property of
   the inputs.

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

## Clause 3 in practice: the probe ran in a different shell than the code (2026-09-01)

While fixing a bash PreToolUse hook, a harness replicating the hook's argument loop reported
**every** case as correct — including cases that were, in fact, broken. The negative controls
were the only thing that exposed it: three cases that *must* have returned 1 also returned 0,
and "everything returns 0" is not a result, it is a broken instrument.

Cause: the interactive Bash tool in this environment executes **zsh**, while the hooks run
under **bash**. zsh does not word-split unquoted parameter expansions, so

```bash
SEGMENT="checkout -b foo origin/main"
set -- $SEGMENT     # bash: 4 args.  zsh: 1 arg.
```

collapsed the loop to a single iteration and every path fell through to the default. The
subject was fine; the instrument was measuring a different language.

What makes this worth its own clause rather than a footnote: **the rule already existed and
had already been delivered.** `docs/rules/harness.md` states "Scripts run under `bash`, not
the interactive zsh you paste into: zsh does not word-split unquoted expansions", and the
pattern-injection hook had put that file in context earlier in the same session. It did not
fire, because it reads as a rule about *shipped scripts* — and a throwaway verification
snippet does not feel like a script. That is exactly the gap this document exists to close:
the probe is a test, and it inherits the environment constraints as well as the control
requirements.

The fix is one line, and it belongs in every probe rather than in anyone's memory — an
assertion that fails loudly when the assumption is wrong:

```bash
_probe_seg="a b c"                       # PARAMETER EXPANSION, not $( ) — see below
set -f; set -- $_probe_seg; set +f
[ "$#" = 3 ] || { echo "FATAL: probe is not running under bash ($# != 3)"; exit 2; }
```

**The first version of this snippet was itself non-discriminating, which is worth keeping as
the sharpest example in this document.** It read `set -- $(printf 'a b c')` — command
substitution. zsh word-splits unquoted **command substitution**; what it does *not* split is
unquoted **parameter expansion**, and parameter expansion is what the real harness used
(`set -- $SEGMENT`). Measured, one file run under both shells:

| form                       | bash | zsh |
| -------------------------- | ---- | --- |
| `set -- $(printf 'a b c')` | 3    | 3   |
| `set -- $SEG`              | 4    | 1   |

So the published assertion returned 3 everywhere and could never fail — a self-test with no
failure mode, guarding against a bug it could not see, inside the document that warns about
exactly that. It survived because it *looked* like a control. Two rules fall out: a
self-test must exercise **the same construct the probe depends on**, not a near neighbour;
and it must be checked the only way any control can be — by running it in the failing
condition and confirming it goes red. Caught by review, not by the author.

Generalised: if the subject runs under a specific interpreter, container, node version, shell,
or database, the probe must **assert** it rather than assume it — and the assertion belongs in
the probe's visible output, so a wrong environment is impossible to read as a clean result.

## Clause 4: a differential's number is a property of its CORPUS, not of the change (2026-09-01)

The strongest instrument in this document is the differential — replay one corpus through the
pre- and post-change implementation and assert no verdict regressed. It found 9 real
deny→allow regressions where a 833-assertion suite found none, and it is the right first
artefact whenever a matcher's grammar changes.

It then reported **0 regressions** on the repair — and was wrong. A reviewer's combinatorial
corpus found **240**. The harness was sound: two-sided, self-tested, correctly comparing.
Every command in *my* corpus kept the redirect inside a single clause, because I wrote the
corpus by listing the cases I had already thought of — so it was a faithful copy of my own
blind spot, and it returned the reassuring answer with full machinery behind it.

**A differential inherits the coverage of its inputs and nothing more.** A hand-listed corpus
tests the hypotheses the author already holds; that is the one thing a regression check must
not do. So:

- **Generate the corpus combinatorially** — enumerate the dimensions (here: redirect form ×
  separator × verb pair) and take the product. The product contains the cases you would not
  have listed, which is the entire point.
- **Name the dimension that can mask the bug.** Here it was the *verb pair*: a
  `checkout`-then-`checkout` pair still finds a create flag by accident and passes, so only
  the mismatched pairs (`checkout` then `switch`) expose the clause merge. A corpus that
  varies only the interesting-looking axis will miss it.
- **Quote the number with its corpus.** "The differential found 9 regressions" reads as a
  property of the change; it is a property of the inputs. Report it as "9 over N inputs
  spanning X and Y" so the next reader can see what was not spanned.

A related failure from the same round, worth stating plainly because it is easy to do while
feeling rigorous: the commit that introduced a reviewer rule *requiring* a differential
shipped the differential as **prose describing itself**, not as a runnable artefact. A
verification that exists only in a commit message cannot be re-run by the next change. Land
the corpus as a test. Where the natural form is "replay against the previous version", note
that after merge the previous version becomes the current one and such a test passes forever
— pin the invariant it was measuring instead.

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

- `docs/AI_WORKFLOW.md` — the Review Policy dispatch prompt carries clauses 1, 2 and 4; it is the
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
