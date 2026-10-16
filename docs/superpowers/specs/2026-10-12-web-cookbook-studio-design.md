# Web Cookbook Studio — design

> **Date:** 2026-10-12 · **Status:** approved section-by-section in conversation, awaiting spec review. **D6, D7 and PDF retention (§14.4) await explicit owner confirmation** (they came from "looks good" replies).
> **Origin:** web "Phase 2" outline in `2026-06-07-railway-cloudflare-deployment-design.md` §PHASE 2, replaced by the owner's ruling that the web app is its own product (memory `project_web_app_own_product_2026_10_12`).
> **Risk classes:** auth (M1, M7), payments (M5, M8) — by hand, TDD, security-auditor review, owner yes before merge. Never delegated to cheap workers.

## 1. What we are building (plain words)

**A website where people turn their recipes into a beautiful family cookbook.**

1. They sign in with their OCRecipes account (email, Google or Apple — the same account as the phone app).
2. They make a cookbook: pick a look, add a cover photo and title, write a dedication, create chapters and fill them with recipes (from OCRecipes or typed fresh), each with a personal note and a photo of the original handwritten card. They drag things into order.
3. They download it as a PDF and email it to family. Every page has a small "Brought to you by OCRecipes.com"; the last page promotes upcoming apps.
4. They can order a printed copy (soft- or hardcover) delivered to their door. The printed book has no ads, only a small OCRecipes mark.
5. Their own AI assistant (Claude, ChatGPT, Grok) can be connected to add recipes to books and order prints, within a spending limit they set.

The phone app gets an "Add to a book…" button and can view/share finished cookbooks. The owner earns a margin on printed books and gets free advertising on every shared PDF.

## 1a. Problem and goal

People treasure their recipes; a family cookbook is something a mother hands to her daughter. OCRecipes today only has recipe _folders_ (`cookbooks` + `cookbook_recipes`, `shared/schema.ts:1910-1950`) — no way to make something worth keeping.

**Goal:** on the web, a person makes a beautiful, personal cookbook from their recipes, gets it as a PDF to share, and can order a printed copy. Their own AI assistant (Claude, ChatGPT, Grok…) can help — including ordering prints.

**Success:**

1. A signed-in user builds a book (cover, dedication, chapters, recipes with notes and a photo of the handwritten card), exports a PDF, and emails it.
2. The same user orders a hardcover; it arrives clean (no ads), and the owner earns a margin.
3. A user's assistant, connected by OAuth, adds a recipe to a book and orders a print within the user's spending limit.

**Positioning (keep in every decision):** real family recipes, real handwriting, real stories. Assistants tidy and help; they never invent filler. The bar is "feels precious".

## 2. Decisions (owner, 2026-10-12)

| #   | Decision                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | The web app is **its own product**, not a port of the phone app. Centerpiece: Cookbook Creation. Brand (OCRecipes vs its own name) is **open** (§14).                                                                                                                    |
| D2  | **Stack:** Astro + React islands on Cloudflare; the existing **Express + Drizzle + Railway Postgres** stays the single source of truth and the **only** sign-in system.                                                                                                  |
| D3  | **No CMS.** EmDash rejected (staff-only accounts, sandboxed plugins, no member accounts); Payload rejected (second back end + auth bridge; visual editor is paid Enterprise); Puck rejected (generic page model). EmDash may later host a marketing/editorial site only. |
| D4  | **Our own cookbook editor** (dnd-kit + Tiptap + our page components) over **our own document format**.                                                                                                                                                                   |
| D5  | Output is a **PDF** — print-ready. No self-publishing.                                                                                                                                                                                                                   |
| D6  | Recipes are **copied** into a book (frozen), with an "update from the app?" prompt when the original changes.                                                                                                                                                            |
| D7  | **Editing is web-only in v1**; the phone gets "Add to a book…" and view/share.                                                                                                                                                                                           |
| D8  | **Every digital PDF** (free and subscribers alike) carries a subtle "Brought to you by OCRecipes.com" + small logo **footer on every page** and a **last page promoting upcoming properties** (e.g. Family Meal Planner).                                                |
| D9  | **Printed books are clean** (no footer, no promo page) but credit OCRecipes in the **colophon** (title-page verso) and a **small back-cover mark**.                                                                                                                      |
| D10 | **Printing through a print-on-demand API with our markup** (owner takes a cut). Lulu vs Prodigi chosen by **sample prints**.                                                                                                                                             |
| D11 | **AI assistants can spend:** with a saved card and **per-assistant limits**, an assistant places print orders without an extra tap (owner chose B).                                                                                                                      |

