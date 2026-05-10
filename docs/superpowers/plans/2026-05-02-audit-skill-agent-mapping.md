# Audit Skill Agent Mapping Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire 6 new specialist agents into the audit skill's domain mapping and add an accessibility checklist to the code reviewer.

**Architecture:** Two surgical markdown edits — replace the 6-row domain mapping table in the audit skill with a 7-row table, update the batch-count instruction, and append §14 Accessibility to the code-reviewer checklist. No production code changes; verification is grep-based.

**Tech Stack:** Markdown file edits only. No build step, no tests.

---

## File Map

| File                              | Change                                                                     |
| --------------------------------- | -------------------------------------------------------------------------- |
| `.claude/skills/audit/SKILL.md`   | Replace domain mapping table (lines 14–22) and batch instruction (line 23) |
| `.claude/agents/code-reviewer.md` | Append §14 Accessibility after §13 (after line 302)                        |

---

### Task 1: Update audit/SKILL.md — domain mapping table

**Files:**

- Modify: `.claude/skills/audit/SKILL.md` (lines 14–22, table; line 23, batch instruction)

The current table maps 6 domains to agents, several incorrectly. Replace the entire table and the batch instruction immediately below it.

- [x] **Step 1: Confirm the exact text to replace**

Run:

```bash
grep -n "performance\|architecture\|code-quality\|camera\|security\|data-integrity\|full.*pre-launch\|batch" /Users/williamtower/projects/OCRecipes/.claude/skills/audit/SKILL.md | head -20
```

Expected output includes lines like:

```
14:| `security`       | `security-auditor` + `ai-llm-specialist`          | ...
...
22:| `camera`         | `camera-specialist` + `rn-ui-ux-specialist`       | ...
23:**For `full` or `pre-launch` scopes:** Launch agents for all domains (batch in groups of 4-5, not all at once).
```

- [x] **Step 2: Replace the mapping table and batch instruction**

In `.claude/skills/audit/SKILL.md`, replace this block:

```
| Audit Domain     | Primary Agent(s)                                  | What They Check                                                       |
| ---------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| `security`       | `security-auditor` + `ai-llm-specialist`          | IDOR, rate limiting, JWT, SSRF, prompt injection, AI safety           |
| `performance`    | `database-specialist` + `rn-ui-ux-specialist`     | N+1 queries, missing indexes, FlatList optimization, animation jank   |
| `data-integrity` | `database-specialist` + `nutrition-domain-expert` | Soft deletes, polymorphic FK orphans, cache dedup, nutrition accuracy |
| `architecture`   | `database-specialist` + `ai-llm-specialist`       | Service/storage layering, route helper usage, db import violations    |
| `code-quality`   | `testing-specialist` + `code-reviewer`            | Test coverage gaps, mock quality, pattern compliance, code smells     |
| `camera`         | `camera-specialist` + `rn-ui-ux-specialist`       | Permissions, scan debouncing, frame processors, lifecycle management  |

**For `full` or `pre-launch` scopes:** Launch agents for all domains (batch in groups of 4-5, not all at once).
```

With:

```
| Audit Domain     | Primary Agent(s)                                                      | What They Check                                                                                      |
| ---------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `security`       | `security-auditor` + `ai-llm-specialist`                              | IDOR, rate limiting, JWT, SSRF, prompt injection, AI safety                                          |
| `performance`    | `performance-specialist` + `database-specialist`                      | FlatList memoization, useCallback stability, streaming UI, Promise.all, N+1 queries, missing indexes |
| `data-integrity` | `database-specialist` + `nutrition-domain-expert`                     | Soft deletes, polymorphic FK orphans, cache dedup, nutrition accuracy                                |
| `architecture`   | `architecture-specialist` + `api-specialist`                          | Service/storage layering, dependency direction, route module structure, SSE patterns, singleton init |
| `code-quality`   | `quality-specialist` + `typescript-specialist` + `testing-specialist` | Error handling, naming, type guards, Zod schemas, nav typing, test coverage gaps                     |
| `camera`         | `camera-specialist` + `rn-ui-ux-specialist`                           | Permissions, scan debouncing, frame processors, lifecycle management                                 |
| `accessibility`  | `accessibility-specialist` + `rn-ui-ux-specialist`                    | Modal focus trapping, VoiceOver/TalkBack announcements, touch targets, WCAG contrast, aria-invalid   |

**For `full` or `pre-launch` scopes:** Launch agents for all domains (batch in groups of 4 — e.g., four batches: 4, 4, 4, 3 — not all at once).
```

