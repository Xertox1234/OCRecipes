# AI Prompting Rules

- Sanitize ALL prompt roles (`user`, `assistant`, `system`) — not just user messages; recipe/community content in assistant and system roles is equally adversarial
- OpenAI tool schema and handler parameter names must be identical — a mismatch causes phantom parameters that OpenAI ignores silently, breaking tool execution
- Never embed unsanitized user-provided content in `system` role messages — recipe ingredients, instructions, and user-authored text can contain injections
- `cacheAffectingFields` must stay in sync with `calculateProfileHash` — adding a profile field without updating the cache key serves stale responses to new configurations
- LLM tool-call arguments need three separate guards before dispatch: explicit `JSON.parse` try/catch (truncation signal), top-level plain-object shape check (rejects arrays/primitives that `as Record<string, unknown>` would silently accept), then per-tool Zod `safeParse`. Each failure mode needs its own log line — collapsing them into one outer catch hides truncation as a diagnosable failure mode.