## 3. Architecture

```
 Railway Postgres (Drizzle) ← users, recipes, books, exports, orders, OAuth grants — ONE database
        │
   Express API (Railway) ──► phone app (Bearer JWT, unchanged)
        │   ├─ /mcp + OAuth 2.1 ──► users' assistants (M7, M8)
        │   ├─ Stripe (Checkout + saved cards) ◄─ webhooks
        │   └─ print provider (Lulu | Prodigi) ◄─ webhooks
        │
        ├──► pdf-renderer (Railway, private network): Chromium + Paged.js, pulls jobs from Postgres
        │         └──► R2 private prefix (PDFs, card photos) → short-lived signed links
        ▼
   web/ — Astro + React (Cloudflare) — no database; reads/writes through the API
```

- `web/` is a new top-level app in the monorepo; it imports types from `shared/`.
- **`cookbook-render/`** — a new package holding the page React components and each style's CSS. Both `web/` (editor canvas, browser preview) and `pdf-renderer` (Node) import it; this is what makes the editor and the PDF identical. `shared/` stays React-free.
- **Static build** (Workers Static Assets, per the June plan): pages are static HTML + React islands; **all data is fetched from the browser** with the auth cookie (§9). No server-side rendering, so no cookie forwarding. The OAuth consent screen (§10.1) is a page on the web app: `/oauth/authorize` on the API checks the cookie session, then redirects to the web consent page, which posts the user's choice back to the API. With no cookie session, `/oauth/authorize` stores the full authorization request server-side under an opaque id and sends the user to web sign-in with that id; after sign-in they return to consent with the original request intact.
- The renderer is a **separate service** so a 120-page render (tens of seconds, hundreds of MB) never slows the API.
- No Redis: the job queue is a Postgres table (§6).

## 4. The cookbook document (M0)

**Storage.** Existing `cookbooks` (recipe folders) are untouched. New table `cookbook_books`:

| column                  | type                            | notes                                              |
| ----------------------- | ------------------------------- | -------------------------------------------------- |
| id                      | serial PK                       |                                                    |
| user_id                 | varchar FK users, cascade       | a deleted account deletes its books (privacy)      |
| source_collection_id    | int null FK cookbooks, set null | book started from a folder                         |
| title                   | text                            | denormalised from `document.cover.title` for lists |
| document                | jsonb                           | the `CookbookDocument` below                       |
| schema_version          | int                             |                                                    |
| revision                | int, default 0                  | bumped on every save (§5 autosave)                 |
| created_at / updated_at | timestamptz                     |                                                    |

**Shape** (Zod, `shared/cookbook-document.ts`; the server rejects anything that fails it):

```ts
{
  schemaVersion: 1,
  style: { id: "rustic-kitchen", accent: "#8a4b2a", fonts: "serif-classic" },
  format: { size: "8x10" },                     // must be a size the chosen printer sells
  cover:  { title, subtitle?, byline?, photo?: ImageRef },
  sections: Array<
    | { kind: "dedication", body: RichText }
    | { kind: "chapter", title: string, items: Array<
        | { kind: "recipe",
            recipe: { title, servings?, prepMinutes?, cookMinutes?,
                      ingredients: { amount?, unit?, item, note? }[],
                      steps: RichText[], photo?: ImageRef },     // a COPY (D6)
            source: { type: "own" | "ocrecipes" | "manual", id?, copiedAt },
            note?: RichText,           // "he likes it with extra lime"
            card?: ImageRef }          // photo of the handwritten original
        | { kind: "story", body: RichText, photo?: ImageRef }
        | { kind: "photo", image: ImageRef, caption?: string }
        | { kind: "pageBreak" } > }>
}
```

