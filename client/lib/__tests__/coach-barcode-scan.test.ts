import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  awaitCoachBarcode,
  settleCoachBarcode,
  scannedProductCode,
  sendBarcodeToCoach,
} from "../coach-barcode-scan";

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));
vi.mock("@/lib/timezone", () => ({
  getDeviceTimezone: () => "America/Toronto",
}));

const LABEL = {
  calories: 120,
  protein: 3,
  carbs: 16,
  fat: 5,
  servingSize: "1 cup (240 ml)",
};

describe("awaitCoachBarcode / settleCoachBarcode", () => {
  beforeEach(() => settleCoachBarcode(null));

  it("resolves with the code the scanner read", async () => {
    const scanned = awaitCoachBarcode();
    settleCoachBarcode({ code: "4006381333931" });
    await expect(scanned).resolves.toEqual({ code: "4006381333931" });
  });

  it("resolves null when the scanner closes without a read", async () => {
    const scanned = awaitCoachBarcode();
    settleCoachBarcode(null);
    await expect(scanned).resolves.toBeNull();
  });

  it("settles once: a close after a read changes nothing", async () => {
    const scanned = awaitCoachBarcode();
    settleCoachBarcode({ code: "4006381333931" });
    settleCoachBarcode(null);
    await expect(scanned).resolves.toEqual({ code: "4006381333931" });
  });

  it("gives up an older wait when a new one starts", async () => {
    const first = awaitCoachBarcode();
    const second = awaitCoachBarcode();
    await expect(first).resolves.toBeNull();
    settleCoachBarcode({ code: "12345678" });
    await expect(second).resolves.toEqual({ code: "12345678" });
  });

  it("ignores a read nobody is waiting for", () => {
    expect(() => settleCoachBarcode({ code: "4006381333931" })).not.toThrow();
  });

  it("carries the label read in the scanner's label step", async () => {
    const scanned = awaitCoachBarcode();
    settleCoachBarcode({ code: "4006381333931", label: LABEL });
    await expect(scanned).resolves.toEqual({
      code: "4006381333931",
      label: LABEL,
    });
  });
});

describe("scannedProductCode", () => {
  it.each(["4006381333931", "012345678905", "12345678", "123456"])(
    "accepts the product code %s",
    (code) => {
      expect(scannedProductCode(code)).toBe(code);
    },
  );

  it("trims what the decoder hands over", () => {
    expect(scannedProductCode(" 4006381333931\n")).toBe("4006381333931");
  });

  it.each([
    "https://example.com/p/1",
    "ABC-123",
    "12345",
    "40063813339311234",
    "",
  ])("refuses %s (not a product barcode)", (data) => {
    expect(scannedProductCode(data)).toBeNull();
  });
});

describe("sendBarcodeToCoach", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts the code to the conversation with the user's timezone, and returns the reply", async () => {
    mockApiRequest.mockResolvedValue({
      json: () =>
        Promise.resolve({ assistantMessage: { content: "I found it." } }),
    });
    const text = await sendBarcodeToCoach("4006381333931", 7, "short");
    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/chat/conversations/7/barcode",
      { barcode: "4006381333931", openingBrief: "short" },
      { headers: { "X-Timezone": "America/Toronto" } },
    );
    expect(text).toBe("I found it.");
  });

  it("sends the label's numbers with the code when the label step read them", async () => {
    mockApiRequest.mockResolvedValue({ json: () => Promise.resolve({}) });
    await sendBarcodeToCoach("4006381333931", 7, undefined, LABEL);
    expect(mockApiRequest.mock.calls[0][2]).toEqual({
      barcode: "4006381333931",
      label: LABEL,
    });
  });

  it("sends no brief field when no brief was shown", async () => {
    mockApiRequest.mockResolvedValue({ json: () => Promise.resolve({}) });
    await sendBarcodeToCoach("4006381333931", 7);
    expect(mockApiRequest.mock.calls[0][2]).toEqual({
      barcode: "4006381333931",
    });
  });

  it("returns null, not an error, when the answer cannot be read", async () => {
    mockApiRequest.mockResolvedValue({
      json: () => Promise.reject(new Error("bad json")),
    });
    await expect(sendBarcodeToCoach("4006381333931", 7)).resolves.toBeNull();
  });

  it("rejects when the server refuses the turn", async () => {
    mockApiRequest.mockRejectedValue(new Error("429"));
    await expect(sendBarcodeToCoach("4006381333931", 7)).rejects.toThrow("429");
  });
});
