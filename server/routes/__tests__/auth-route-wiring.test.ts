import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

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
