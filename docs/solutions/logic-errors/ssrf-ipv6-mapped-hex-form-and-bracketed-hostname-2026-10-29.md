---
title: An SSRF filter that matches "::ffff:a.b.c.d" by regex misses the hex form URL produces, and URL.hostname keeps IPv6 brackets — classify with net.BlockList, strip brackets first
track: bug
category: logic-errors
module: server
severity: high
tags: [security, ssrf, ipv6, ipv4-mapped, url-parsing, net-blocklist, recipe-import]
symptoms: ["isBlockedUrl('http://[::ffff:127.0.0.1]/') returns false", "Node fetch to [::ffff:7f00:1] reaches a server bound to 127.0.0.1", "every IPv6 literal URL refused after a stricter isIPv6 check"]
applies_to: [server/services/recipe-import.ts]
created: '2026-10-29'
---

# SSRF: the IPv4-mapped hex form and bracketed hostnames

## Problem

The URL-import SSRF filter matched IPv4-mapped IPv6 with `/^::ffff:(\d+\.\d+\.\d+\.\d+)$/`. Any signed-in user could make the server fetch its own loopback (and cloud metadata) through `POST /api/meal-plan/recipes/parse-url`.

## Symptoms

- `new URL("http://[::ffff:127.0.0.1]/").hostname` is `[::ffff:7f00:1]` — the dotted form never reaches the check, so the regex never matches.
- `[::]`, IPv4-compatible (`::127.0.0.1`), NAT64 (`64:ff9b::`), 6to4 (`2002::`) also passed.
- The first fix (`net.isIPv6(host)`) refused every IPv6 URL, public ones included: `URL.hostname` keeps the brackets, and `isIPv6("[2606:…]")` is false.

## Root Cause

String-matching addresses has to anticipate every spelling a normaliser can emit. WHATWG URL rewrites the embedded IPv4 to hex; DNS can return any form. And bracket handling was done in one function (`isBlockedUrl`) but not its sibling (`resolveAndValidateHost`), which received the raw hostname.

## Solution

Classify with one `net.BlockList` (Node built-in). `blockList.check(addr, "ipv6")` matches an IPv4-mapped address — dotted or hex — against the **IPv4** subnets, so the IPv4 rules cover every mapped spelling (verified: `::ffff:7f00:1` → blocked, `::ffff:8.8.8.8` → allowed). Block the IPv6 ranges that embed IPv4 another way outright (`::/96`, `::ffff:0:0:0/96` SIIT, `64:ff9b::/96`, `64:ff9b:1::/48`, `2002::/16`, `2001::/23`), plus ULA, link-local, site-local, multicast, discard, documentation. Strip `[`/`]` before every literal check. Watch the SIIT prefix: `::ffff:0:0/96` is the mapped range itself and blocks every IPv4 address — it is `::ffff:0:0:0/96`.

## Prevention

- Test with URLs (`new URL(u).hostname`), never hand-written bare addresses — the normaliser is the attack surface.
- Every SSRF test set needs must-ALLOW controls (public v4, public v6 in brackets, `::ffff:8.8.8.8`); a bad prefix that blocks everything passes every must-block test.
- Generate the corpus combinatorially (target × spelling); the 2026-10-29 review used 259 and then 338 cases.
- Still open: DNS check-then-use (fetch re-resolves) — pin the connection to the validated address with an undici `Agent({ connect: { lookup } })`.

## Related Files

- `server/services/recipe-import.ts` — `BLOCKED_ADDRESSES`, `isBlockedIPv4/6`, `resolveAndValidateHost`
- `server/services/__tests__/recipe-import.test.ts`

## See Also

- `docs/rules/security.md`
