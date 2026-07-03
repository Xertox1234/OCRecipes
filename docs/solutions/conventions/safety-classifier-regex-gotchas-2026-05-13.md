---
title: Deterministic safety classifier regex gotchas
track: knowledge
category: conventions
module: server
tags: [security, ai-safety, regex, prompt-injection, classifier]
applies_to: [server/services/**/*.ts, server/lib/ai-safety.ts]
created: '2026-05-13'
---

# Deterministic safety classifier regex gotchas

## When this applies

Regex-based safety classifiers (intent routers, content filters, rate limiters) have two non-obvious failure modes that allow bypasses through otherwise-valid input formatting.

## Examples

### 1. `.` does not match newlines — use `[\s\S]*` for multi-word patterns

JavaScript `.` matches any character _except_ `\n` (and `\r`). A multi-word safety pattern like `ignore.*safety` can be bypassed by inserting a newline between the matched words:

```
"ignore\nyour safety guidelines"  →  ❌ does NOT match /ignore.*safety/
"ignore\nyour safety guidelines"  →  ✅ matches /ignore[\s\S]*safety/
```

```typescript
// ❌ Bad — newline bypass
{ pattern: /ignore.*(instruction|rule|safety)/i, name: "prompt_injection" }
{ pattern: /unrestricted.*(fitness|ai)/i,        name: "jailbreak" }

// ✅ Good — [\s\S]* spans newlines
{ pattern: /ignore[\s\S]*(instruction|rule|safety)/i, name: "prompt_injection" }
{ pattern: /unrestricted[\s\S]*(fitness|ai)/i,        name: "jailbreak" }
```

**Apply to:** any safety pattern where the attacker controls whitespace between the trigger word and the target keyword, particularly prompt-injection and jailbreak detection patterns.

**ReDoS note:** `[\s\S]*` followed by an alternation (`(a|b|c)`) can trigger O(n²) backtracking on long messages that match the prefix but not the suffix. Bound inputs via upstream max-length sanitization, or use `[\s\S]{0,500}` to cap backtracking depth explicitly.

### 2. Comma-separated thousands bypass numeric extraction

A pattern that extracts a 2–3 digit number from user input (`\d{2,3}`) to check a threshold (e.g., calorie restriction below 1,200) is vulnerable to comma-formatted input. The comma `","` satisfies `(?<!\d)`, so `\d{2,3}` extracts the last 3 digits of a comma-separated number:

```
"1,500 cal/day" → (?<!\d)(\d{2,3})(?!\d) extracts "500" → parseInt = 500 < 1200
                → ❌ false-positive safety_refusal for a realistic calorie target
```

**Fix:** normalize thousand-separator commas before applying numeric patterns:

```typescript
// Strip "1,500" → "1500" before matching
const normalized = trimmed.replace(/(\d),(\d{3})/g, "$1$2");
const calorieMatch = normalized.match(CALORIE_RESTRICTION_RE);
```

**This applies to any numeric threshold check in a safety classifier**, not just calories. If users can format numbers with commas (copy-paste from a fitness app, spreadsheet, etc.), normalize first.

### 3. Variant spellings of medical/medication terms

Safety patterns that match specific medication names must account for common spacing and punctuation variants:

```typescript
// ❌ Misses "glp 1" (space-separated) — trivial bypass for a metabolic-medication flag
/(glp-?1)/i

// ✅ Matches "glp-1", "glp1", "glp 1", "glp.1"
/(glp[-\s.]?1)/i
```

**Rule:** for any pattern matching a compound term with a separator (hyphen, space, period), use `[-\s.]?` rather than `-?` unless you have a specific reason to exclude the space variant.

## Why

Safety classifiers must defend against trivially-formattable bypasses. Attackers control whitespace, punctuation, and number formatting in their input; the regex author cannot assume canonical formatting.

## Related Files

- `server/services/coach-intent-classifier.ts` — all three fixes applied
- `server/services/__tests__/coach-intent-classifier.test.ts` — regression tests

## See Also

- [Safety Regex Must Exclude Legitimate Use](safety-regex-exclude-legitimate-use-2026-05-13.md)
