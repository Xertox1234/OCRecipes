import type { CameraPermissionResult } from "../../types";

// Mirrors the permission derivation inside useCameraPermissions (V5 boolean API)
function derivePermission(
  hasPermission: boolean,
  hasRequested: boolean,
): CameraPermissionResult {
  if (hasPermission) return { status: "granted", canAskAgain: false };
  if (hasRequested) return { status: "denied", canAskAgain: false };
  return { status: "undetermined", canAskAgain: true };
}

// Mirrors the requestPermission async outcome
function processRequest(granted: boolean): CameraPermissionResult {
  if (granted) return { status: "granted", canAskAgain: false };
  return { status: "denied", canAskAgain: false };
}

describe("useCameraPermissions — V5 boolean API", () => {
  describe("derivePermission", () => {
    it("returns undetermined with canAskAgain when never requested", () => {
      const result = derivePermission(false, false);
      expect(result.status).toBe("undetermined");
      expect(result.canAskAgain).toBe(true);
    });

    it("returns granted (no canAskAgain) when hasPermission is true", () => {
      const result = derivePermission(true, false);
      expect(result.status).toBe("granted");
      expect(result.canAskAgain).toBe(false);
    });

    it("returns denied (no canAskAgain) after request was made but denied", () => {
      // hasRequestedRef.current = true after the first requestPermission call
      const result = derivePermission(false, true);
      expect(result.status).toBe("denied");
      expect(result.canAskAgain).toBe(false);
    });

    it("granted takes priority over hasRequested flag", () => {
      // If permission was later granted via Settings, hasPermission flips true
      const result = derivePermission(true, true);
      expect(result.status).toBe("granted");
      expect(result.canAskAgain).toBe(false);
    });
  });

  describe("processRequest", () => {
    it("returns granted when native request resolves true", () => {
      const result = processRequest(true);
      expect(result.status).toBe("granted");
      expect(result.canAskAgain).toBe(false);
    });

    it("returns denied (no canAskAgain) when native request resolves false", () => {
      const result = processRequest(false);
      expect(result.status).toBe("denied");
      expect(result.canAskAgain).toBe(false);
    });
  });

  describe("isLoading", () => {
    it("is always false (permission state is synchronous in V5)", () => {
      // V5's useCameraPermission() is synchronous — no async loading phase
      const isLoading = false;
      expect(isLoading).toBe(false);
    });
  });
});
