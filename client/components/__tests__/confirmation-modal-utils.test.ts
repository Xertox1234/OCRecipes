import { describe, it, expect } from "vitest";
import {
  getConfirmButtonStyle,
  getCancelButtonStyle,
  getDefaultLabels,
} from "../confirmation-modal-utils";

const lightTheme = {
  error: "#D32F2F",
  link: "#7C5CBF",
  buttonText: "#FFFFFF",
  backgroundSecondary: "#F2F2F2",
  text: "#212832",
};

const darkTheme = {
  error: "#EF5350",
  link: "#A88BF5",
  buttonText: "#FFFFFF",
  backgroundSecondary: "#393948",
  text: "#FFFFFF",
};

describe("getConfirmButtonStyle", () => {
  it("returns error color for destructive", () => {
    const result = getConfirmButtonStyle(true, lightTheme);
    expect(result.backgroundColor).toBe("#D32F2F");
    expect(result.textColor).toBe("#FFFFFF");
  });

  it("returns link color for non-destructive", () => {
    const result = getConfirmButtonStyle(false, lightTheme);
    expect(result.backgroundColor).toBe("#7C5CBF");
    expect(result.textColor).toBe("#FFFFFF");
  });

  it("uses dark theme error color when destructive", () => {
    const result = getConfirmButtonStyle(true, darkTheme);
    expect(result.backgroundColor).toBe("#EF5350");
  });
});

describe("getCancelButtonStyle", () => {
  it("returns secondary background with text color", () => {
    const result = getCancelButtonStyle(lightTheme);
    expect(result.backgroundColor).toBe("#F2F2F2");
    expect(result.textColor).toBe("#212832");
  });

  it("uses dark theme colors", () => {
    const result = getCancelButtonStyle(darkTheme);
    expect(result.backgroundColor).toBe("#393948");
    expect(result.textColor).toBe("#FFFFFF");
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
