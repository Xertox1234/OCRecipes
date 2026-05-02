import { recognizeTextFromPhoto } from "../recognizeTextFromPhoto";

const mockRecognize = vi.hoisted(() => vi.fn());

vi.mock("@react-native-ml-kit/text-recognition", () => ({
  default: { recognize: mockRecognize },
}));

describe("recognizeTextFromPhoto", () => {
  beforeEach(() => {
    mockRecognize.mockReset();
  });

  it("returns full text and mapped blocks on success", async () => {
    mockRecognize.mockResolvedValue({
      text: "Calories 250\nProtein 10g",
      blocks: [{ text: "Calories 250" }, { text: "Protein 10g" }],
    });

    const result = await recognizeTextFromPhoto("file:///tmp/photo.jpg");

    expect(result.text).toBe("Calories 250\nProtein 10g");
    expect(result.blocks).toEqual([
      { text: "Calories 250" },
      { text: "Protein 10g" },
    ]);
    expect(mockRecognize).toHaveBeenCalledWith("file:///tmp/photo.jpg");
  });

  it("returns empty text and empty blocks for a blank image", async () => {
    mockRecognize.mockResolvedValue({ text: "", blocks: [] });

    const result = await recognizeTextFromPhoto("file:///tmp/blank.jpg");

    expect(result.text).toBe("");
    expect(result.blocks).toHaveLength(0);
  });

  it("propagates errors thrown by the native module", async () => {
    mockRecognize.mockRejectedValue(new Error("Native MLKit failure"));

    await expect(recognizeTextFromPhoto("file:///tmp/bad.jpg")).rejects.toThrow(
      "Native MLKit failure",
    );
  });
});
