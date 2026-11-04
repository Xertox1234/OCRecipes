import { withFeatureChip } from "../coach-feature-chip";

const server = ["How was my day?", "What should I eat next?"];

describe("withFeatureChip", () => {
  it("adds one feature chip for an unused feature", () => {
    expect(withFeatureChip(server, () => false)).toEqual([
      ...server,
      "Help me import a recipe",
    ]);
  });

  it("suggests receipt scanning once import is used", () => {
    expect(withFeatureChip(server, (f) => f === "import")).toEqual([
      ...server,
      "Help me scan a receipt",
    ]);
  });

  it("adds no feature chip when both are used", () => {
    expect(withFeatureChip(server, () => true)).toEqual(server);
  });

  it("never adds more than one feature chip", () => {
    const chips = withFeatureChip(server, () => false);
    expect(chips.filter((c) => c.startsWith("Help me"))).toHaveLength(1);
  });
});
