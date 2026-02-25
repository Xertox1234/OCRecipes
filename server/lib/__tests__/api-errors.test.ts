import { sendError } from "../api-errors";

describe("API Errors", () => {
  describe("sendError", () => {
    function createMockResponse() {
      const res: any = {};
      res.status = vi.fn().mockReturnValue(res);
      res.json = vi.fn().mockReturnValue(res);
      return res;
    }

    it("sends error with status code and message", () => {
      const res = createMockResponse();
      sendError(res, 400, "Invalid input");

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "Invalid input" });
    });

    it("includes code when provided", () => {
      const res = createMockResponse();
      sendError(res, 403, "Premium required", "PREMIUM_REQUIRED");

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: "Premium required",
        code: "PREMIUM_REQUIRED",
      });
    });

    it("omits code when not provided", () => {
      const res = createMockResponse();
      sendError(res, 404, "Not found");

      const jsonArg = res.json.mock.calls[0][0];
      expect(jsonArg).not.toHaveProperty("code");
    });

    it("handles 500 internal server error", () => {
      const res = createMockResponse();
      sendError(res, 500, "Internal server error");

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Internal server error",
      });
    });

    it("handles 401 unauthorized", () => {
      const res = createMockResponse();
      sendError(res, 401, "Unauthorized", "AUTH_REQUIRED");

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Unauthorized",
        code: "AUTH_REQUIRED",
      });
    });

    it("handles 429 rate limited", () => {
      const res = createMockResponse();
      sendError(res, 429, "Too many requests", "RATE_LIMITED");

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        error: "Too many requests",
        code: "RATE_LIMITED",
      });
    });
  });
});
