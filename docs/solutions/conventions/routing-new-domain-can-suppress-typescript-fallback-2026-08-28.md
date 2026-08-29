---
title: "Routing a path to a new domain can silently suppress the language-level typescript fallback"
track: knowledge
category: conventions
module: shared
tags: [harness, path-domains, typescript, fallback, routing, injection, reachability]
applies_to: [scripts/lib/path-domains.ts, .claude/hooks/inject-patterns.sh]
created: '2026-08-28'
---

# Routing a path to a new domain can silently suppress the language-level typescript fallback

## Rule

When adding a new `path-domains.ts` rule for a directory that holds `.ts`/`.tsx` files, check
whether any doc anchored there depends on the `typescript` fallback before assuming the new rule
is purely additive. `.claude/hooks/inject-patterns.sh` only adds `typescript` to the matched
domain set when `rulesDomainsForPath` returns **zero** domains (or exactly `["harness"]`):

```bash
if [ -z "$DOMAINS" ] || [ "$DOMAINS" = "harness" ]; then
  case "$FILE_PATH" in
    *.ts|*.tsx) add_domain typescript ;;
  esac
fi
```

The instant any OTHER non-empty domain rule matches a `.ts` file, this fallback stops firing. A
previously-unrouted directory that relied on the fallback for reachability LOSES it the moment
you route the directory to something else — unless you explicitly re-add `typescript` to that
rule's own `domains` array. Adding a route is not monotonic in doc reachability: it can add and
remove reach in the same commit.

## Smell patterns

- A new `path-domains.ts` rule routes a directory that previously matched no rule at all
  (`rulesDomainsForPath` returned `[]` before, non-empty after)
- A doc's `tags:` includes `typescript` as its ONLY routable domain tag, and its `applies_to`
  names a path about to gain a route
- The review only checks "does the new rule route correctly" and not "does anything that WAS
  reachable become unreachable"

## Why

Solution-doc retrieval requires a doc's `tags:` to include a domain the edited file resolves to
(`docs/solutions/README.md`'s two-part precondition: `tags` picks the candidate pool, `applies_to`
only re-ranks within it). Before a directory has a `path-domains.ts` rule, every `.ts` file in it
resolves to `["typescript"]` via the fallback, so a `typescript`-only-tagged doc anchored there is
reachable. The moment a rule routes that directory to, say, `["architecture"]`, the fallback's
guard condition (`-z "$DOMAINS"`) is now false, so `typescript` is never added — the file's
resolved domain set becomes `["architecture"]` only, and the `typescript`-only doc goes dark for
that anchor.

## Examples

`todos/archive/P3-2026-08-11-unrouted-surfaces-domain-map-decision.md` (closed 2026-08-28) routed
`shared/constants/**`, `shared/types/**`, `shared/lib/**`, and `server/lib/**` to `architecture`
(the first three) and `[api, security, architecture]` (the last). Before writing the rules, an
audit of every doc anchored to those four surfaces found at least one `typescript`-only-tagged doc
per surface that would have gone unreachable from that anchor without an explicit fix — e.g.
`type-only-import-breaks-schema-cycle-2026-05-17.md` and
`jwt-types-shared-pulls-jsonwebtoken-bundle-2026-05-13.md`. The fix: append `typescript` directly
to each new rule's `domains` array (`["architecture", "typescript"]`,
`["api", "security", "architecture", "typescript"]`), matching the precedent the existing
`client/lib/**` rule already set (`domains: ["typescript", "client-state"]`) — almost certainly
written for the same reason, though never documented as a rule until now.

The check: for every doc whose `applies_to` names a path under the surface you're about to route,
read its `tags:` and ask "does this doc carry a routable tag OTHER than `typescript`, or is
`typescript` reachable via one of the doc's OTHER `applies_to` anchors?" If neither, and the new
rule omits `typescript`, the doc goes dark for that anchor. Verify with
`npx tsx scripts/lib/path-domains.ts <path>` before and after the change, and confirm empirically
by running the hook against a representative file — never by reading the rule table alone.

## Exceptions

Directories with no realistic `.ts`/`.tsx` file anchored to them don't need this check — the
fallback never applied there. `android/**` and the `package.json`/`app.json` `config-file` rule in
the same todo skipped `typescript` for exactly this reason.

A directory whose `.ts` files are all reachable via a second `applies_to` anchor elsewhere (a doc
anchored to both the new surface and an already-`typescript`-routed directory) can skip appending
`typescript` for THAT specific rule — the doc survives globally, it just loses reach from the one
anchor. Verify this per doc before relying on it; don't assume.

## Related Files

- `scripts/lib/path-domains.ts` — the rule table (`PATH_TO_DOMAINS`)
- `.claude/hooks/inject-patterns.sh` — the fallback guard (`if [ -z "$DOMAINS" ] ...`)
- `docs/solutions/README.md` — the two-part `tags`/`applies_to` retrieval precondition

## See Also

- [documented-mirror-invariant-desyncs-when-only-one-side-is-edited](../logic-errors/documented-mirror-invariant-desyncs-when-only-one-side-is-edited-2026-08-16.md) — same shape: one side of a system changes, the paired assumption doesn't get re-checked
