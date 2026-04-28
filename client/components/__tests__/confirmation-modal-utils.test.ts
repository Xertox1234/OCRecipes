import { describe, it, expect } from "vitest";
import {
  getConfirmButtonStyle,
  getCancelButtonStyle,
  getDefaultLabels,
} from "../confirmation-modal-utils";

const lightTheme = {
  error: "#D32F2F",
  link: "#B5451C",
  buttonText: "#FFFFFF",
  backgroundSecondary: "#EEE6DA",
  text: "#1C1410",
};

const darkTheme = {
  error: "#F16360",
  link: "#E07050",
  buttonText: "#FFFFFF",
  backgroundSecondary: "#2C2420",
  text: "#F5EFE6",
};

describe("getConfirmButtonStyle", () => {
  it("returns error color for destructive", () => {
    const result = getConfirmButtonStyle(true, lightTheme);
    expect(result.backgroundColor).toBe("#D32F2F");
    expect(result.textColor).toBe("#FFFFFF");
  });

  it("returns link color for non-destructive", () => {
    const result = getConfirmButtonStyle(false, lightTheme);
    expect(result.backgroundColor).toBe("#B5451C");
    expect(result.textColor).toBe("#FFFFFF");
  });

  it("uses dark theme error color when destructive", () => {
    const result = getConfirmButtonStyle(true, darkTheme);
    expect(result.backgroundColor).toBe("#F16360");
  });
});

describe("getCancelButtonStyle", () => {
  it("returns secondary background with text color", () => {
    const result = getCancelButtonStyle(lightTheme);
    expect(result.backgroundColor).toBe("#EEE6DA");
    expect(result.textColor).toBe("#1C1410");
  });

  it("uses dark theme colors", () => {
    const result = getCancelButtonStyle(darkTheme);
    expect(result.backgroundColor).toBe("#2C2420");
    expect(result.textColor).toBe("#F5EFE6");
  });
});

describe("getDefaultLabels", () => {
  it("returns Delete/Cancel for destructive", () => {
    const result = getDefaultLabels(true);
    expect(result.confirmLabel).toBe("Delete");
    expect(result.cancelLabel).toBe("Cancel");
  });

  it("returns Confirm/Cancel for non-destructive", () => {
    const result = getDefaultLabels(false);
    expect(result.confirmLabel).toBe("Confirm");
    expect(result.cancelLabel).toBe("Cancel");
  });
});