- [x] **Step 3: Verify the table landed correctly**

Run:

```bash
grep -n "accessibility\|architecture-specialist\|performance-specialist\|quality-specialist\|typescript-specialist\|four batches" /Users/williamtower/projects/OCRecipes/.claude/skills/audit/SKILL.md
```

Expected — all of these lines must appear:

```
<line>: | `accessibility`  | `accessibility-specialist` + `rn-ui-ux-specialist` ...
<line>: | `architecture`   | `architecture-specialist` + `api-specialist` ...
<line>: | `performance`    | `performance-specialist` + `database-specialist` ...
<line>: | `code-quality`   | `quality-specialist` + `typescript-specialist` + `testing-specialist` ...
<line>: ...four batches: 4, 4, 4, 3...
```

Also verify the old wrong agents are gone:

```bash
grep "rn-ui-ux-specialist.*performance\|database-specialist.*architecture\|ai-llm-specialist.*architecture\|code-reviewer.*code-quality\|4-5" /Users/williamtower/projects/OCRecipes/.claude/skills/audit/SKILL.md
```

Expected: **no output** (zero matches).

- [x] **Step 4: Also update the named-scope dispatch section to reference accessibility**

In `.claude/skills/audit/SKILL.md`, find the line:

```
**For named scopes:** Launch only the primary agent(s) for that domain.
```

This line needs no change — the named-scope rule ("launch only the primary agent(s) for that domain") already handles any domain including `accessibility`. No edit needed here; just confirm the line still exists:

```bash
grep "named scopes" /Users/williamtower/projects/OCRecipes/.claude/skills/audit/SKILL.md
```

Expected: one matching line.

- [x] **Step 5: Commit**

```bash
git add .claude/skills/audit/SKILL.md
git commit -m "fix: update audit skill domain mapping with 6 new specialist agents

- Replace architecture domain: database-specialist+ai-llm → architecture-specialist+api-specialist
- Replace performance domain: rn-ui-ux-specialist → performance-specialist (database-specialist stays)
- Replace code-quality domain: code-reviewer → quality-specialist+typescript-specialist+testing-specialist
- Add accessibility domain: accessibility-specialist+rn-ui-ux-specialist
- Update full/pre-launch batch instruction: 4-5 → four batches of 4,4,4,3 (15 total)"
```

---

### Task 2: Update code-reviewer.md — add §14 Accessibility

**Files:**

- Modify: `.claude/agents/code-reviewer.md` (append after §13)

The code-reviewer currently has no accessibility section. Add §14 after the existing §13 Documentation & Todos section, before the `---` separator that starts the Review Process section.

- [x] **Step 1: Find the insertion point**

Run:

```bash
grep -n "Documentation & Todos\|Review Process\|---" /Users/williamtower/projects/OCRecipes/.claude/agents/code-reviewer.md | head -20
```

Expected: lines like:

```
297: ### 13. Documentation & Todos
...
302: - Implementation patterns included for complex changes
303:
304: ---
305:
306: ## Review Process
```

The new §14 section goes between the last bullet of §13 and the `---` separator.

- [x] **Step 2: Insert §14 Accessibility**

In `.claude/agents/code-reviewer.md`, replace this block (immediately after the last §13 bullet, before the `---`):

```
- Implementation patterns included for complex changes

---

## Review Process
```

With:

