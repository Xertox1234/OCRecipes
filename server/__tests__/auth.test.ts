import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = "test-jwt-secret";

// Mock storage for tokenVersion verification
const mockGetUser = vi.fn();
vi.mock("../storage", () => ({
  storage: {
    getUser: (...args: unknown[]) => mockGetUser(...args),
  },
}));

// Mock the auth module to control JWT_SECRET
vi.mock("../middleware/auth", async () => {
  const jwtModule = await import("jsonwebtoken");
  const { isAccessTokenPayload } = await import("@shared/types/auth");
  const { storage } = await import("../storage");
  const JWT_SECRET = "test-jwt-secret";

  async function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "No token provided", code: "NO_TOKEN" });
      return;
    }

    const token = authHeader.slice(7);

    try {
      const payload = jwtModule.default.verify(token, JWT_SECRET);

      if (!isAccessTokenPayload(payload)) {
        res
          .status(401)
          .json({ error: "Invalid token payload", code: "TOKEN_INVALID" });
        return;
      }

      // Verify tokenVersion against database
      const user = await storage.getUser(payload.sub);
      if (!user) {
        res
          .status(401)
          .json({ error: "User not found", code: "TOKEN_INVALID" });
        return;
      }

      if (payload.tokenVersion !== user.tokenVersion) {
        res
          .status(401)
          .json({ error: "Token has been revoked", code: "TOKEN_REVOKED" });
        return;
      }

      (req as any).userId = payload.sub;
      next();
    } catch (err) {
      if (err instanceof jwtModule.default.TokenExpiredError) {
        res
          .status(401)
          .json({ error: "Token expired", code: "TOKEN_EXPIRED" });
        return;
      }
      res.status(401).json({ error: "Invalid token", code: "TOKEN_INVALID" });
    }
  }

  function generateToken(userId: string, tokenVersion: number): string {
    return jwtModule.default.sign({ sub: userId, tokenVersion }, JWT_SECRET, {
      expiresIn: "7d",
    });
  }

  return { requireAuth, generateToken };
});

const { requireAuth, generateToken } = await import("../middleware/auth");

describe("Auth Middleware", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      headers: {},
    };
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
    mockGetUser.mockReset();
    // Default: user exists with tokenVersion 0
    mockGetUser.mockResolvedValue({ id: "user-123", tokenVersion: 0 });
  });

  describe("requireAuth", () => {
    it("returns 401 when no authorization header is provided", async () => {
      mockRequest.headers = {};

      await requireAuth(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: "No token provided",
        code: "NO_TOKEN",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("returns 401 when authorization header does not start with Bearer", async () => {
      mockRequest.headers = { authorization: "Basic sometoken" };

      await requireAuth(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: "No token provided",
        code: "NO_TOKEN",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("returns 401 when token is invalid", async () => {
      mockRequest.headers = { authorization: "Bearer invalid-token" };

      await requireAuth(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: "Invalid token",
        code: "TOKEN_INVALID",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("returns 401 when token payload is invalid (missing sub)", async () => {
      // Create a token without sub claim
      const invalidToken = jwt.sign({ foo: "bar" }, JWT_SECRET);
      mockRequest.headers = { authorization: `Bearer ${invalidToken}` };

      await requireAuth(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: "Invalid token payload",
        code: "TOKEN_INVALID",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("returns 401 when token payload is missing tokenVersion", async () => {
      // Create a token with sub but no tokenVersion
      const invalidToken = jwt.sign({ sub: "user-123" }, JWT_SECRET);
      mockRequest.headers = { authorization: `Bearer ${invalidToken}` };

      await requireAuth(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: "Invalid token payload",
        code: "TOKEN_INVALID",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("calls next and sets userId when token is valid and tokenVersion matches", async () => {
      const userId = "user-123";
      const validToken = jwt.sign(
        { sub: userId, tokenVersion: 0 },
        JWT_SECRET,
      );
      mockRequest.headers = { authorization: `Bearer ${validToken}` };
      mockGetUser.mockResolvedValue({ id: userId, tokenVersion: 0 });

      await requireAuth(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect((mockRequest as any).userId).toBe(userId);
      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it("returns 401 with TOKEN_REVOKED when tokenVersion does not match", async () => {
      const userId = "user-123";
      // Token has tokenVersion 0 but user has tokenVersion 1 (was incremented on logout)
      const validToken = jwt.sign(
        { sub: userId, tokenVersion: 0 },
        JWT_SECRET,
      );
      mockRequest.headers = { authorization: `Bearer ${validToken}` };
      mockGetUser.mockResolvedValue({ id: userId, tokenVersion: 1 });

      await requireAuth(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: "Token has been revoked",
        code: "TOKEN_REVOKED",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("returns 401 when user is not found in database", async () => {
      const validToken = jwt.sign(
        { sub: "deleted-user", tokenVersion: 0 },
        JWT_SECRET,
      );
      mockRequest.headers = { authorization: `Bearer ${validToken}` };
      mockGetUser.mockResolvedValue(undefined);

      await requireAuth(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: "User not found",
        code: "TOKEN_INVALID",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("returns 401 with TOKEN_EXPIRED when token is expired", async () => {
      const expiredToken = jwt.sign(
        { sub: "user-123", tokenVersion: 0 },
        JWT_SECRET,
        {
          expiresIn: "-1s",
        },
      );
      mockRequest.headers = { authorization: `Bearer ${expiredToken}` };

      await requireAuth(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: "Token expired",
        code: "TOKEN_EXPIRED",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe("generateToken", () => {
    it("generates a valid JWT token with user ID and tokenVersion", () => {
      const userId = "user-456";
      const token = generateToken(userId, 0);

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");

      const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
      expect(decoded.sub).toBe(userId);
      expect(decoded.tokenVersion).toBe(0);
    });

    it("generates token with 7 day expiration", () => {
      const token = generateToken("user-789", 0);
      const decoded = jwt.decode(token) as jwt.JwtPayload;

      expect(decoded.exp).toBeDefined();
      const now = Math.floor(Date.now() / 1000);
      const sevenDaysInSeconds = 7 * 24 * 60 * 60;

      // Check expiration is roughly 7 days from now (within 60 seconds tolerance)
      expect(decoded.exp! - now).toBeGreaterThan(sevenDaysInSeconds - 60);
      expect(decoded.exp! - now).toBeLessThanOrEqual(sevenDaysInSeconds);
    });

    it("includes tokenVersion in the payload", () => {
      const token = generateToken("user-123", 5);
      const decoded = jwt.decode(token) as jwt.JwtPayload;

      expect(decoded.tokenVersion).toBe(5);
    });

    it("generates tokens with same payload content for same user and version", () => {
      const token1 = generateToken("user-1", 0);
      const token2 = generateToken("user-1", 0);

      const decoded1 = jwt.decode(token1) as jwt.JwtPayload;
      const decoded2 = jwt.decode(token2) as jwt.JwtPayload;

      // Both tokens should have the same subject and tokenVersion
      expect(decoded1.sub).toBe(decoded2.sub);
      expect(decoded1.sub).toBe("user-1");
      expect(decoded1.tokenVersion).toBe(decoded2.tokenVersion);
    });

    it("generates different tokens for different users", () => {
      const token1 = generateToken("user-1", 0);
      const token2 = generateToken("user-2", 0);

      const decoded1 = jwt.decode(token1) as jwt.JwtPayload;
      const decoded2 = jwt.decode(token2) as jwt.JwtPayload;

      expect(decoded1.sub).toBe("user-1");
      expect(decoded2.sub).toBe("user-2");
      expect(decoded1.sub).not.toBe(decoded2.sub);
    });
  });
});
