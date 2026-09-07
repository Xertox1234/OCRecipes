---
title: "DECISION: which adversary is guard-outward-cli.sh defending against? The answer determines whether the span layer is worth its defect rate"
status: backlog
priority: high
created: 2026-09-07
updated: 2026-09-07
assignee:
labels: [security, harness, decision]
github_issue:
human_led: true
blocked_reason: "This is a threat-model ruling, not a spec. An unattended run would pick whichever option is cheapest to implement and write it up as a settled decision for a security guard — the exact failure the /todo policy exists to prevent. The evidence is assembled below; the choice is the owner's."
---

# Which adversary is this guard defending against?

## Why this exists

Seven P0s have been filed against `guard-outward-cli.sh` / `lib/cmd-detect.sh` since
2026-09-02, plus two more found on 2026-09-07. Before that date this project had filed **zero
P0s in its entire history** (282 archived todos). All nine are the same class — _a shell
construct splits a token, so the guard does not see the invocation_ — and all nine are in the
same file pair. None is in app code.

The owner asked why the count is climbing. The answer is not that the guard is degrading; every
one of the nine allows on `main` too. It is that adversarial review of a text-matching guard
against shell grammar has an unbounded input space, and **round 11 has now shown the space is
combinatorial, not linear**: the two newest findings are _compositions_ of mechanisms already
fixed individually.

This todo assembles the measured evidence and puts the ruling to the owner. **No option below
is implemented; nothing here is a recommendation dressed as a finding.**

## Measured evidence

All figures produced by execution against this project's own transcripts and hooks, 2026-09-07.

### 1. The originating incident involved no obfuscation whatsoever

`project_ota_accidental_publish_2026_08_16`: a code-review subagent named its PATH stub
`fake-eas` instead of `eas`; resolution fell through to the **real** CLI and published a real
OTA to `preview`. The command was a plain `eas update`. **A naming slip, not an evasion.**

### 2. The span layer has never fired on a real command in this project's history

`cmd_words_vanished` exists to reconstruct a gated needle that the raw text does not contain —
which is precisely what all nine findings are about. Measured over every unique Bash command in
this project's transcripts:

|                                                                         |       |
| ----------------------------------------------------------------------- | ----- |
| unique commands in history                                              | 3,883 |
| carrying any `$` sigil (the only ones that could matter)                | 1,555 |
| **where the rendering synthesised a gated needle absent from raw text** | **0** |

Zero. In 1,555 opportunities the layer that generates every one of these P0s has never once
changed what the guard could see on a real command.

### 3. The plain-text layer, by contrast, is exercised constantly

990 of 3,883 unique commands (25.5%) name a gated CLI. That is the layer that catches the
incident class this guard was built for, and no finding in the last five days touches it.

### 4. The guard's own charter already concedes the span layer cannot be complete

`guard-outward-cli.sh`'s header: _"guardrail, not a sandbox — a determined bypass is always
possible; that is what the `SKIP\__` env bypasses are for."\*

## Three adversaries, and they need different things

The nine findings do not all belong to one attacker. Separating them is what makes the ruling
tractable.

**A. The agent misfires.** The actual 2026-08-16 incident. Commands are plain; the binary name
is intact. **Fully covered by the plain-text layer.** The span layer contributes nothing here,
because an accident does not construct `e$( (:) )as update`.

**B. A prompt-injected agent deliberately evades.** Can compose obfuscations without bound —
which finding #9 demonstrates concretely, by composing two mechanisms that were each closed.
**The span layer cannot win this**, and the header says so. Every P0 except the interior
redirect lives here.

**C. The agent writes ordinary shell that happens to defeat the anchors.** The middle case, and
the one that has been mis-filed. `eas 2>&1 update --branch preview` and
`gh pr >/dev/null merge 42` are real invocations that ALLOW today, and they carry **no evasion
intent at all** — a person or an agent types them without thinking. Measured 2026-09-07; see
`todos/P0-2026-09-06-outward-cli-guard-interior-redirect-defeats-every-family.md`.

