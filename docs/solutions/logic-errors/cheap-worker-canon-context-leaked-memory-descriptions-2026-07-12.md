---
title: A "canon-aware dedup context" file built for a cheap-worker LLM silently forwarded raw memory-file descriptions off-machine
track: bug
category: logic-errors
module: scripts
severity: critical
tags: [security, cheap-worker, pg-lab, distillation, credential-leak, memory-files, ask-kimi]
symptoms: [A helper function meant to reduce duplicate LLM suggestions projects BOTH a curated public corpus and a private local corpus into one file, That combined file is passed as a --paths argument to an external cheap-worker CLI (ask-kimi), Nothing in the code path distinguishes "safe to send" content from "local-only" content once they're concatenated, A memory file's frontmatter description field contains a literal credential or other sensitive string verbatim]
applies_to: [scripts/pg-lab/distill.sh]
created: '2026-07-12'
---

# A "canon-aware dedup context" file built for a cheap-worker LLM silently forwarded raw memory-file descriptions off-machine

## Problem

`scripts/pg-lab/distill.sh`'s `build_canon_context()` was meant to reduce duplicate
candidate suggestions from the distillation LLM by showing it what's already known. It
projected two sources into one file: `harness.solution_titles` (curated, git-tracked,
public `docs/solutions` titles) and the output of `build_memory_titles()` (every
`~/.claude/.../memory/*.md` file's `name`/`description` frontmatter, read verbatim). That
combined file was then passed as a second `--paths` argument to `$DISTILL_SEND_CMD`
(default `ask-kimi`, an external OpenRouter/DeepSeek call) alongside the session transcript
being distilled — i.e., off-machine.

Memory-file descriptions are not curated for external sharing the way `docs/solutions`
titles are. One live memory file's frontmatter read `description: "User's testing account
for the iOS simulator is demo/demo123"` — that literal credential string shipped externally
on every distillation run, in the documented and supported first-run state (`build_canon_context`
explicitly degrades to memory-titles-only when `harness.solution_titles` doesn't exist yet —
exactly the state of a fresh `--init-schema` DB). This is a direct violation of CLAUDE.md's
cheap-worker rule: "Never point them at authentication, permissions, input validation,
migrations, security-sensitive logic, or user health data — absolute in both tiers."

## Symptoms

- A helper function combines a public/curated data source and a private/local data source
  into one file before an external send, with no marking of which lines came from which
  source.
- The private source was *already* being read locally for a legitimate same-machine purpose
  (here: a Postgres `word_similarity` near-dup lookup) — the external-send path was added
  later, reusing the same in-memory/on-disk projection without re-scoping what's safe to
  forward.
- The combined file's size cap (character truncation) can, depending on corpus state, leave
  the private-source content as the *only* content sent (the public source rounds to zero
  bytes when its backing table doesn't exist yet).
- A dedicated "artifact health gate" exists in the same pipeline and hashes/redacts the
  primary payload — but the canon-context file is deliberately excluded from that gate (by
  design, to keep the gate's sha256 identity check scoped to the artifact only), so there is
  no redaction backstop for this second file at all.

## Root Cause

The function's docstring described its purpose ("canon-aware dedup") without drawing a
boundary between *safe-to-send* and *local-only* inputs. Both `harness.solution_titles`
(public, git-tracked knowledge) and memory-file frontmatter (private, project-specific,
occasionally containing literal secrets/PII) satisfy "things already known" equally well
from a pure dedup standpoint, so nothing in the implementation flagged that only one of the
two sources should ever leave the machine. The bug is a scoping error, not a redaction bug:
there was no PII/secret scrubber to fail — the design simply had no concept of "external
send" as a boundary that memory-file content must never cross.

## Solution

Split "used for local dedup" from "safe to send externally." Memory titles are still
projected and still power the local `word_similarity` near-dup lookup (pure Postgres,
never leaves the DB) — but they are excluded entirely from what `build_canon_context()`
writes to the file that gets passed to `$DISTILL_SEND_CMD`:

```bash
# Deliberately does NOT include memory-file titles/descriptions: unlike docs/solutions
# (curated, git-tracked, meant to be public), memory-file `description:` frontmatter can
# carry sensitive content verbatim — CLAUDE.md's cheap-worker rule forbids pointing
# ask-kimi at security-sensitive content, absolute regardless of tier. Memory titles stay
# LOCAL: still projected by build_memory_titles() and used only in insert_candidate()'s
# word_similarity dedup query, which runs entirely inside psql and never leaves the DB.
build_canon_context() {
  # ... only harness.solution_titles is ever written to $out ...
}
```

Regression test (`.claude/hooks/test-pg-lab-distill.sh`): stub `$DISTILL_SEND_CMD` to
capture every file path it actually receives, seed a memory fixture with a distinctive
description string, run `--window` with `DISTILL_MEMORY_DIR` pointed at the fixture, then
assert the captured content does NOT contain the memory description (and still DOES contain
the solutions-corpus content, proving the fix didn't just delete the whole feature).
Mutation-verified: reverting the fix reproduces the leak and fails the new assertion.

## Prevention

- Before adding an "external send" call to any code path, audit every input that feeds the
  payload back to its origin, and classify each source as public/curated vs.
  private/local — not just "is this useful context."
- A function that already reads a private data source for one legitimate local purpose is
  the highest-risk place to accidentally widen that source's exposure when a new feature
  (here: external-send dedup context) is bolted on next to it — the temptation is to reuse
  the existing projection rather than re-deriving a narrower one.
- A payload-health/redaction gate that is deliberately scoped to one artifact (by design, to
  keep its identity-hash check simple) provides ZERO protection for any sibling file sent
  alongside that artifact — treat every file passed to an external command as needing its
  own scoping review, not just the one the gate covers.
- For cheap-worker (`ask-kimi`/`kimi-*`) call sites specifically: grep the call site's full
  argument list (every `--paths`/similar flag) and trace each file back to its build
  function, not just the primary payload — CLAUDE.md's absolute exclusions apply to
  everything reaching the external process, not only the main artifact.

## Related Files

- `scripts/pg-lab/distill.sh` — `build_canon_context()` (external-safe projection),
  `build_memory_titles()` (local-only projection, still used by `insert_candidate()`)
- `.claude/hooks/test-pg-lab-distill.sh` — capture-stub regression test proving memory
  content never reaches the external-worker stand-in

## See Also

- [argparse nargs="+" repeated-flag overwrites, not appends](argparse-nargs-plus-repeated-flag-overwrites-not-appends-2026-07-12.md) — same `send_session()` call site, a different `ask-kimi` argument-passing gotcha found in the same PR
