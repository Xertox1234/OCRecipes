import * as Haptics from "expo-haptics";
import {
  getConfidenceTier,
  getConfidenceColor,
  getConfidenceLabel,
  getConfidenceHapticType,
} from "../confidence";

// Define theme colors inline to avoid importing react-native via theme.ts
const lightThemeColors = {
  success: "#007A30",
  warning: "#F57C00",
  error: "#D32F2F",
} as any;

const darkThemeColors = {
  success: "#4CAF7D",
  warning: "#FFB74D",
  error: "#F16360",
} as any;

describe("getConfidenceTier", () => {
  it("returns high at and above 0.8", () => {
    expect(getConfidenceTier(1)).toBe("high");
    expect(getConfidenceTier(0.8)).toBe("high");
  });

  it("returns medium just below the high threshold", () => {
    expect(getConfidenceTier(0.79999)).toBe("medium");
  });

  it("returns medium at and above 0.5", () => {
    expect(getConfidenceTier(0.5)).toBe("medium");
    expect(getConfidenceTier(0.6)).toBe("medium");
  });

  it("returns low just below the medium threshold", () => {
    expect(getConfidenceTier(0.49999)).toBe("low");
  });

  it("returns low at the bottom of the range", () => {
    expect(getConfidenceTier(0)).toBe("low");
  });
});

describe("getConfidenceColor", () => {
  it("maps each tier to the matching theme color, light theme", () => {
    expect(getConfidenceColor(lightThemeColors, "high")).toBe("#007A30");
    expect(getConfidenceColor(lightThemeColors, "medium")).toBe("#F57C00");
    expect(getConfidenceColor(lightThemeColors, "low")).toBe("#D32F2F");
  });

  it("maps each tier to the matching theme color, dark theme", () => {
    expect(getConfidenceColor(darkThemeColors, "high")).toBe("#4CAF7D");
    expect(getConfidenceColor(darkThemeColors, "medium")).toBe("#FFB74D");
    expect(getConfidenceColor(darkThemeColors, "low")).toBe("#F16360");
  });
});

describe("getConfidenceLabel", () => {
  it("returns the canonical label per tier", () => {
    expect(getConfidenceLabel("high")).toBe("High");
    expect(getConfidenceLabel("medium")).toBe("Medium");
    expect(getConfidenceLabel("low")).toBe("Low");
  });
});

describe("getConfidenceHapticType", () => {
  it("returns Success for high confidence", () => {
    expect(getConfidenceHapticType("high")).toBe(
      Haptics.NotificationFeedbackType.Success,
    );
  });

  it("returns Warning for medium confidence", () => {
    expect(getConfidenceHapticType("medium")).toBe(
      Haptics.NotificationFeedbackType.Warning,
    );
  });

  it("returns Warning for low confidence (not silent, not Error)", () => {
    expect(getConfidenceHapticType("low")).toBe(
      Haptics.NotificationFeedbackType.Warning,
    );
  });
});