**This taxonomy explains the whole backlog.** One open P0 (interior redirect) is model C and is
genuinely worth fixing. The other two, and five of the seven closed ones, are model B.

## Options

Each is stated with what it actually closes, not with what it feels like.

### 1. Status quo — keep enumerating spellings at P0

Closes: whichever model-B spellings get found next. Cost: the queue regenerates, now
combinatorially. The corpus generates one mechanism per row, so it cannot see compositions at
all without a product axis (~900 rows for pairs alone, at 10 mechanisms × 7 families × 3
positions — and pairs are not the end).

### 2. Split the backlog by model; fix C, document B

Fix the interior redirect (model C, reachable without intent). Move model-B mechanisms to
DOCUMENTED RESIDUALS with their corpus rows retained, so they stay measured every run without
occupying a critical queue. Closes the reachable-by-accident class; explicitly declines the
adversarial one, which the header already declines in prose.

### 3. Structural — take the outward CLIs off the agent's PATH

Attacks the incident's actual root cause: resolution fell through to a real binary. A wrapper
directory earlier in `PATH` that refuses unless an env token is set closes **A, B and C at
once**, including spellings nobody has found, because it does not depend on reading the command
text. Cost: needs a sanctioned escape hatch for real releases, and it changes the operator
workflow rather than the agent's.

### 4. Structural — resolve the command word instead of pattern-matching it

Have the guard ask the shell what the command word resolves to, rather than inferring it from
text. Closes the entire class by construction. **Explicitly ruled out before** —
`cmd_extract_substitutions`' header records that letting bash begin evaluating an untrusted
string is itself the vulnerability, and that bare redirection still damages files with `PATH`
emptied. Listed only so the ruling does not have to rediscover why it is closed.

## What a ruling should say

1. Which adversary models this guard is accountable for (A only, A+C, or A+B+C).
2. Whether a newly-found model-B spelling may be filed as P0 in future, or must be a
   documented residual.
3. Whether option 3 is worth prototyping, given it is the only one that closes what has not
   been found yet.

## Related

- `todos/P0-2026-09-06-outward-cli-guard-interior-redirect-defeats-every-family.md` — model C,
  and the re-measurement that reclassified it.
- `todos/P0-2026-09-06-outward-cli-guard-brace-range-splits-token-with-no-sigil.md`,
  `todos/P0-2026-09-06-cmd-detect-case-arm-paren-closes-substitution-early.md` — model B.
- `todos/archive/P0-2026-09-06-cmd-detect-bare-paren-subshell-breaks-substitution-scanners.md`
  — the change whose review produced findings 8 and 9.
- `todos/P2-2026-08-16-outward-cli-pretooluse-deny-hook.md` — where option 3 was first raised
  and left awaiting a call.

## Findings 8 and 9, recorded here rather than filed as P0s

Both are pre-existing on `main` (verified: ALLOW on `main` and on the fix branch, with
isolation controls DENYing), both are model B, and both are **compositions** of already-closed
mechanisms. They are recorded here so the ruling has the concrete cases in front of it.

**8 — composed bare-paren + comment.** Defeats both halves of the union that was built to fix
each mechanism separately:

```
e$( (: # (
) )as update --branch preview
```

The counting pass counts the subshell `(` and the comment `(`, so the level never closes and it
renders empty; the blind pass closes at the subshell's `)`, so the verb never re-forms. Live
invocation (PATH-stubbed ground truth). Each mechanism alone now DENIES.

**9 — deep ∘ vanished.** A verb both hidden inside a live substitution and split by a vanishing
sigil is visible in no rendering:

```
echo $(e${UNSET}as update --branch preview)     ALLOW
e${UNSET}as update --branch preview             DENY
echo $(eas update --branch preview)             DENY
```

`cmd_words_deep` appends the body but keeps `${UNSET}` intact; the vanishing renderings delete
the whole substitution. The structural fix would be a `deep ∘ vanished` rendering — which is a
third rendering, and finding 8 is the evidence that a third one should not be assumed complete
either.
