import { useRef, useCallback, useState, useEffect } from "react";
import type {
  CameraRef,
  PhotoOptions,
  PhotoResult,
  BarcodeResult,
} from "../types";

export interface UseCameraOptions {
  onBarcodeScanned?: (result: BarcodeResult, isRepeat?: boolean) => void;
  debounceMs?: number;
  /** Enable batch mode: allows multiple different barcodes, Map-based debounce */
  batch?: boolean;
}

export interface UseCameraReturn {
  cameraRef: React.RefObject<CameraRef | null>;
  isScanning: boolean;
  lastScannedData: string | null;
  takePicture: (options?: PhotoOptions) => Promise<PhotoResult | null>;
  handleBarcodeScanned: (result: BarcodeResult) => void;
  resetScanning: () => void;
}

/**
 * Hook for camera operations with built-in barcode debouncing.
 * Uses refs for scanning state to avoid stale closures.
 *
 * In batch mode, uses a Map<barcode, timestamp> for per-barcode debouncing:
 * - Different barcodes are processed immediately
 * - Same barcode within debounceMs is silently ignored
 * - Same barcode after debounceMs fires callback with isRepeat=true
 */
export function useCamera(options: UseCameraOptions = {}): UseCameraReturn {
  const { onBarcodeScanned, debounceMs = 2000, batch = false } = options;

  const cameraRef = useRef<CameraRef>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScannedData, setLastScannedData] = useState<string | null>(null);

  // Single-scan mode refs
  const lastScannedRef = useRef<string | null>(null);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isScanningRef = useRef(false);

  // Batch mode refs
  const scannedBarcodesRef = useRef(new Map<string, number>());
  const isActiveRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    isActiveRef.current = true;
    return () => {
      isActiveRef.current = false;
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }
    };
  }, []);

  const takePicture = useCallback(
    async (opts?: PhotoOptions): Promise<PhotoResult | null> => {
      if (!cameraRef.current) return null;
      return cameraRef.current.takePicture(opts);
    },
    [],
  );

  const handleBarcodeScanned = useCallback(
    (result: BarcodeResult) => {
      if (batch) {
        // Batch mode: Map-based per-barcode debounce, no global lock
        if (!isActiveRef.current) return;

        const now = Date.now();
        const lastTime = scannedBarcodesRef.current.get(result.data);

        if (lastTime !== undefined && now - lastTime < debounceMs) {
          return; // Within debounce window for this barcode, ignore
        }

        const isRepeat = lastTime !== undefined;
        scannedBarcodesRef.current.set(result.data, now);
        setLastScannedData(result.data);
        setIsScanning(true);

        onBarcodeScanned?.(result, isRepeat);
      } else {
        // Single-scan mode: original behavior
        if (isScanningRef.current) return;
        if (lastScannedRef.current === result.data) return;

        isScanningRef.current = true;
        lastScannedRef.current = result.data;
        setLastScannedData(result.data);
        setIsScanning(true);

        if (scanTimeoutRef.current) {
          clearTimeout(scanTimeoutRef.current);
        }

        onBarcodeScanned?.(result);

        scanTimeoutRef.current = setTimeout(() => {
          isScanningRef.current = false;
          setIsScanning(false);
          lastScannedRef.current = null;
        }, debounceMs);
      }
    },
    [onBarcodeScanned, debounceMs, batch],
  );

  const resetScanning = useCallback(() => {
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
    isScanningRef.current = false;
    scannedBarcodesRef.current.clear();
    isActiveRef.current = true;
    setIsScanning(false);
    setLastScannedData(null);
    lastScannedRef.current = null;
  }, []);

  return {
    cameraRef,
    isScanning,
    lastScannedData,
    takePicture,
    handleBarcodeScanned,
    resetScanning,
  };
}