```
- Implementation patterns included for complex changes

### 14. Accessibility

- [ ] `accessibilityViewIsModal={true}` on the inner container of every modal, bottom sheet, overlay, and confirmation dialog — without this, VoiceOver/TalkBack users can navigate to elements behind the modal
- [ ] `accessibilityLiveRegion` (Android) always paired with `AccessibilityInfo.announceForAccessibility` in a `useEffect` (iOS) — neither works cross-platform alone. Pattern: `if (message && Platform.OS === "ios") { AccessibilityInfo.announceForAccessibility(message); }`
- [ ] `accessibilityLiveRegion="assertive"` only for errors/failures; `"polite"` for loading/progress states — assertive interrupts current speech immediately and is disruptive if used for loading spinners
- [ ] Every `TextInput` with a validation error has `aria-invalid={true}` AND is paired with `<InlineError message={error} />` below it — NOT `accessibilityState={{ invalid: true }}` (TypeScript error: `invalid` not in `AccessibilityState`) and NOT raw `<Text style={styles.error}>` (invisible to screen readers)
- [ ] Decorative icons inside `Pressable`/`TouchableOpacity` have `accessible={false}` — without this, VoiceOver announces each icon as a separate focus stop (e.g., "activity image", "GLP-1 Companion", "chevron-right image" for a single row)
- [ ] Interactive elements have a minimum 44×44pt touch target (WCAG 2.5.5); use `hitSlop={{ top: N, bottom: N, left: N, right: N }}` for small visual elements where `(visual size) + top + bottom ≥ 44`
- [ ] Role/state pairs are correct: `role="radio"` → `accessibilityState={{ selected }}`, `role="checkbox"` → `accessibilityState={{ checked }}`; mutually-exclusive option groups use `role="radiogroup"` on the container, multi-select lists use `role="list"`

**Pattern Reference:**
- `.claude/agents/accessibility-specialist.md` — full pattern catalog with code examples
- `client/components/InlineError.tsx` — canonical cross-platform error announcement (`accessibilityRole="alert"`, `accessibilityLiveRegion="assertive"`, iOS `announceForAccessibility`)
- `scripts/check-accessibility.js` — pre-commit script catches 3 categories; this checklist catches the 7 the script misses (custom wrappers, `onLongPress`-only, role/state correctness, decorative children, missing `accessibilityViewIsModal`, touch targets, missing `aria-invalid`)

---

## Review Process
```

- [x] **Step 3: Verify the section was inserted correctly**

Run:

```bash
grep -n "14. Accessibility\|accessibilityViewIsModal\|aria-invalid\|accessibilityLiveRegion\|44×44\|InlineError\|accessibility-specialist" /Users/williamtower/projects/OCRecipes/.claude/agents/code-reviewer.md
```

Expected: all 7 checklist items and the pattern references appear. Confirm §14 comes before `## Review Process`:

```bash
grep -n "14. Accessibility\|## Review Process" /Users/williamtower/projects/OCRecipes/.claude/agents/code-reviewer.md
```

Expected: §14 line number is lower than `## Review Process` line number.

- [x] **Step 4: Confirm section count is now 14**

```bash
grep -n "^### [0-9]*\." /Users/williamtower/projects/OCRecipes/.claude/agents/code-reviewer.md
```

Expected: 14 lines, numbered 1 through 14.

- [x] **Step 5: Commit**

```bash
git add .claude/agents/code-reviewer.md
git commit -m "feat: add accessibility checklist section (§14) to code-reviewer agent

Covers the 7 violation categories missed by check-accessibility.js:
accessibilityViewIsModal, cross-platform live region pairing, assertive/polite
polarity, aria-invalid+InlineError, accessible={false} on decorative icons,
44×44pt touch targets, and role/state correctness."
```

---

### Task 3: Smoke-check both files end-to-end

- [x] **Step 1: Confirm audit skill has exactly 7 domain rows**

```bash
grep -c '^\| `' /Users/williamtower/projects/OCRecipes/.claude/skills/audit/SKILL.md
```

Expected: `7`

- [x] **Step 2: Confirm code-reviewer has 14 numbered sections**

```bash
grep -c "^### [0-9]*\." /Users/williamtower/projects/OCRecipes/.claude/agents/code-reviewer.md
```

Expected: `14`

- [x] **Step 3: Confirm no old wrong agent assignments remain in audit skill**

```bash
grep -E "database-specialist.*architecture|ai-llm-specialist.*architecture|rn-ui-ux-specialist.*performance|code-reviewer.*code-quality" /Users/williamtower/projects/OCRecipes/.claude/skills/audit/SKILL.md
```

Expected: **no output**.

- [x] **Step 4: Final commit if any loose changes remain**

```bash
git status
```

If clean (nothing to commit), done. If files were touched during smoke-check, commit them:

```bash
git add .claude/skills/audit/SKILL.md .claude/agents/code-reviewer.md
git commit -m "fix: address smoke-check corrections in agent mapping and code-reviewer"
```
