// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";

import { useCamera } from "../useCamera";

// Exercises the REAL useCamera hook (client/camera/hooks/useCamera.ts) rather
// than re-implementing handleBarcodeScanned/resetScanning inline. The hook only
// imports `react` + type-only `../types`, so it runs under jsdom.
//
// Every call that drives the hook's state (handleBarcodeScanned, resetScanning)
// and every timer advance is wrapped in act() — the real hook calls setState
// inside both the handler and the debounce timer callback.

describe("useCamera — single-scan debouncing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onBarcodeScanned on first scan and sets scanning state", () => {
    const onBarcodeScanned = vi.fn();
    const { result } = renderHook(() => useCamera({ onBarcodeScanned }));

    act(() => {
      result.current.handleBarcodeScanned({ data: "123456789", type: "ean13" });
    });

    expect(onBarcodeScanned).toHaveBeenCalledTimes(1);
    expect(onBarcodeScanned).toHaveBeenCalledWith({
      data: "123456789",
      type: "ean13",
    });
    expect(result.current.isScanning).toBe(true);
    expect(result.current.lastScannedData).toBe("123456789");
  });

  it("blocks rapid duplicate scans while isScanning is true", () => {
    const onBarcodeScanned = vi.fn();
    const { result } = renderHook(() => useCamera({ onBarcodeScanned }));

    act(() => {
      result.current.handleBarcodeScanned({ data: "123456789", type: "ean13" });
      // Subsequent scans within the debounce window are blocked by the global
      // single-scan lock — even a different barcode.
      result.current.handleBarcodeScanned({ data: "123456789", type: "ean13" });
      result.current.handleBarcodeScanned({ data: "987654321", type: "ean13" });
    });

    expect(onBarcodeScanned).toHaveBeenCalledTimes(1);
  });

  it("allows a new scan after the debounce period elapses", () => {
    const onBarcodeScanned = vi.fn();
    const { result } = renderHook(() => useCamera({ onBarcodeScanned }));

    act(() => {
      result.current.handleBarcodeScanned({ data: "123456789", type: "ean13" });
    });
    expect(onBarcodeScanned).toHaveBeenCalledTimes(1);

    // Fast-forward past the 2000ms default debounce — the timer callback resets
    // the scanning state.
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    act(() => {
      result.current.handleBarcodeScanned({ data: "987654321", type: "ean13" });
    });
    expect(onBarcodeScanned).toHaveBeenCalledTimes(2);
  });

  it("clears scanning state when the debounce timer fires", () => {
    const onBarcodeScanned = vi.fn();
    const { result } = renderHook(() => useCamera({ onBarcodeScanned }));

    act(() => {
      result.current.handleBarcodeScanned({ data: "123456789", type: "ean13" });
    });
    expect(result.current.isScanning).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.isScanning).toBe(false);
  });

  it("honors a custom debounceMs", () => {
    const onBarcodeScanned = vi.fn();
    const { result } = renderHook(() =>
      useCamera({ onBarcodeScanned, debounceMs: 500 }),
    );

    act(() => {
      result.current.handleBarcodeScanned({ data: "123456789", type: "ean13" });
    });

    // Still locked just before the custom window closes.
    act(() => {
      vi.advanceTimersByTime(499);
      result.current.handleBarcodeScanned({ data: "987654321", type: "ean13" });
    });
    expect(onBarcodeScanned).toHaveBeenCalledTimes(1);

    // Lock releases at 500ms.
    act(() => {
      vi.advanceTimersByTime(1);
      result.current.handleBarcodeScanned({ data: "987654321", type: "ean13" });
    });
    expect(onBarcodeScanned).toHaveBeenCalledTimes(2);
  });

  it("does not throw when onBarcodeScanned is undefined but still updates state", () => {
    const { result } = renderHook(() => useCamera());

    expect(() => {
      act(() => {
        result.current.handleBarcodeScanned({
          data: "123456789",
          type: "ean13",
        });
      });
    }).not.toThrow();

    expect(result.current.isScanning).toBe(true);
    expect(result.current.lastScannedData).toBe("123456789");
  });
});

