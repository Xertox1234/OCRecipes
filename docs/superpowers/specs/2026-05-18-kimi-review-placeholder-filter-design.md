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
and blocks. Fixing only one hook leaves other gates and consumers with the same
misleading output, and lets the next hook-regex guess collide with the next clean
phrasing the model invents.

## Goal

The tracked `scripts/kimi-review.py` is the canonical implementation. The local
`~/.local/bin/kimi-review` helper should either be generated from it or kept in
lockstep with it, but the repo script is the source of truth because CI falls
back to it and reviewers can audit it.

`kimi-review` must distinguish a **real finding** from an **empty-tier
placeholder** and never print a placeholder. A clean review prints only the
existing `No findings in requested tiers: …` message. Every gate that parses
review stdout is independently hardened as a defense-in-depth backstop.

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

### Component 1 — Canonical tool: `scripts/kimi-review.py`

**1a. Extract a pure `filter_review` function.** The current inline filter loop
(after the API response) becomes a module-level function in
`scripts/kimi-review.py`; the local `~/.local/bin/kimi-review` helper receives
the same function after the canonical implementation is updated. A bracketed
`[TIER]` line counts as a real finding only if its body references a file —
contains a `/`, a `:<digits>` line number, or a `.<ext>`. A bracketed line
referencing no file is a placeholder: it is dropped and does not count as a
finding. When no real finding survives, the existing clean message prints.

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
    for line in answer.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("[") and "]" in stripped:
            tier = stripped[1:stripped.index("]")].strip().upper()
            body = stripped[stripped.index("]") + 1:]
            is_finding = bool(_FILE_REF_RE.search(body))
            keep_current_finding = is_finding and tier in allowed_tiers
            if keep_current_finding:
                filtered_lines.append(line)
        elif keep_current_finding:
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

**1b. Make the module importable without optional dependencies.** Keep the
canonical script's executable body under `main()`, and import `OpenAI` plus
construct the client inside `main()` after credential validation. Module-level
after the refactor: standard-library imports, `TIER_DEFINITIONS`,
`PROJECT_PROFILES`, `DEFAULT_BASE_URL`, `_FILE_REF_RE`, `filter_review`, and the
small pure helpers already used by the CI script tests. This lets the test import
the module with plain `python3` without requiring the `openai` package, an API
key, argv parsing, or network access.

The local `~/.local/bin/kimi-review` helper currently imports `OpenAI` at module
load. If it remains a separate file, mirror this import-inside-`main()` structure
there too, so its local unit test is genuinely hermetic.

**Why the broad file-reference test (not just `:line`):** the tool _drops_
non-findings, and a drop is unrecoverable. Matching `/`, `:digit`, or `.ext`
keeps a real finding even if the model formats it without a line number. A
placeholder ("No critical issues found.") references no file and is dropped. A
rare false positive (e.g. a placeholder containing "i.e.") would survive into
stdout but is harmless — the hook's `[CRITICAL]+:line` gate does not block it.

### Component 2 — Tool test: tracked canonical test plus optional local test

Add a tracked test for `scripts/kimi-review.py` that loads the script via
`importlib.util` and calls `filter_review` directly (no `openai` package, no API
key, no network). The local `~/.local/bin/test-kimi-review.py` may remain as a
smoke test for the helper, but it is not the canonical verification path.

Covers:

1. Placeholder lines only → returns the clean message.
2. A real `[CRITICAL]` finding (`path:line`) → kept.
3. A finding in a tier not in `requested_tiers` → dropped.
4. Placeholder + real finding mixed → only the real finding kept.
5. A real finding plus its indented `Detail:` continuation line → both kept.
6. A placeholder plus a following continuation line → both dropped.
7. A real finding whose description contains the words "no findings" → kept.
8. A finding citing a bare filename with no line number (`schema.ts`) → kept.

### Component 3 — Gate hardening: Claude hook, Husky hook, and CI gate

Defense-in-depth so a future tool regression that leaks a placeholder still
cannot phantom-block.

- Replace the word/exclude-grep pair in `.claude/hooks/kimi-review.sh`,
  `.husky/pre-commit`, and `scripts/ci-kimi-review.sh` with the shape match
  `grep -E '[[]CRITICAL[]][^:]*:[0-9]'` — a `[CRITICAL]` tag followed on the
  same line by a `:<line-number>`. Placeholders have no `:line` and cannot match.
- Rewrite each gate's rationale comment to describe the shape match and the
  deliberate fail-open trade-off (a malformed real finding with no line number
  does not block but still surfaces in the gate output / `additionalContext`).
- Add a `clean-model-prose` stub to `test-kimi-review.sh` emitting
  `[CRITICAL] No critical issues found.` / `[WARNING] No warning-level issues
found.`, with assertions that it does not block and does emit
  `additionalContext` for the Claude hook.
- Add matching `clean-model-prose` assertions for the Husky and CI gate helpers,
  so a regression cannot survive outside the Claude-Code hook path.

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
  → gates grep stdout      [CRITICAL] + :line shape match
  → block / allow
```

## Error handling

`filter_review` is pure and total — no exceptions, no I/O. An empty/None model
response is still handled by the existing token-error branch. A response that
contains only prose or empty-tier placeholders returns the clean message. Tool,
hook, Husky, and CI gate test failures surface via each script's non-zero exit
code.

## Testing

- Tracked canonical test for `scripts/kimi-review.py` — `filter_review` unit
  cases, runnable with plain `python3` and no `openai` package installed.
- Optional local smoke test for `~/.local/bin/kimi-review` — verifies the helper
  remains in sync with the canonical filter.
- `bash .claude/hooks/test-kimi-review.sh` — Claude hook, Husky hook, and CI gate
  end-to-end cases, including the new `clean-model-prose` regression for all
  three gates.

## Out of scope / follow-up

`~/.local/bin/kimi-review`, `kimi-challenge`, `kimi-multi-review`, and the local
tool smoke test are bespoke local scripts, not tracked in the `claude-coworker`
git repo (which versions only `ask-kimi`, `kimi-write`, `extract-chat`). Moving
the `kimi-*` tools into that repo's `tools/` for version control is recommended
but is a separate change. Until then, `scripts/kimi-review.py` is canonical and
local helpers must be treated as copies/adapters of the tracked implementation.
