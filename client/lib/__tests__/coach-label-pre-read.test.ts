import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  labelFromOCRText,
  preReadLabel,
  sendLabelToCoach,
} from "../coach-label-pre-read";

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));
vi.mock("@/lib/timezone", () => ({
  getDeviceTimezone: () => "America/Toronto",
}));

const LABEL = `Nutrition Facts
Serving Size 1 cup (228g)
Servings Per Container 2
Calories 250
Total Fat 12g
  Saturated Fat 3g
Cholesterol 30mg
Sodium 470mg
Total Carbohydrate 31g
  Dietary Fiber 0g
  Total Sugars 5g
Protein 5g`;

describe("labelFromOCRText", () => {
  it("reads a clear nutrition panel into the four numbers and the serving", () => {
    expect(labelFromOCRText(LABEL)).toEqual({
      calories: 250,
      protein: 5,
      carbs: 31,
      fat: 12,
      servingSize: "1 cup (228g)",
    });
  });

  it("reads a Canadian panel's header and per-serving line", () => {
    const text = `Nutrition Facts / Valeur nutritive
Per 1 cup (250 mL)
Calories 110
Fat / Lipides 0g
Carbohydrate / Glucides 26g
Protein / Protéines 2g`;
    const read = labelFromOCRText(text);
    expect(read?.calories).toBe(110);
    expect(read?.servingSize).toMatch(/250 mL/);
  });

  it("refuses text with no nutrition panel heading (a menu, a receipt)", () => {
    expect(labelFromOCRText(LABEL.replace("Nutrition Facts\n", ""))).toBeNull();
  });

  it.each([
    ["calories", "Calories 250\n"],
    ["protein", "Protein 5g"],
    ["carbs", "Total Carbohydrate 31g\n"],
    ["fat", "Total Fat 12g\n"],
  ])("refuses a panel whose %s could not be read", (_field, line) => {
    expect(labelFromOCRText(LABEL.replace(line, ""))).toBeNull();
  });

  it("refuses a panel whose serving has no gram or millilitre amount", () => {
    expect(labelFromOCRText(LABEL.replace("1 cup (228g)", "1 cup"))).toBeNull();
  });

  it("refuses a number whose unit was misread (a g read as a 9)", () => {
    // "12 9" could be 12 g or a lost "%": not a number to log from.
    expect(
      labelFromOCRText(LABEL.replace("Total Fat 12g", "Total Fat 12 9")),
    ).toBeNull();
  });

  it("refuses numbers that do not add up (a digit misread or dropped)", () => {
    // 5 g protein, 31 g carbs and 12 g fat make about 250 kcal, not 20.
    expect(
      labelFromOCRText(LABEL.replace("Calories 250", "Calories 20")),
    ).toBeNull();
    expect(
      labelFromOCRText(LABEL.replace("Total Fat 12g", "Total Fat 2g")),
    ).toBeNull();
  });

  it("allows the drift fibre and rounding give a real label", () => {
    // 4×5 + 4×31 + 9×12 = 252 against a printed 230.
    expect(
      labelFromOCRText(LABEL.replace("Calories 250", "Calories 230"))?.calories,
    ).toBe(230);
  });

  // Nutrition review: carbs that are mostly fibre make far less than 4 kcal
  // a gram; a correct label must still be read on the phone.
  it("reads a high-fibre cereal whose carbs make less than 4 kcal a gram", () => {
    const text = `Nutrition Facts
Serving Size 1/2 cup (30g)
Calories 60
Total Fat 1g
Total Carbohydrate 25g
  Dietary Fiber 14g
Protein 2g`;
    expect(labelFromOCRText(text)?.calories).toBe(60);
  });

  it("reads a zero-calorie drink", () => {
    const text = `Nutrition Facts
Serving Size 1 can (355 mL)
Calories 0
Total Fat 0g
Sodium 40mg
Total Carbohydrate 0g
Protein 0g`;
    expect(labelFromOCRText(text)).toMatchObject({ calories: 0, fat: 0 });
  });

  it("refuses a number the food card could not hold", () => {
    const text = `Nutrition Facts
Serving Size 1 tub (1000g)
Calories 5600
Total Fat 600g
Total Carbohydrate 10g
Protein 50g`;
    expect(labelFromOCRText(text)).toBeNull();
  });

  it("refuses empty text", () => {
    expect(labelFromOCRText("")).toBeNull();
  });
});

describe("preReadLabel", () => {
  it("reads the photo's text on the phone and checks it", async () => {
    const recognize = vi.fn().mockResolvedValue({ text: LABEL });
    const read = await preReadLabel("file:///p.jpg", recognize);
    expect(recognize).toHaveBeenCalledWith("file:///p.jpg");
    expect(read?.calories).toBe(250);
  });

  it("gives null when the phone cannot read text (no reader in this build)", async () => {
    const recognize = vi.fn().mockRejectedValue(new Error("no native module"));
    expect(await preReadLabel("file:///p.jpg", recognize)).toBeNull();
  });

  it("gives null, so the photo uploads, when the reader never answers", async () => {
    vi.useFakeTimers();
    try {
      const recognize = vi.fn().mockReturnValue(new Promise(() => {}));
      const read = preReadLabel("file:///p.jpg", recognize);
      await vi.advanceTimersByTimeAsync(5000);
      await expect(read).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives null for a photo that is not a label", async () => {
    const recognize = vi.fn().mockResolvedValue({ text: "A plate of pasta" });
    expect(await preReadLabel("file:///p.jpg", recognize)).toBeNull();
  });
});

describe("sendLabelToCoach", () => {
  const read = {
    calories: 250,
    protein: 5,
    carbs: 31,
    fat: 12,
    servingSize: "1 cup (228g)",
  };

  beforeEach(() => vi.clearAllMocks());

  it("posts only the numbers to the conversation, with the user's timezone, and returns the reply", async () => {
    mockApiRequest.mockResolvedValue({
      json: () =>
        Promise.resolve({ assistantMessage: { content: "I read it." } }),
    });
    const text = await sendLabelToCoach(read, 7, "full");
    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/chat/conversations/7/label",
      { label: read, openingBrief: "full" },
      { headers: { "X-Timezone": "America/Toronto" } },
    );
    expect(text).toBe("I read it.");
  });

  it("sends no brief field when no brief was shown, and gives null for an unreadable answer", async () => {
    mockApiRequest.mockResolvedValue({
      json: () => Promise.reject(new Error("bad json")),
    });
    await expect(sendLabelToCoach(read, 7)).resolves.toBeNull();
    expect(mockApiRequest.mock.calls[0][2]).toEqual({ label: read });
  });

  it("rejects when the server refuses the turn", async () => {
    mockApiRequest.mockRejectedValue(new Error("429: limit"));
    await expect(sendLabelToCoach(read, 7)).rejects.toThrow("429");
  });
});
