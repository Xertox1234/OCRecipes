import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

import { storage } from "../../storage";
import { requireAuth, generateToken } from "../../middleware/auth";

// Route group registrars, mounted with the REAL requireAuth below.
import { register as registerProfile } from "../profile";
import { register as registerGoals } from "../goals";
import { register as registerGrocery } from "../grocery";
import { register as registerFavouriteRecipes } from "../favourite-recipes";
import { register as registerCookbooks } from "../cookbooks";
import { register as registerCarousel } from "../carousel";
import { register as registerExport } from "../export";
import { register as registerNotebook } from "../notebook";
import { register as registerSavedItems } from "../saved-items";

// ── Why this file exists ─────────────────────────────────────────────────────
// Every file under server/routes/__tests__ does `vi.mock("../../middleware/auth")`,
// which swaps requireAuth for a no-op that just sets req.userId and calls next().
// That is correct for handler-logic tests, but it means the WIRING SEAM — that a
// route is actually registered *behind* requireAuth, and that a real token
// composes through Express into the handler — is exercised by nothing. A new
// route that forgot requireAuth would pass every existing test while shipping an
// open endpoint. This file closes that gap by mounting real route groups through
// the real middleware. It deliberately does NOT mock "../../middleware/auth".
//
// Mirrors server/__tests__/auth.test.ts: exercise the real middleware and mock
// only its storage dependency (the tokenVersion lookup). The vi.mock factory is
// hoisted above the imports, so the `storage` import above resolves to this mock.
vi.mock("../../storage", () => ({
  storage: { getUser: vi.fn() },
}));

// Pass-through rate limiter (root __mocks__/express-rate-limit.ts) so a single
// request can never trip a limiter and the shared limiter store can't pollute
// the run — the known real-limiter store-pollution flake (todos archive #462).
vi.mock("express-rate-limit");

const mockGetUser = vi.mocked(storage.getUser);

type DbUser = NonNullable<Awaited<ReturnType<typeof storage.getUser>>>;
const userRow = (id: string, tokenVersion: number): DbUser =>
  ({ id, tokenVersion }) as unknown as DbUser;

// Unique id per test so the middleware's process-local tokenVersion cache
// (module state, not reset between tests) cannot bleed across cases.
let userCounter = 0;
const nextUserId = () => `wiring-user-${++userCounter}`;

// One representative protected endpoint per route group, GET and POST. Each is
// mounted via its real register() and hit through the real requireAuth. Add a
// row when a new protected route group is introduced — the negative assertions
// fail-close, so a route that drifts out from behind auth is caught here.
type Method = "get" | "post";
const PROTECTED_ROUTES: readonly {
  group: string;
  register: (app: Express) => void;
  method: Method;
  path: string;
}[] = [
  {
    group: "profile",
    register: registerProfile,
    method: "get",
    path: "/api/user/dietary-profile",
  },
  {
    group: "goals",
    register: registerGoals,
    method: "get",
    path: "/api/goals",
  },
  {
    group: "grocery",
    register: registerGrocery,
    method: "get",
    path: "/api/meal-plan/grocery-lists",
  },
  {
    group: "favourite-recipes",
    register: registerFavouriteRecipes,
    method: "get",
    path: "/api/favourite-recipes",
  },
  {
    group: "cookbooks",
    register: registerCookbooks,
    method: "get",
    path: "/api/cookbooks",
  },
  {
    group: "carousel",
    register: registerCarousel,
    method: "get",
    path: "/api/carousel",
  },
  {
    group: "export",
    register: registerExport,
    method: "get",
    path: "/api/users/me/export",
  },
  {
    group: "notebook",
    register: registerNotebook,
    method: "get",
    path: "/api/coach/notebook",
  },
  {
    group: "saved-items",
    register: registerSavedItems,
    method: "get",
    path: "/api/saved-items",
  },
  // Mutation endpoints — the highest-risk routes to leave unprotected.
  {
    group: "saved-items",
    register: registerSavedItems,
    method: "post",
    path: "/api/saved-items",
  },
  {
    group: "favourite-recipes",
    register: registerFavouriteRecipes,
    method: "post",
    path: "/api/favourite-recipes/toggle",
  },
  {
    group: "cookbooks",
    register: registerCookbooks,
    method: "post",
    path: "/api/cookbooks",
  },
];

