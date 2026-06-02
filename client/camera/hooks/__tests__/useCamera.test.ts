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

describe("useCamera — defensive branches", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores batch scans after unmount (post-unmount guard, useCamera.ts:76)", () => {
    const onBarcodeScanned = vi.fn();
    const { result, unmount } = renderHook(() =>
      useCamera({ onBarcodeScanned, batch: true }),
    );

    // Capture the handler before unmount — result.current is no longer driven
    // once the hook unmounts. Refs are stable, so the captured callback closes
    // over the same internal isActiveRef the cleanup effect flips to false.
    const handler = result.current.handleBarcodeScanned;

    unmount();

    // Calling the captured handler after unmount must hit the `if
    // (!isActiveRef.current) return` guard before any setState runs. No act()
    // wrapper: the guard early-returns, so no state update is queued. The
    // load-bearing assertion is that the callback does NOT fire — if the guard
    // were removed, the callback would run (and setState on the unmounted hook).
    // React 19 emits no setState-after-unmount warning, so callback-not-called
    // is the assertion that actually catches a regression here.
    handler({ data: "1234567890123", type: "ean13" });

    expect(onBarcodeScanned).not.toHaveBeenCalled();
  });

  it("evicts the oldest entry when the batch map hits BATCH_MAP_MAX_SIZE (useCamera.ts:87-97)", () => {
    const onBarcodeScanned = vi.fn();
    const { result } = renderHook(() =>
      useCamera({ onBarcodeScanned, batch: true }),
    );

    // BATCH_MAP_MAX_SIZE is 200 (module-private). Scan 201 distinct barcodes
    // with the clock frozen so none of them debounce each other. The 201st
    // distinct insert trips the eviction branch and deletes the oldest key —
    // the very first barcode scanned ("barcode-0").
    const firstBarcode = "barcode-0";
    act(() => {
      for (let i = 0; i < 201; i++) {
        result.current.handleBarcodeScanned({
          data: `barcode-${i}`,
          type: "ean13",
        });
      }
    });
    expect(onBarcodeScanned).toHaveBeenCalledTimes(201);

    // Re-scan the first barcode WITHOUT advancing the clock. Because its map
    // entry was evicted, lastTime is undefined → it is treated as new
    // (isRepeat=false) and the callback fires. If the entry still existed it
    // would be debounced (now - lastTime = 0 < debounceMs) and NOT fire, so
    // isRepeat=false here uniquely proves the eviction happened.
    act(() => {
      result.current.handleBarcodeScanned({
        data: firstBarcode,
        type: "ean13",
      });
    });

    expect(onBarcodeScanned).toHaveBeenCalledTimes(202);
    expect(onBarcodeScanned).toHaveBeenLastCalledWith(
      { data: firstBarcode, type: "ean13" },
      false,
    );
  });
});
