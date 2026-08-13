---
title: When a doc misleads, fix the sentence that made the wrong belief reasonable — not just the gap
track: knowledge
category: conventions
module: shared
tags: [harness, tooling, documentation, skills, debugging, verification]
applies_to: [.claude/skills/**, docs/rules/**, docs/solutions/**]
created: '2026-08-13'
---

# When a doc misleads, fix the sentence that made the wrong belief reasonable — not just the gap

## Rule

When documentation misled someone, do not stop at adding the missing section. Find the **existing
sentence that made the wrong belief reasonable**, and correct it where it lives. An appendix the
reader may never scroll to does not undo an instruction sitting on the path they actually walk.

Add the troubleshooting section too — but as the complement, never as the substitute.

## Smell patterns

- A postmortem concludes "the docs didn't cover X" — yet a reader following those docs would have
  formed a specific *wrong belief*, not merely lacked information.
- The proposed fix is entirely additive: a new `## Troubleshooting` section, a new doc, a new
  warning box — **zero deletions in the diff**.
- The offending line is *locally true*. It is advice that works in the common case and quietly
  generalizes into a case where it is wrong.
- The correction ends up positioned *after* the text it corrects, so a reader meets the misleading
  version first.

## Why

Missing information and wrong information fail differently. A gap leaves a reader uncertain, and
uncertainty prompts them to check. A near-miss instruction leaves them **confident and wrong**, and
that confidence suppresses the very check that would have caught it.

So the most expensive documentation defect is rarely the absent paragraph. It is the true-but-
overgeneralizing one, because it manufactures the belief that closes the investigation early.

A purely additive fix also leaves the contradiction standing. The reader meets the misleading line
in the procedure and the correction in an appendix, and the earlier text wins on position.

## Examples

`.claude/skills/verify-ui/SKILL.md` told readers, in its capture step:

> `snapshot_ui` — read the accessibility tree. If the first snapshot comes back **empty**, call it
> once more — a cold first call can return nothing.

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
