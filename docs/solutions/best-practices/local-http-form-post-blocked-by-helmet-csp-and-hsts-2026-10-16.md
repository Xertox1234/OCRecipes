---
title: "A server-rendered form can't be POSTed from the simulator's Safari against the local http server — helmet's upgrade-insecure-requests + HSTS rewrite it to https; curl the POST and serve the result from 127.0.0.1"
track: knowledge
category: best-practices
module: server
tags: [testing, simulator, helmet, csp, server-rendered-html]
applies_to: ["server/index.ts", "server/lib/verify-email-page.ts", "server/routes/**/*.ts"]
created: 2026-10-16
---

# Local http form POSTs from the simulator are blocked by helmet's CSP and HSTS

## Rule

To test a server-rendered page's form submit (for example the verify-email confirm button) against `npm run server:dev` on the simulator, don't submit the form in Safari. POST with curl, save the HTML it returns, and open that file in the simulator from `http://127.0.0.1:<port>`. Production is unaffected and needs none of this.

## Why

`server/index.ts` calls `app.use(helmet())` with its defaults. Every response, including those on local http, carries:

- `Content-Security-Policy: … upgrade-insecure-requests`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`

Safari obeys both. When it submits the form to the `http://` host it rewrites the action to `https://`, and the local server has no TLS, so Safari shows "can't establish a secure connection". The GET that renders the page works, so it looks as if the button itself is broken. Once the HSTS header has been seen, the host stays https-only in that simulator.

HSTS is never applied to a bare IP address. So a page served from `127.0.0.1` still loads over http.

## Examples

```bash
# 1. The page renders (GET works):
curl -s 'http://localhost:3000/verify-email?token=<token>' | grep -c '<form'
# 2. Do what the form would do (field names from the rendered <form>):
curl -s -X POST 'http://localhost:3000/verify-email' --data-urlencode 'token=<token>' > "$SCRATCH/result.html"
# 3. Serve the result from an IP and open it in the sim:
python3 -m http.server 8099 --bind 127.0.0.1 --directory "$SCRATCH" &
xcrun simctl openurl <udid> 'http://127.0.0.1:8099/result.html'
```

Quote every URL containing `?` (zsh treats it as a glob). A link button on the result page (`ocrecipes://…`) then opens the app exactly as it would from production.

## Exceptions

- Don't loosen helmet for dev to make Safari work. The defaults are the production config, and a dev-only CSP is a config that differs from what you are testing.
- A plain GET page with no form, such as the success or invalid states, opens fine directly from `http://localhost:3000`.