- **Structure, not pages.** Paged.js computes pages per style and size; changing either reflows the book. Users steer layout with order and `pageBreak`.
- `RichText` = Tiptap JSON restricted to an allow-list (paragraph, bold, italic, lists, hard break). `ImageRef` = `{ key, width, height, focal? }` — `key` is an R2 object key under the **private** prefix (§6.4).
- `upgradeDocument(doc)` runs on load; the v1 → v2 test exists from day one.
- **Which recipes can go in a book (owner ruling 2026-10-12):** only recipes **the user entered themself** (`own`: `sourceType = "user_created"`, or typed in the editor — `manual`) and recipes **written by OCRecipes' AI** (`ocrecipes`: any recipe the user generated — `/api/recipes/generate`, chat saves, and "Make this mine" — plus seed rows with `authorId IS NULL`). Note: generated recipes are stored with `authorId = <the requesting user>`, not NULL, and generation is recorded in two places (`recipeGenerationLog` and `recipe_finder_claims`); a durable provenance marker may be needed (§14). Anything authored by **anyone else** — another user's community recipe, a recipe imported from a website (`url_import`), or third-party catalogue data (e.g. Spoonacular) — **cannot be added**. The server enforces this in `POST /api/books/:id/recipes` and the `add_recipe_to_book` tool; the recipe picker hides ineligible recipes. Because every recipe in a book is the user's own or OCRecipes', no credit line and no new licence are needed.
- **Limits:** max sections, items, and document bytes enforced by the schema and a body-size cap on the route.

## 5. The editor (M2)

Three panes: **Outline** (chapters/items, drag to reorder — dnd-kit sortable) · **Page canvas** (selected part, real page size, bleed and margin guides, rendered by the **same React components** the renderer uses) · **Inspector** (photo crop, note, card image, style/accent).

- Text is edited in place with **Tiptap** (MIT core only; no Pro extensions). Ingredients and steps are **structured fields**, so assistants can scale/convert later.
- **"Preview whole book"** runs Paged.js in the browser on demand (not per keystroke).
- **Adding recipes (v1):** pick from the user's OCRecipes recipes (meal plan, favourites, folders), type a new one, or attach a card photo as an image. Card transcription is **later**.
- **Low-resolution warning:** pixel size vs printed size → "This photo may look blurry in print."
- **Autosave** debounced; every save sends `revision`; server answers **409** if stale → "This book changed elsewhere — reload" (covers two tabs and an assistant editing at once). Undo/redo client-side. On save failure: "Not saved — retrying" banner + draft kept in IndexedDB.
- v1 ships **one style**; three by M4.

**API** (`server/routes/cookbook-books.ts`, all `requireAuth` + owner check): `GET/POST /api/books`, `GET/PUT/DELETE /api/books/:id` (`PUT` takes `{ document, revision }`), `POST /api/books/:id/recipes` (copy a recipe in), `POST /api/books/:id/exports`, `GET /api/exports/:id`.

## 6. Rendering PDFs (M3, M4)

### 6.1 Service

`pdf-renderer` on Railway: Node + headless Chromium + Paged.js. Reachable only on Railway's private network; authenticates to the API with a service secret. Sized for Chromium memory spikes.

### 6.2 Queue

`cookbook_exports` (`id, book_id, revision, kind: "digital" | "print_interior" | "print_cover", status: queued|running|ready|failed, r2_key, page_count, attempts, locked_at, error, expires_at`). Workers claim with `SELECT … FOR UPDATE SKIP LOCKED`; a `running` row past its lock timeout is retried; `attempts` capped, then `failed` + Sentry.

### 6.3 Output

