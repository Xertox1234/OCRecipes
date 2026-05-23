import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import {
  requireAuth,
  generateToken,
  invalidateTokenVersionCache,
} from "../middleware/auth";
import { storage } from "../storage";

// Exercise the REAL requireAuth — mock only its storage dependency.
// A previous version mocked "../middleware/auth" itself with a hand-written
// reimplementation, so these tests passed against a copy that had drifted from
// production (it lacked the tokenVersion cache and issuer/audience checks).
// Never mock the module under test here. (vi.mock is hoisted above imports,
// so the storage import above still resolves to this mock.)
vi.mock("../storage", () => ({
  storage: { getUser: vi.fn() },
}));

const mockGetUser = vi.mocked(storage.getUser);

// JWT_SECRET is set by test/setup.ts before this module loads.
const JWT_SECRET = process.env.JWT_SECRET as string;
// Must match the private constants in server/middleware/auth.ts.
const JWT_ISSUER = "ocrecipes-api";
const JWT_AUDIENCE = "ocrecipes-client";

// Unique id per test so the middleware's process-local tokenVersion cache
// (module state, not reset between tests) cannot bleed across cases.
let userCounter = 0;
const nextUserId = () => `user-${++userCounter}`;

type DbUser = NonNullable<Awaited<ReturnType<typeof storage.getUser>>>;
const userRow = (id: string, tokenVersion: number): DbUser =>
  ({ id, tokenVersion }) as unknown as DbUser;

function signToken(
  payload: Record<string, unknown>,
  opts: jwt.SignOptions = {},
): string {
  return jwt.sign(payload, JWT_SECRET, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    ...opts,
  });
}

function makeReq(authorization?: string): Request {
  return {
    headers: authorization ? { authorization } : {},
  } as unknown as Request;
}

function makeRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

const callAuth = (req: Request, res: ReturnType<typeof makeRes>) => {
  const next = vi.fn();
  return {
    next,
    promise: requireAuth(req, res as unknown as Response, next as NextFunction),
  };
};

