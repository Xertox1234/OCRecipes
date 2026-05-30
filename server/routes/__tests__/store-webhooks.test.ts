import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import {
  handleAppleNotification,
  handleGoogleNotification,
  verifyGooglePushToken,
} from "../../services/store-notifications";
import { register } from "../store-webhooks";

vi.mock("../../services/store-notifications", () => ({
  handleAppleNotification: vi.fn(),
  handleGoogleNotification: vi.fn(),
  verifyGooglePushToken: vi.fn(),
}));
vi.mock("express-rate-limit");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("Store webhooks — Apple", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it("acks 200 and forwards the signed payload on a valid notification", async () => {
    vi.mocked(handleAppleNotification).mockResolvedValue(undefined);

    const res = await request(app)
      .post("/webhooks/apple/notifications")
      .send({ signedPayload: "jws-token" });

    expect(res.status).toBe(200);
    expect(handleAppleNotification).toHaveBeenCalledWith("jws-token");
  });

  it("rejects 400 when signedPayload is missing (no processing)", async () => {
    const res = await request(app)
      .post("/webhooks/apple/notifications")
      .send({});

    expect(res.status).toBe(400);
    expect(handleAppleNotification).not.toHaveBeenCalled();
  });

  it("returns 5xx so Apple retries when processing/verification fails", async () => {
    vi.mocked(handleAppleNotification).mockRejectedValue(
      new Error("verification failed"),
    );

    const res = await request(app)
      .post("/webhooks/apple/notifications")
      .send({ signedPayload: "jws-token" });

    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});

describe("Store webhooks — Google RTDN", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it("acks 200 and processes when the Pub/Sub OIDC token is valid", async () => {
    vi.mocked(verifyGooglePushToken).mockResolvedValue(true);
    vi.mocked(handleGoogleNotification).mockResolvedValue(undefined);

    const res = await request(app)
      .post("/webhooks/google/rtdn")
      .set("Authorization", "Bearer valid")
      .send({ message: { data: "eyJ9" } });

    expect(res.status).toBe(200);
    expect(handleGoogleNotification).toHaveBeenCalled();
  });

  it("rejects 401 when the Pub/Sub OIDC token is invalid (no processing)", async () => {
    vi.mocked(verifyGooglePushToken).mockResolvedValue(false);

    const res = await request(app)
      .post("/webhooks/google/rtdn")
      .send({ message: { data: "eyJ9" } });

    expect(res.status).toBe(401);
    expect(handleGoogleNotification).not.toHaveBeenCalled();
  });
});
