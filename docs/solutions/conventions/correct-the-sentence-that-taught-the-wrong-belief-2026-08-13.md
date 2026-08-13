---
title: When a doc misleads, correct or bound the misleading sentence in place — not just add the gap
track: knowledge
category: conventions
module: shared
tags: [harness, tooling, documentation, skills, debugging, verification]
applies_to: [.claude/skills/**, docs/rules/**, docs/solutions/**]
created: '2026-08-13'
---

# When a doc misleads, correct or bound the misleading sentence in place — not just add the gap

## Rule

When documentation misled someone, do not stop at adding the missing section. Find the **existing
sentence that made the wrong belief reasonable**, and either correct it or bound its scope — **in
place, adjacent to the claim itself**. An appendix the reader may never scroll to does not undo an
instruction sitting on the path they actually walk.

The test is co-location, not deletion. Bounding a locally-true line with an immediately-following
caveat satisfies this rule; relegating the same caveat to a section 60 lines away does not.

Add the troubleshooting section too — but as the complement, never as the substitute.

## Smell patterns

- A postmortem concludes "the docs didn't cover X" — yet a reader following those docs would have
  formed a specific *wrong belief*, not merely lacked information.
- The proposed fix lands **away from the claim it corrects** — a new `## Troubleshooting` section, a
  new doc, a warning box at the bottom — while the misleading sentence itself is untouched context
  in the diff. (Do not use "zero deletions" as the tell: the right fix is often an insertion
  _immediately after_ the offending line, which deletes nothing. Ask where the correction sits
  relative to the claim, not how many lines went red.)
- The offending line is *locally true*. It is advice that works in the common case and quietly
  generalizes into a case where it is wrong.
- The correction ends up in a *different section* from the text it corrects, so a reader can finish
  the procedure without ever meeting it. (Merely coming *after* is fine and usually right — an
  immediately-following caveat is read as part of the same instruction. Distance is the problem,
  not order.)

## Why

Missing information and wrong information tend to fail differently. A gap usually leaves a reader
uncertain, and uncertainty prompts them to check. A near-miss instruction more often leaves them
**confident and wrong**, and that confidence suppresses the very check that would have caught it.
(A heuristic, not a law — the operative test is in Exceptions: can you name the false belief the
existing text produces?)

So the most expensive documentation defect is rarely the absent paragraph. It is the true-but-
overgeneralizing one, because it manufactures the belief that closes the investigation early.

A purely additive fix also leaves the contradiction standing. The reader meets the misleading line
in the procedure and the correction in an appendix, and the earlier text wins on position.

## Examples

`.claude/skills/verify-ui/SKILL.md` told readers, in its capture step:

> - `mcp__XcodeBuildMCP__snapshot_ui` — read the accessibility tree (it returns elementRef
>   targets). If the first snapshot comes back empty, call it once more — a cold first call can
>   return nothing (same warm-up quirk as the LSP server).

Locally true: cold calls really do return empty. But it establishes the inference *populated ⇒
trustworthy*, which is exactly the belief that cost about an hour on 2026-07-27. A torn-down React
Native surface left an accessibility tree that was **populated and stale**; taps against it appeared
to succeed (`screenHash` even changed), and the truthful screenshot was disbelieved for far too
long. See [frozen simulator](../best-practices/frozen-simulator-is-a-torn-down-rn-surface-2026-08-13.md).

The fix kept the cold-call advice (still correct) and bounded it in the same step:

> **The screenshot is ground truth; the a11y tree is a cache that can outlive the screen.** A
> snapshot coming back _populated_ does not make it trustworthy — after a surface teardown it keeps
> serving the last screen that rendered… When the two disagree, believe the screenshot.

A `## Troubleshooting` section was added as well. On its own it would have left the misleading
inference intact in the procedure, where a reader hits it first.

## Exceptions

- **Genuine gaps are genuinely additive.** If a reader would have been merely uninformed rather than
  actively misdirected, adding the missing material is the whole fix. The test is whether you can
  name the false belief the existing text produces.
- **Do not delete a locally-true line** just because it can be over-read. Bound its scope; removing
  it trades one wrong belief for another.
- **Watch the reachability layer too.** Correcting the sentence helps whoever reads the file;
  it does nothing for retrieval. If the lesson also needs to surface by injection or search, that is
  a separate change with its own routing requirements — see
  [tags and applies_to](tags-and-applies-to-are-a-two-part-routing-precondition-2026-08-06.md).

## Related Files

- `.claude/skills/verify-ui/SKILL.md` — the corrected capture step and the added Troubleshooting
  section, side by side

## See Also

- [A binding rule must prescribe its source solution's ACTUAL remedy](binding-rule-remedy-must-match-its-cited-solution-2026-08-06.md)
  — the sibling failure: a correction that is present but compressed into something different
- [A frozen iOS Simulator is usually a torn-down RN surface](../best-practices/frozen-simulator-is-a-torn-down-rn-surface-2026-08-13.md)
  — the incident this rule came out of
