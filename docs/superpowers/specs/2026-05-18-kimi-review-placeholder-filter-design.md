# Design: kimi-review placeholder-line filter

**Date:** 2026-05-18
**Status:** Implemented (2026-05-18)
**Topic:** Stop `kimi-review` from emitting empty-tier placeholder lines that phantom-block commits

## Problem

The Claude-Code pre-commit gate (`.claude/hooks/kimi-review.sh`) blocks a commit
when `kimi-review`'s output contains a CRITICAL finding. It has phantom-blocked
clean commits three times — each prior fix patched the hook's regex against a
guess about the tool's clean-output wording.

The root cause is upstream of the hook. `kimi-review`'s system prompt tells the
review model to "omit any tier that has no findings," but the model (DeepSeek V4
Flash) does not reliably obey. On a clean review it often emits a bracketed
placeholder per tier:

```
[CRITICAL] No critical issues found.
[WARNING] No warning-level issues found.
```

`kimi-review`'s output filter treats _any_ `[TIER]`-prefixed line as a finding,
so it prints these placeholders verbatim. The hook then sees a `[CRITICAL]` line
and blocks. Fixing only the hook leaves the tool emitting misleading output to
every other consumer (`kimi-multi-review`, manual runs) and lets the next
hook-regex guess collide with the next clean phrasing the model invents.

## Goal

`kimi-review` must distinguish a **real finding** from an **empty-tier
placeholder** and never print a placeholder. A clean review prints only the
existing `No findings in requested tiers: …` message. The hook is independently
hardened as a defense-in-depth backstop.

## Approaches considered

- **Shape-validated filter (chosen).** The tool's filter classifies a bracketed
  line as a real finding only if it references a file location; placeholders are
  dropped. Smallest change; fixes the defect at its source; output contract and
  exit codes unchanged.
- **Machine-readable verdict (rejected).** Have the tool signal the highest
  real-finding tier via exit code so the hook stops parsing stdout. Cleanest in
  theory but changes the tool's contract for every consumer. Out of scope.
- **Prompt hardening only (rejected).** Strengthening "omit empty tiers" cannot
  fix this — the defect _is_ the model disobeying that instruction.

## Design

### Component 1 — Tool: `~/.local/bin/kimi-review`

**1a. Extract a pure `filter_review` function.** The current inline filter loop
(after the API response) becomes a module-level function. A bracketed `[TIER]`
line counts as a real finding only if its body references a file — contains a
`/`, a `:<digits>` line number, or a `.<ext>`. A bracketed line referencing no
file is a placeholder: it is dropped and does not count as a finding. When no
real finding survives, the existing clean message prints.

```python
import re

# A real finding cites a file location, per the mandated format
# `[TIER] path/to/file.ts:42 — description`. A bracketed line that cites no file
# ("[CRITICAL] No critical issues found.") is the model decorating an empty tier
# against instructions — a placeholder. We err toward keeping anything file-like:
# dropping a real finding here is unrecoverable, whereas a stray placeholder that
# slips through is caught by the hook's stricter [CRITICAL]+:line gate.
_FILE_REF_RE = re.compile(r"/|:\d|\.\w{1,6}\b")


def filter_review(answer, requested_tiers):
    """Return the review text to print: allowed-tier findings, else the clean message."""
    allowed_tiers = {t.upper() for t in requested_tiers}
    filtered_lines = []
    keep_current_finding = False
    saw_finding = False
    for line in answer.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("[") and "]" in stripped:
            tier = stripped[1:stripped.index("]")].strip().upper()
            body = stripped[stripped.index("]") + 1:]
            is_finding = bool(_FILE_REF_RE.search(body))
            saw_finding = True
            keep_current_finding = is_finding and tier in allowed_tiers
            if keep_current_finding:
                filtered_lines.append(line)
        elif keep_current_finding or not saw_finding:
            filtered_lines.append(line)
    filtered = "\n".join(filtered_lines).strip()
    return filtered or f"No findings in requested tiers: {', '.join(requested_tiers)}"
```

The call site collapses to:

```python
answer = resp.choices[0].message.content
if answer:
    print(filter_review(answer, requested_tiers))
else:
    print("[ERROR: ran out of tokens — raise --max-tokens]", file=sys.stderr)
    sys.exit(1)
```

