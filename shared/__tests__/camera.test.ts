import {
  expoBarcodeTypes,
  visionCameraBarcodeTypes,
  BARCODE_TYPE_MAP,
  BARCODE_TYPE_REVERSE_MAP,
  FREE_BARCODE_TYPES,
  PREMIUM_BARCODE_TYPES,
  getBarcodeTypesForTier,
  isPremiumBarcodeType,
} from "../types/camera";

describe("Camera Types", () => {
  describe("expoBarcodeTypes", () => {
    it("should include all expected barcode types", () => {
      expect(expoBarcodeTypes).toContain("ean13");
      expect(expoBarcodeTypes).toContain("ean8");
      expect(expoBarcodeTypes).toContain("upc_a");
      expect(expoBarcodeTypes).toContain("upc_e");
      expect(expoBarcodeTypes).toContain("code128");
      expect(expoBarcodeTypes).toContain("code39");
      expect(expoBarcodeTypes).toContain("code93");
      expect(expoBarcodeTypes).toContain("datamatrix");
      expect(expoBarcodeTypes).toContain("qr");
    });
  });

  describe("visionCameraBarcodeTypes", () => {
    it("should include all expected barcode types", () => {
      expect(visionCameraBarcodeTypes).toContain("ean-13");
      expect(visionCameraBarcodeTypes).toContain("ean-8");
      expect(visionCameraBarcodeTypes).toContain("upc-a");
      expect(visionCameraBarcodeTypes).toContain("upc-e");
      expect(visionCameraBarcodeTypes).toContain("code-128");
      expect(visionCameraBarcodeTypes).toContain("code-39");
      expect(visionCameraBarcodeTypes).toContain("code-93");
      expect(visionCameraBarcodeTypes).toContain("data-matrix");
      expect(visionCameraBarcodeTypes).toContain("qr-code");
    });
  });

  describe("BARCODE_TYPE_MAP", () => {
    it("should map all expo types to vision camera types", () => {
      expoBarcodeTypes.forEach((expoType) => {
        expect(BARCODE_TYPE_MAP[expoType]).toBeDefined();
      });
    });

    it("should correctly map specific types", () => {
      expect(BARCODE_TYPE_MAP.ean13).toBe("ean-13");
      expect(BARCODE_TYPE_MAP.upc_a).toBe("upc-a");
      expect(BARCODE_TYPE_MAP.datamatrix).toBe("data-matrix");
      expect(BARCODE_TYPE_MAP.qr).toBe("qr-code");
    });
  });

  describe("BARCODE_TYPE_REVERSE_MAP", () => {
    it("should map all vision camera types back to expo types", () => {
      visionCameraBarcodeTypes.forEach((visionType) => {
        expect(BARCODE_TYPE_REVERSE_MAP[visionType]).toBeDefined();
      });
    });

    it("should be the inverse of BARCODE_TYPE_MAP", () => {
      expoBarcodeTypes.forEach((expoType) => {
        const visionType = BARCODE_TYPE_MAP[expoType];
        expect(BARCODE_TYPE_REVERSE_MAP[visionType]).toBe(expoType);
      });
    });
  });

  describe("FREE_BARCODE_TYPES", () => {
    it("should include basic barcode types", () => {
      expect(FREE_BARCODE_TYPES).toContain("ean13");
      expect(FREE_BARCODE_TYPES).toContain("ean8");
      expect(FREE_BARCODE_TYPES).toContain("upc_a");
      expect(FREE_BARCODE_TYPES).toContain("upc_e");
      expect(FREE_BARCODE_TYPES).toContain("code128");
      expect(FREE_BARCODE_TYPES).toContain("code39");
      expect(FREE_BARCODE_TYPES).toContain("code93");
    });

    it("should not include premium types", () => {
      expect(FREE_BARCODE_TYPES).not.toContain("datamatrix");
      expect(FREE_BARCODE_TYPES).not.toContain("qr");
    });
  });

  describe("PREMIUM_BARCODE_TYPES", () => {
    it("should include advanced barcode types", () => {
      expect(PREMIUM_BARCODE_TYPES).toContain("datamatrix");
      expect(PREMIUM_BARCODE_TYPES).toContain("qr");
    });

    it("should not include free types", () => {
      FREE_BARCODE_TYPES.forEach((freeType) => {
        expect(PREMIUM_BARCODE_TYPES).not.toContain(freeType);
      });
    });
  });

  describe("getBarcodeTypesForTier", () => {
    it("should return only free types for free tier", () => {
      const types = getBarcodeTypesForTier("free");
      expect(types).toEqual(FREE_BARCODE_TYPES);
      expect(types).not.toContain("datamatrix");
      expect(types).not.toContain("qr");
    });

    it("should return all types for premium tier", () => {
      const types = getBarcodeTypesForTier("premium");
      expect(types).toEqual([...FREE_BARCODE_TYPES, ...PREMIUM_BARCODE_TYPES]);
      expect(types).toContain("ean13");
      expect(types).toContain("datamatrix");
      expect(types).toContain("qr");
    });
  });

  describe("isPremiumBarcodeType", () => {
    it("should return true for premium types", () => {
      expect(isPremiumBarcodeType("datamatrix")).toBe(true);
      expect(isPremiumBarcodeType("qr")).toBe(true);
    });

    it("should return false for free types", () => {
      FREE_BARCODE_TYPES.forEach((freeType) => {
        expect(isPremiumBarcodeType(freeType)).toBe(false);
      });
    });
  });
});