- Renders **the stored revision**, never "latest" — the PDF is exactly what the user saw.
- **Cache key:** `book + revision + kind + optionsHash`, where `optionsHash` covers paper size, binder margin and any single-recipe selection. Same key → existing file. The last-page promotion is whatever was active at render time; a cached file can show an older promo within its 30-day life (accepted).
- **Digital PDF:** letter or A4 by region; white margins; optional wider binder inner margin; single-recipe export. Running footer via `@page { @bottom-center }` (D8) + last-page promotion from the `promotions` table (§8).
- **Print bundle:** interior at the printer's trim **with 0.125 in bleed**; then the **cover spread** sized from the interior's page count (spine width from the printer's table), with the back-cover mark; colophon in front matter (D9). No footer, no promo page, no crop marks, no PDF password.
- **Images:** resized with `sharp` to ~300 ppi at placed size. **Fonts:** self-hosted, embeddable licences only (e.g. SIL OFL), embedded. Recipes are worldwide: every style declares a **Noto fallback stack** covering Latin, Cyrillic, Greek, Vietnamese, CJK, Arabic, Hebrew, Devanagari and Thai, and the renderer **checks glyph coverage** before producing the PDF — a missing glyph fails the export with the offending text named, never prints a box.
- **Limits:** max pages, render timeout, memory cap. Over-long books are refused before rendering. **Abuse limits:** one in-flight render per book, and a per-user export quota per day (rate-limited like other expensive routes); the cache alone does not stop edit-one-character-and-re-render loops.

### 6.4 Storage

PDFs and card photos go under a **private R2 prefix** — never under the public recipe-image path behind `R2_PUBLIC_BASE_URL`. Downloads use signed links valid for minutes. Exports expire after **30 days** (proposed default, §14); a daily job deletes them.

## 7. Print orders (M5)

- **`PrintProvider` interface:** `quote(spec, address)`, `submit(order, files)`, `parseWebhook(req)`. v1 implements the provider chosen by sample prints; the other stays possible.
- **Products v1:** one size, softcover + hardcover.
- **Price** = live provider quote (print + shipping) + markup (config: flat and/or %), tax via Stripe Tax. Computed and stored **server-side** on the order; the client never sends a price.
- **Web flow:** choose product/qty/address → quote → `print_orders` row `awaiting_payment` → **Stripe Checkout** (hosted; cards never touch our server) → webhook `paid` → submit print bundle → provider webhooks `in_production` → `shipped` (+ tracking) → email.
- **Idempotency:** `webhook_events (source, event_id unique)`; duplicates ignored; status only moves forward.
- **Failures:** provider rejects files after payment → automatic refund + email + Sentry. Submission outage → retry with backoff, then flag to owner. **Admin page** (owner only, `ADMIN_USER_IDS`): orders, status, margin, "retry submission", "refund".
- An order references specific **export ids**: what arrives is the PDF the user approved. Exports referenced by an unfinished order are exempt from the 30-day deletion. `print_orders.export_id` is `ON DELETE SET NULL`, so a retained order never blocks a book or account deletion.
- **Account deletion:** `print_orders` are **retained** for financial/tax records with the user reference nulled and the address snapshot removed once delivered; deletion is **deferred** while any order is `held`, `submitted` or `in_production`. Add the table to the existing retention-cleanup flow.

## 8. Branding and promotions

- Footer (digital only): static template text + logo.
- `promotions (id, kind: app|affiliate|sponsor, headline, body, image, slug, active_from, active_to, weight)` fills the digital **last page**.
- Every promo link is `ocrecipes.com/go/<slug>` (clickable + QR code) → `link_clicks` count → 302 to the target. Partners can change without re-rendering.
- Affiliate promos carry an FTC disclosure line. Each affiliate programme's terms are checked before use (some restrict links in emails/PDFs/offline).

## 9. Web sign-in (M1) — before anything user-facing

| Item                           | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email/password, email two-step | unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Google                         | accept the **web** client as `azp` (today `verify.ts:79-83` requires a phone client id)                                                                                                                                                                                                                                                                                                                                                                 |
| Apple                          | add a **Services ID**; accept `aud` ∈ {bundle id, Services ID}; **record which client each Apple identity used**, and refresh/revoke with that same id (`apple-tokens.ts:46,66`), preserving the "revoking any Apple token ends the whole grant" rule                                                                                                                                                                                                   |
| Token in the browser           | `HttpOnly; Secure; SameSite=Lax` **host-only** cookie on `api.ocrecipes.com` (no `Domain` attribute — so it is never sent to `img.` or other subdomains). `app.` → `api.` is same-site, so the web app's `fetch(..., { credentials: "include" })` carries it. `requireAuth` accepts cookie **or** header. State-changing requests carrying the cookie must have an allowed `Origin` (the CSRF guard the CORS comment in `server/index.ts` anticipates). |
| CORS                           | `WEB_ORIGIN=https://app.ocrecipes.com` on Railway                                                                                                                                                                                                                                                                                                                                                                                                       |

## 10. AI assistants (M7) and assistant spending (M8)

### 10.1 MCP + OAuth (M7)

- `/mcp` (Streamable HTTP) inside the API, same storage layer.
- **OAuth 2.1 authorization server** per the MCP authorization spec (2026-07-28): protected-resource metadata (RFC 9728), authorization-server metadata, **PKCE required**, `resource` indicator (RFC 8707) — tokens valid only for `https://api.ocrecipes.com/mcp`; client identity via **Client ID Metadata Documents**, dynamic registration as fallback; validate `iss`.
- Use an established library (candidates: MCP TypeScript SDK auth helpers, `oidc-provider`) — decided in planning against the spec. No hand-rolled OAuth.
- **Consent page** on the web app lists each permission on its own line.
- **Tokens:** opaque random, stored **hashed**; access 1 h; rotating refresh tokens (reuse of a rotated refresh token revokes the grant).
- **Scopes:** `recipes:read`, `cookbooks:read`, `cookbooks:write`, `exports:create`, `orders:create` (off by default).
- **"Connected assistants" page:** list, revoke, set limits. Sign-out-everywhere, password change and account deletion revoke all grants.
- **Tools v1:** `search_my_recipes`, `get_recipe`, `create_recipe`, `list_books`, `get_book`, `add_recipe_to_book` (revision-checked), `export_pdf` (returns a short-lived link). M8 adds `list_addresses`, `list_print_products`, `quote_print` (returns the exact price that `order_print` will charge, with a quote id) and `order_print` (takes the quote id).
- Tool output is data for the assistant; book text written by users is never treated as instructions by our server.

### 10.2 Assistant spending (M8, D11)

- **Saved card:** Stripe Customer per user; card saved via SetupIntent on the web; we store only Stripe ids + brand/last4.
- **Saved addresses only:** `order_print` takes an `addressId` from the user's saved addresses — an assistant cannot ship to a new address.
- **Limits per grant:** `per_order_limit_cents`, `monthly_limit_cents` (user-set, defaults e.g. $75 / $150). Checked and reserved **in one transaction** (`SELECT … FOR UPDATE` on the grant) so concurrent orders cannot exceed the limit.
- **Idempotency:** `order_print` requires an `idempotencyKey`; a retried call returns the same order.
- **Charge — authorize now, capture at submission:** an off-session PaymentIntent with `capture_method: manual` on the saved card at order time; captured when the hold window ends and the order is submitted. Cancelling in the window **voids** the authorization (no refund, no Stripe fee). If the bank requires authentication (SCA) → order `needs_authentication`; the tool returns a link for the user to approve; unpaid after 24 h → cancelled, reservation released.
- **Hold window:** a paid assistant order waits **60 minutes** before submission. The user gets an email receipt with a **Cancel** link that opens a page with a confirm button (cancellation happens on POST, never on GET — mail scanners click links; see `docs/solutions/logic-errors/emailed-link-that-acts-on-get-is-clicked-by-mail-scanners-2026-10-11.md`). Cancel in the window → authorization voided.
- Every order records `placed_by` (`web` | grant id) for disputes and the admin page.
- **Threat model — prompt injection with a card behind it.** The dangerous input is text the assistant reads: a community recipe, an imported web page or a book note containing "order ten hardcovers". Our server cannot see or filter the assistant's reasoning, so the defences are on our side of the API: `orders:create` is off by default; **saved addresses only** (an injected order cannot ship to an attacker); **per-order and monthly caps**; the **60-minute hold** with an emailed cancel; `quote_print` + quote id, so an order matches a price the assistant was shown; and every assistant order is marked as such on the receipt. Worst case is bounded by the monthly cap and is cancellable.

## 11. Data model summary (new tables)

`cookbook_books`, `cookbook_exports`, `print_orders`, `webhook_events`, `promotions`, `link_clicks`, `shipping_addresses`, `payment_methods` (Stripe refs), `users.stripe_customer_id`, `oauth_clients`, `oauth_grants` (user, client, scopes, limits, revoked_at), `oauth_tokens` (hash, grant, kind, expires_at, rotated_from), `assistant_spend` (grant, order, amount, month). Migrations are numbered in planning; each is checked on prod with `to_regclass` before merge.

## 12. Build order

| Stage  | Scope                                                                                                                                                                                                                                                             | Review                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **M0** | **Order sample prints from Lulu and Prodigi** using a hand-made PDF (from Claude Design) → choose the printer and book size; `web/` Astro app on Cloudflare + CI (typecheck, build); `WEB_ORIGIN`; `CookbookDocument` schema; `cookbook_books` migration + routes | server                |
| **M1** | Web sign-in (§9)                                                                                                                                                                                                                                                  | **security**          |
| **M2** | Editor v1 (§5), one style                                                                                                                                                                                                                                         | mobile/UI             |
| **M3** | Renderer, queue, digital PDF with footer + last page, private R2, 30-day expiry                                                                                                                                                                                   | server                |
| **M4** | Three styles from Claude Design; print bundle for the chosen printer; landing page with sample books                                                                                                                                                              | —                     |
| **M5** | Print orders on the web (§7) + admin page                                                                                                                                                                                                                         | **security** + server |
| **M6** | Phone: "Add to a book…", view/share PDFs                                                                                                                                                                                                                          | mobile                |
| **M7** | MCP + OAuth (§10.1)                                                                                                                                                                                                                                               | **security**          |
| **M8** | Assistant spending (§10.2)                                                                                                                                                                                                                                        | **security**          |

M1 precedes M2: every later stage needs a signed-in browser. Each stage is its own plan and PR series.

**This is an umbrella spec.** M0, M2 and M3 can be planned from it directly. **M1 (web sign-in), M5 (print orders), M7 (OAuth/MCP) and M8 (assistant spending) each get their own design spec first** — they carry the auth and payment risk and need more than the bullets here. Until M0's sample prints settle the printer, `format.size` uses a provisional size confirmed to exist in both catalogues.

## 13. Errors and testing

**Errors** are listed per section (§5 autosave, §6.2 renders, §7 orders, §10.2 SCA/limits). Common rule: nothing fails silently — user-visible state + Sentry.

**Testing (TDD):**

- Document schema: valid/invalid fixtures; v1→v2 upgrade.
- Book routes: owner-only access (IDOR), 409 on stale revision, size limits.
- Renderer golden tests on fixture books: page count, page size, bleed present only on print, **fonts embedded**, footer present on digital and absent on print, colophon present on print.
- Print/payments: recorded provider responses; Stripe signature verification; duplicate and out-of-order webhooks; price never taken from the client.
- OAuth/MCP negative cases: wrong audience, expired, revoked, rotated-refresh reuse, missing PKCE, missing scope.
- Spending: limit race (two concurrent orders), idempotency replay, SCA path, cancel-in-window void, unsaved address rejected, `order_print` with a stale or foreign quote id rejected.
- Renderer: a fixture book with Vietnamese, Arabic and CJK text renders with no missing glyphs; a style missing a glyph fails the export by name; render quota and one-in-flight-per-book enforced.

## 14. Open questions

1. **Brand:** launch under OCRecipes or as its own app? (Nothing above depends on it.)
2. **Printer:** Lulu vs Prodigi — decided by sample prints in M4; sets `format.size` options.
3. **Markup:** flat, percent, or both; and the default assistant spending limits.
4. **PDF retention (proposed default, not yet confirmed):** keep finished PDFs 30 days, then delete; re-download re-renders.
5. **Recipe provenance marker:** generated recipes carry `authorId = user` and are logged in two different tables, so "is this an OCRecipes-written recipe?" isn't one clean query. Decide in M0 whether to add an `origin` column to community recipes.
6. **Phone ordering:** v1 orders on the web only; whether the phone gets native print checkout later (physical goods → Stripe allowed in-app).

7. **Spoonacular → inspired recipes (owner ruling 2026-10-12, decided in this brainstorm):** Spoonacular is for discovery only. "Save" on a Spoonacular result is replaced by **"Make my version"**: OCRecipes generates its own recipe from the **title + the user's preferences only** (never Spoonacular's stored ingredients/steps), and that is what gets saved — OCRecipes-authored, so cookbook-eligible. Existing full copies (`sourceType: "catalog"`) are removed. This is a separate change that must land before books accept `ocrecipes` recipes. Existing community recipes are all AI-generated (owner, 2026-10-12), so they count as `ocrecipes`.
8. **Owner to-dos (accounts and setup):** Stripe account (+ Stripe Tax); Apple Services ID with domain verification; Lulu and Prodigi accounts; Cloudflare project for `app.ocrecipes.com`; add the `web/` checks to `main`'s required checks when its CI lands.

### Legal and data prerequisites

- **Terms of Service:** no change needed for books — they only contain the user's own recipes and OCRecipes-authored ones (§4). Re-check if eligibility ever widens.
- **Privacy policy + data inventory (before M5/M7):** new categories — shipping addresses, Stripe customer/payment references, print providers as recipients, and **third-party AI assistant providers as data recipients** once a user connects one.
- **Retention:** add `cookbook_exports`, `print_orders`, `shipping_addresses`, `oauth_tokens` and `link_clicks` to the existing retention-cleanup flow.

## 15. Out of scope (v1)

Self-publishing/ISBNs; drag-anywhere freeform pages; card handwriting transcription; collaborative editing by several people; EmDash marketing site; in-app (phone) editing.

## 16. References

Research from the 2026-10-12 brainstorm: EmDash (github.com/emdash-cms/emdash, Cloudflare blog), Payload custom auth strategies (payloadcms.com/docs/authentication/custom-strategies), Puck (MIT), Paged.js (pagedjs.org), Lulu PDF specs (help.api.lulu.com), Prodigi/Peecho print API, MCP authorization spec 2026-07-28, Astro (acquired by Cloudflare Jan 2026, MIT).