**1b. Make the module importable.** Wrap the script's executable body — from
`p = argparse.ArgumentParser(...)` through the trailing usage-stats print — in a
`def main():`, and add `if __name__ == "__main__": main()`. Module-level after
the refactor: imports, the offline `OpenAI(...)` client object, `TIER_DEFINITIONS`,
`PROJECT_PROFILES`, `_FILE_REF_RE`, and `filter_review`. Everything else — the
argument parser, the git-diff and profile logic, and `resolve_pattern_path`
(currently defined mid-flow) — moves inside `main()`; `resolve_pattern_path` is
only called from there, so nesting it is fine. This lets the test import the
module without parsing argv or calling the API.

**Why the broad file-reference test (not just `:line`):** the tool _drops_
non-findings, and a drop is unrecoverable. Matching `/`, `:digit`, or `.ext`
keeps a real finding even if the model formats it without a line number. A
placeholder ("No critical issues found.") references no file and is dropped. A
rare false positive (e.g. a placeholder containing "i.e.") would survive into
stdout but is harmless — the hook's `[CRITICAL]+:line` gate does not block it.

### Component 2 — Tool test: new `~/.local/bin/test-kimi-review.py`

Loads `kimi-review` via `importlib.util` and calls `filter_review` directly
(no API key, no network). Covers:

1. Placeholder lines only → returns the clean message.
2. A real `[CRITICAL]` finding (`path:line`) → kept.
3. A finding in a tier not in `requested_tiers` → dropped.
4. Placeholder + real finding mixed → only the real finding kept.
5. A real finding plus its indented `Detail:` continuation line → both kept.
6. A placeholder plus a following continuation line → both dropped.
7. A real finding whose description contains the words "no findings" → kept.
8. A finding citing a bare filename with no line number (`schema.ts`) → kept.

### Component 3 — Hook hardening: `.claude/hooks/kimi-review.sh` + `test-kimi-review.sh`

Defense-in-depth so a future tool regression that leaks a placeholder still
cannot phantom-block.

- Replace the word/exclude-grep pair with the shape match
  `grep -E '[[]CRITICAL[]][^:]*:[0-9]'` — a `[CRITICAL]` tag followed on the
  same line by a `:<line-number>`. Placeholders have no `:line` and cannot match.
- Rewrite the step-8 rationale comment to describe the shape match and the
  deliberate fail-open trade-off (a malformed real finding with no line number
  does not block but still surfaces in `additionalContext`).
- Add a `clean-model-prose` stub to `test-kimi-review.sh` emitting
  `[CRITICAL] No critical issues found.` / `[WARNING] No warning-level issues
found.`, with assertions that it does not block and does emit
  `additionalContext`.

### Component 4 — Solution doc

Update `docs/solutions/logic-errors/tier-detection-matched-clean-output-message-2026-05-15.md`:
correct the root cause (detection keyed on clean-output phrasing, not finding
shape) and record the tool-layer filter as the architectural resolution, with
the hook shape-match as the backstop.

## Data flow

```
review model output
  → filter_review()        drops empty-tier placeholder lines
  → kimi-review stdout     real findings, OR the clean message — never a placeholder
  → hook greps stdout      [CRITICAL] + :line shape match
  → block / allow
```

## Error handling

`filter_review` is pure and total — no exceptions, no I/O. An empty/None model
response is still handled by the existing token-error branch. Tool-test and
hook-test failures surface via each script's non-zero exit code.

## Testing

- `python3 ~/.local/bin/test-kimi-review.py` — `filter_review` unit cases.
- `bash .claude/hooks/test-kimi-review.sh` — hook end-to-end, including the new
  `clean-model-prose` regression.

## Out of scope / follow-up

`~/.local/bin/kimi-review` (and `kimi-challenge`, `kimi-multi-review`, and the
new tool test) are bespoke local scripts, not tracked in the `claude-coworker`
git repo (which versions only `ask-kimi`, `kimi-write`, `extract-chat`). Moving
the `kimi-*` tools into that repo's `tools/` for version control is recommended
but is a separate change.