describe("Auth Middleware", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockGetUser.mockResolvedValue(userRow("default-user", 0));
  });

  describe("requireAuth — header validation", () => {
    it("returns 401 NO_TOKEN when no authorization header is provided", async () => {
      const res = makeRes();
      const { next, promise } = callAuth(makeReq(), res);
      await promise;

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "No token provided",
        code: "NO_TOKEN",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 NO_TOKEN when the header does not start with Bearer", async () => {
      const res = makeRes();
      const { next, promise } = callAuth(makeReq("Basic sometoken"), res);
      await promise;

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "No token provided",
        code: "NO_TOKEN",
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("requireAuth — token signature, issuer & audience", () => {
    it("returns 401 TOKEN_INVALID for a malformed token", async () => {
      const res = makeRes();
      const { next, promise } = callAuth(makeReq("Bearer not-a-jwt"), res);
      await promise;

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Invalid token",
        code: "TOKEN_INVALID",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("rejects a token signed with the wrong issuer", async () => {
      const token = jwt.sign(
        { sub: nextUserId(), tokenVersion: 0 },
        JWT_SECRET,
        { issuer: "evil-issuer", audience: JWT_AUDIENCE },
      );
      const res = makeRes();
      const { next, promise } = callAuth(makeReq(`Bearer ${token}`), res);
      await promise;

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Invalid token",
        code: "TOKEN_INVALID",
      });
      expect(next).not.toHaveBeenCalled();
      // Real module enforces issuer; storage is never consulted.
      expect(mockGetUser).not.toHaveBeenCalled();
    });

    it("rejects a token signed with the wrong audience", async () => {
      const token = jwt.sign(
        { sub: nextUserId(), tokenVersion: 0 },
        JWT_SECRET,
        { issuer: JWT_ISSUER, audience: "evil-audience" },
      );
      const res = makeRes();
      const { next, promise } = callAuth(makeReq(`Bearer ${token}`), res);
      await promise;

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Invalid token",
        code: "TOKEN_INVALID",
      });
      expect(next).not.toHaveBeenCalled();
      expect(mockGetUser).not.toHaveBeenCalled();
    });

    it("returns 401 TOKEN_EXPIRED for an expired token", async () => {
      const token = signToken(
        { sub: nextUserId(), tokenVersion: 0 },
        { expiresIn: "-1s" },
      );
      const res = makeRes();
      const { next, promise } = callAuth(makeReq(`Bearer ${token}`), res);
      await promise;

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Token expired",
        code: "TOKEN_EXPIRED",
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("requireAuth — payload validation", () => {
    it("returns 401 TOKEN_INVALID when sub is missing", async () => {
      const token = signToken({ foo: "bar" });
      const res = makeRes();
      const { next, promise } = callAuth(makeReq(`Bearer ${token}`), res);
      await promise;

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Invalid token payload",
        code: "TOKEN_INVALID",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 TOKEN_INVALID when tokenVersion is missing", async () => {
      const token = signToken({ sub: nextUserId() });
      const res = makeRes();
      const { next, promise } = callAuth(makeReq(`Bearer ${token}`), res);
      await promise;

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Invalid token payload",
        code: "TOKEN_INVALID",
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("requireAuth — DB lookup path (cache miss)", () => {
    it("calls next and sets userId for a valid token whose version matches", async () => {
      const userId = nextUserId();
      mockGetUser.mockResolvedValue(userRow(userId, 0));
      const req = makeReq(`Bearer ${generateToken(userId, 0)}`);
      const res = makeRes();
      const { next, promise } = callAuth(req, res);
      await promise;

      expect(req.userId).toBe(userId);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(mockGetUser).toHaveBeenCalledTimes(1);
    });

    it("returns 401 TOKEN_INVALID when the user no longer exists", async () => {
      const userId = nextUserId();
      mockGetUser.mockResolvedValue(undefined);
      const res = makeRes();
      const { next, promise } = callAuth(
        makeReq(`Bearer ${generateToken(userId, 0)}`),
        res,
      );
      await promise;

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "User not found",
        code: "TOKEN_INVALID",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 TOKEN_REVOKED when the DB tokenVersion is newer", async () => {
      const userId = nextUserId();
      mockGetUser.mockResolvedValue(userRow(userId, 1));
      const res = makeRes();
      const { next, promise } = callAuth(
        makeReq(`Bearer ${generateToken(userId, 0)}`),
        res,
      );
      await promise;

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Token has been revoked",
        code: "TOKEN_REVOKED",
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("requireAuth — tokenVersion cache", () => {
    it("serves the second request from cache without a second DB lookup", async () => {
      const userId = nextUserId();
      mockGetUser.mockResolvedValue(userRow(userId, 0));
      const token = generateToken(userId, 0);

      const first = callAuth(makeReq(`Bearer ${token}`), makeRes());
      await first.promise;
      expect(mockGetUser).toHaveBeenCalledTimes(1);
      expect(first.next).toHaveBeenCalled();

      const second = callAuth(makeReq(`Bearer ${token}`), makeRes());
      await second.promise;
      expect(mockGetUser).toHaveBeenCalledTimes(1); // still 1 — served from cache
      expect(second.next).toHaveBeenCalled();
    });

    it("rejects from cache with TOKEN_REVOKED when a newer token version arrives", async () => {
      const userId = nextUserId();
      mockGetUser.mockResolvedValue(userRow(userId, 0));

      // Prime the cache with version 0.
      const prime = callAuth(
        makeReq(`Bearer ${generateToken(userId, 0)}`),
        makeRes(),
      );
      await prime.promise;
      expect(mockGetUser).toHaveBeenCalledTimes(1);

      // A token claiming version 1 is rejected against the cached 0 — no new DB hit.
      const res = makeRes();
      const { next, promise } = callAuth(
        makeReq(`Bearer ${generateToken(userId, 1)}`),
        res,
      );
      await promise;

      expect(mockGetUser).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Token has been revoked",
        code: "TOKEN_REVOKED",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("invalidateTokenVersionCache forces a fresh DB lookup", async () => {
      const userId = nextUserId();
      mockGetUser.mockResolvedValue(userRow(userId, 0));
      const token = generateToken(userId, 0);

      await callAuth(makeReq(`Bearer ${token}`), makeRes()).promise;
      expect(mockGetUser).toHaveBeenCalledTimes(1);

      invalidateTokenVersionCache(userId);

      await callAuth(makeReq(`Bearer ${token}`), makeRes()).promise;
      expect(mockGetUser).toHaveBeenCalledTimes(2); // cache cleared → re-read
    });
  });

  describe("generateToken", () => {
    it("signs a verifiable token with sub, tokenVersion, issuer and audience", () => {
      const userId = nextUserId();
      const token = generateToken(userId, 0);

      const decoded = jwt.verify(token, JWT_SECRET, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      }) as jwt.JwtPayload;

      expect(decoded.sub).toBe(userId);
      expect(decoded.tokenVersion).toBe(0);
    });

    it("sets a 7 day expiration", () => {
      const token = generateToken(nextUserId(), 0);
      const decoded = jwt.decode(token) as jwt.JwtPayload;

      const now = Math.floor(Date.now() / 1000);
      const sevenDaysInSeconds = 7 * 24 * 60 * 60;
      expect(decoded.exp! - now).toBeGreaterThan(sevenDaysInSeconds - 60);
      expect(decoded.exp! - now).toBeLessThanOrEqual(sevenDaysInSeconds);
    });

    it("embeds the provided tokenVersion", () => {
      const token = generateToken(nextUserId(), 5);
      const decoded = jwt.decode(token) as jwt.JwtPayload;
      expect(decoded.tokenVersion).toBe(5);
    });
  });
});
