import { describe, it, expect } from "vitest";
import {
  getSaveIconName,
  getSaveBackgroundColorKey,
  getSaveIconColorKey,
  getSaveAccessibilityLabel,
} from "../save-button-utils";

describe("getSaveIconName", () => {
  it("returns 'bookmark' for idle", () => {
    expect(getSaveIconName("idle")).toBe("bookmark");
  });

  it("returns 'bookmark' for saving", () => {
    expect(getSaveIconName("saving")).toBe("bookmark");
  });

  it("returns 'check' for saved", () => {
    expect(getSaveIconName("saved")).toBe("check");
  });

  it("returns 'alert-circle' for error", () => {
    expect(getSaveIconName("error")).toBe("alert-circle");
  });
});

describe("getSaveBackgroundColorKey", () => {
  it("returns 'backgroundSecondary' for idle", () => {
    expect(getSaveBackgroundColorKey("idle")).toBe("backgroundSecondary");
  });

  it("returns 'backgroundSecondary' for saving", () => {
    expect(getSaveBackgroundColorKey("saving")).toBe("backgroundSecondary");
  });

  it("returns 'success' for saved", () => {
    expect(getSaveBackgroundColorKey("saved")).toBe("success");
  });

  it("returns 'error' for error", () => {
    expect(getSaveBackgroundColorKey("error")).toBe("error");
  });
});

describe("getSaveIconColorKey", () => {
  it("returns 'text' for idle", () => {
    expect(getSaveIconColorKey("idle")).toBe("text");
  });

  it("returns 'text' for saving", () => {
    expect(getSaveIconColorKey("saving")).toBe("text");
  });

  it("returns 'buttonText' for saved", () => {
    expect(getSaveIconColorKey("saved")).toBe("buttonText");
  });

  it("returns 'buttonText' for error", () => {
    expect(getSaveIconColorKey("error")).toBe("buttonText");
  });
});

describe("getSaveAccessibilityLabel", () => {
  it("returns item title for idle", () => {
    expect(getSaveAccessibilityLabel("idle", "Banana Bread")).toBe(
      "Save Banana Bread",
    );
  });

  it("returns 'Saving item' for saving", () => {
    expect(getSaveAccessibilityLabel("saving", "Banana Bread")).toBe(
      "Saving item",
    );
  });

  it("returns 'Item saved' for saved", () => {
    expect(getSaveAccessibilityLabel("saved", "Banana Bread")).toBe(
      "Item saved",
    );
  });

  it("returns retry message for error", () => {
    expect(getSaveAccessibilityLabel("error", "Banana Bread")).toBe(
      "Failed to save, tap to retry",
    );
  });
});
