import { recognizeTextFromPhoto } from "../recognizeTextFromPhoto";

const mockRecognizeText = vi.hoisted(() => vi.fn());

// The package is ALSO aliased to test/mocks/ in vitest.config.ts, because it
// calls requireNativeModule() at module scope and would otherwise throw at
// import time in any suite that pulls in the @/camera barrel. That alias and
// this per-file vi.mock compose: vi.mock replaces whatever the resolver
// returns, so the factory below wins here. (Same pattern as
// useNetworkStatus.test.ts over the aliased @react-native-community/netinfo.)
vi.mock("@infinitered/react-native-mlkit-text-recognition", () => ({
  recognizeText: mockRecognizeText,
}));

describe("recognizeTextFromPhoto", () => {
  beforeEach(() => {
    mockRecognizeText.mockReset();
  });

  it("returns the recognized text on success", async () => {
    mockRecognizeText.mockResolvedValue({
      text: "Calories 250\nProtein 10g",
      blocks: [{ text: "Calories 250" }, { text: "Protein 10g" }],
    });

    const result = await recognizeTextFromPhoto("file:///tmp/photo.jpg");

    expect(result.text).toBe("Calories 250\nProtein 10g");
    expect(mockRecognizeText).toHaveBeenCalledWith("file:///tmp/photo.jpg");
  });

  it("returns empty text for a blank image", async () => {
    mockRecognizeText.mockResolvedValue({ text: "", blocks: [] });

    const result = await recognizeTextFromPhoto("file:///tmp/blank.jpg");

    expect(result.text).toBe("");
  });

  it("propagates errors thrown by the native module", async () => {
    mockRecognizeText.mockRejectedValue(new Error("Native MLKit failure"));

    await expect(recognizeTextFromPhoto("file:///tmp/bad.jpg")).rejects.toThrow(
      "Native MLKit failure",
    );
  });

  // The narrowing to LocalOCRResult is the whole reason swapping the OCR
  // library is a four-line change: no consumer can depend on block geometry
  // because it never escapes this wrapper. Pin that contract explicitly.
  it("returns only text, discarding the recognizer's block geometry", async () => {
    mockRecognizeText.mockResolvedValue({
      text: "Calories 250",
      blocks: [
        {
          text: "Calories 250",
          frame: { left: 0, top: 0, right: 100, bottom: 20 },
          recognizedLanguages: ["en"],
          lines: [],
        },
      ],
    });

    const result = await recognizeTextFromPhoto("file:///tmp/photo.jpg");

    expect(Object.keys(result)).toEqual(["text"]);
  });
});