describe("useCamera — resetScanning", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears all scanning state", () => {
    const onBarcodeScanned = vi.fn();
    const { result } = renderHook(() => useCamera({ onBarcodeScanned }));

    act(() => {
      result.current.handleBarcodeScanned({ data: "123456789", type: "ean13" });
    });
    expect(result.current.isScanning).toBe(true);
    expect(result.current.lastScannedData).toBe("123456789");

    act(() => {
      result.current.resetScanning();
    });

    expect(result.current.isScanning).toBe(false);
    expect(result.current.lastScannedData).toBeNull();
  });

  it("allows the same barcode to be scanned again immediately after reset", () => {
    const onBarcodeScanned = vi.fn();
    const { result } = renderHook(() => useCamera({ onBarcodeScanned }));

    act(() => {
      result.current.handleBarcodeScanned({ data: "123456789", type: "ean13" });
    });
    expect(onBarcodeScanned).toHaveBeenCalledTimes(1);

    // Reset before the debounce window closes.
    act(() => {
      result.current.resetScanning();
    });

    act(() => {
      result.current.handleBarcodeScanned({ data: "123456789", type: "ean13" });
    });
    expect(onBarcodeScanned).toHaveBeenCalledTimes(2);
  });
});

describe("useCamera — batch mode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows different barcodes immediately without a global lock", () => {
    const onBarcodeScanned = vi.fn();
    const { result } = renderHook(() =>
      useCamera({ onBarcodeScanned, batch: true }),
    );

    act(() => {
      result.current.handleBarcodeScanned({
        data: "1234567890123",
        type: "ean13",
      });
      result.current.handleBarcodeScanned({
        data: "9876543210987",
        type: "ean13",
      });
      result.current.handleBarcodeScanned({
        data: "1111111111111",
        type: "ean13",
      });
    });

    expect(onBarcodeScanned).toHaveBeenCalledTimes(3);
    expect(onBarcodeScanned).toHaveBeenNthCalledWith(
      1,
      { data: "1234567890123", type: "ean13" },
      false,
    );
    expect(onBarcodeScanned).toHaveBeenNthCalledWith(
      2,
      { data: "9876543210987", type: "ean13" },
      false,
    );
    expect(onBarcodeScanned).toHaveBeenNthCalledWith(
      3,
      { data: "1111111111111", type: "ean13" },
      false,
    );
  });

  it("ignores the same barcode within the 2s debounce window", () => {
    const onBarcodeScanned = vi.fn();
    const { result } = renderHook(() =>
      useCamera({ onBarcodeScanned, batch: true }),
    );

    act(() => {
      result.current.handleBarcodeScanned({
        data: "1234567890123",
        type: "ean13",
      });
    });
    act(() => {
      vi.advanceTimersByTime(500);
      result.current.handleBarcodeScanned({
        data: "1234567890123",
        type: "ean13",
      });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
      result.current.handleBarcodeScanned({
        data: "1234567890123",
        type: "ean13",
      });
    });

    expect(onBarcodeScanned).toHaveBeenCalledTimes(1);
  });

  it("fires callback with isRepeat=true for the same barcode after the debounce window", () => {
    const onBarcodeScanned = vi.fn();
    const { result } = renderHook(() =>
      useCamera({ onBarcodeScanned, batch: true }),
    );

    act(() => {
      result.current.handleBarcodeScanned({
        data: "1234567890123",
        type: "ean13",
      });
    });
    expect(onBarcodeScanned).toHaveBeenLastCalledWith(
      { data: "1234567890123", type: "ean13" },
      false,
    );

    act(() => {
      vi.advanceTimersByTime(2000);
      result.current.handleBarcodeScanned({
        data: "1234567890123",
        type: "ean13",
      });
    });

    expect(onBarcodeScanned).toHaveBeenCalledTimes(2);
    expect(onBarcodeScanned).toHaveBeenLastCalledWith(
      { data: "1234567890123", type: "ean13" },
      true,
    );
  });

  it("clears the batch barcode map on resetScanning", () => {
    const onBarcodeScanned = vi.fn();
    const { result } = renderHook(() =>
      useCamera({ onBarcodeScanned, batch: true }),
    );

    act(() => {
      result.current.handleBarcodeScanned({
        data: "1234567890123",
        type: "ean13",
      });
    });
    expect(onBarcodeScanned).toHaveBeenCalledTimes(1);

    // After reset, the same barcode is treated as new (isRepeat=false) within
    // the debounce window because the map was cleared.
    act(() => {
      result.current.resetScanning();
      result.current.handleBarcodeScanned({
        data: "1234567890123",
        type: "ean13",
      });
    });

    expect(onBarcodeScanned).toHaveBeenCalledTimes(2);
    expect(onBarcodeScanned).toHaveBeenLastCalledWith(
      { data: "1234567890123", type: "ean13" },
      false,
    );
  });
});