function appFor(register: (app: Express) => void): Express {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

// Build the request for a table row. An explicit branch (not a computed
// `agent[method]` index) keeps the supertest method call unambiguous for tsc.
function send(register: (app: Express) => void, method: Method, path: string) {
  const agent = request(appFor(register));
  return method === "get" ? agent.get(path) : agent.post(path);
}

describe("auth route wiring (real middleware)", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
  });

  describe("protected routes reject anonymous access", () => {
    // A missing/blank token is rejected before storage is ever consulted, so
    // these need no DB stub. If requireAuth were absent from the route, the
    // handler would run and return something other than 401 — failing the test.
    it.each(PROTECTED_ROUTES)(
      "$method $path with no token → 401 NO_TOKEN",
      async ({ register, method, path }) => {
        const res = await send(register, method, path);
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ code: "NO_TOKEN" });
        // storage.getUser is the tokenVersion lookup — never reached on a 401
        // that happens at header validation.
        expect(mockGetUser).not.toHaveBeenCalled();
      },
    );

    it.each(PROTECTED_ROUTES)(
      "$method $path with a malformed token → 401 TOKEN_INVALID",
      async ({ register, method, path }) => {
        const res = await send(register, method, path).set(
          "Authorization",
          "Bearer not-a-jwt",
        );
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ code: "TOKEN_INVALID" });
        expect(mockGetUser).not.toHaveBeenCalled();
      },
    );
  });

  // A probe route behind the SAME real requireAuth proves the positive path: a
  // valid token composes through Express (real header parsing, real res object,
  // next() chaining) into a handler with req.userId populated. The direct-call
  // unit test in server/__tests__/auth.test.ts cannot demonstrate this seam.
  describe("valid token composes through requireAuth into the handler", () => {
    function probeApp(): Express {
      const app = express();
      app.use(express.json());
      app.get("/__probe", requireAuth, (req, res) => {
        res.json({ userId: req.userId });
      });
      return app;
    }

    it("200 with req.userId set when the token version matches the DB", async () => {
      const userId = nextUserId();
      mockGetUser.mockResolvedValue(userRow(userId, 0));

      const res = await request(probeApp())
        .get("/__probe")
        .set("Authorization", `Bearer ${generateToken(userId, 0, true)}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId });
      expect(mockGetUser).toHaveBeenCalledWith(userId);
    });

    it("401 TOKEN_REVOKED when the DB tokenVersion is newer than the token", async () => {
      const userId = nextUserId();
      mockGetUser.mockResolvedValue(userRow(userId, 5));

      const res = await request(probeApp())
        .get("/__probe")
        .set("Authorization", `Bearer ${generateToken(userId, 0, true)}`);

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: "TOKEN_REVOKED" });
    });
  });
});

// ── Static guard: every protected route is registered behind requireAuth ──────
// The smoke matrix above proves the mechanism composes at runtime, but only for
// the routes it enumerates — and a matrix depends on humans remembering to add a
// row, the same lapse that forgets requireAuth in the first place. This static
// scan instead covers EVERY route module: it parses each app.<method>("/api…")
// registration and asserts requireAuth is in the middleware chain, unless the
// route is explicitly allow-listed as public. A new route that forgets
// requireAuth fails here on day one — the exact regression class the route-level
// tests (which mock auth) cannot catch.
//
// Scope: per-route `app.METHOD` registrations. The B2B public API
// (server/routes/public-api.ts) uses a different mechanism — an express.Router
// with `router.use(requireApiKey)` mounted at /api/v1 — and is intentionally out
// of scope (covered by the api-key-auth middleware tests).
describe("every protected route is registered behind requireAuth (static guard)", () => {
  // Vitest runs anchored at the project root (config-relative), so process.cwd()
  // resolves the route modules regardless of where the file lives.
  const ROUTES_DIR = path.join(process.cwd(), "server", "routes");

  // Routes that legitimately run WITHOUT requireAuth, each with the reason it is
  // exempt. Adding an entry is a conscious decision to expose a route; the
  // stale-entry test below fails if one no longer matches a real public route.
  const PUBLIC_ROUTES = new Map<string, string>([
    ["GET /api/v1/docs", "public API documentation"],
    ["POST /api/auth/register", "account creation — caller has no token yet"],
    ["POST /api/auth/login", "issues the token — caller has no token yet"],
    [
      "POST /api/auth/verify-email",
      "email verification — token carried in body",
    ],
    ["POST /api/auth/resend-verification", "pre-auth email resend"],
    [
      "POST /webhooks/apple/notifications",
      "Apple store webhook — JWS-verified",
    ],
    ["POST /webhooks/google/rtdn", "Google store webhook — signature-verified"],
  ]);

  // Parse every `app.<method>("/api…"|"/webhooks…")` registration and record
  // whether requireAuth appears in the lines between the call and the handler.
  function scanRoutes(): { key: string; file: string; hasAuth: boolean }[] {
    const out: { key: string; file: string; hasAuth: boolean }[] = [];
    const files = fs
      .readdirSync(ROUTES_DIR)
      .filter((f) => f.endsWith(".ts") && !f.startsWith("_"));
    for (const file of files) {
      const lines = fs
        .readFileSync(path.join(ROUTES_DIR, file), "utf8")
        .split("\n");
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/\bapp\.(get|post|put|patch|delete)\(/);
        if (!m) continue;
        const method = m[1].toUpperCase();
        let route: string | null = null;
        let windowText = "";
        // Collect from the registration line up to the handler body; the
        // middleware (incl. requireAuth) are listed in between.
        for (let j = i; j < Math.min(i + 12, lines.length); j++) {
          windowText += lines[j] + "\n";
          if (!route) {
            const p = lines[j].match(/["`](\/[^"`]+)["`]/);
            if (p) route = p[1];
          }
          if (/=>|async\s*\(/.test(lines[j])) break;
        }
        if (!route || !/^\/(api|webhooks)/.test(route)) continue;
        out.push({
          key: `${method} ${route}`,
          file,
          hasAuth: /\brequireAuth\b/.test(windowText),
        });
      }
    }
    return out;
  }

  const routes = scanRoutes();

  it("scans a sane number of routes (a broken parser must not pass vacuously)", () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it("no protected route is missing requireAuth", () => {
    const offenders = routes
      .filter((r) => !r.hasAuth && !PUBLIC_ROUTES.has(r.key))
      .map((r) => `${r.key}  (${r.file})`);
    expect(offenders).toEqual([]);
  });

  it("the public-route allowlist has no stale entries", () => {
    const publicKeysSeen = new Set(
      routes.filter((r) => !r.hasAuth).map((r) => r.key),
    );
    const stale = [...PUBLIC_ROUTES.keys()].filter(
      (k) => !publicKeysSeen.has(k),
    );
    expect(stale).toEqual([]);
  });
});
