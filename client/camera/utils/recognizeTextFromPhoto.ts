import { recognizeText } from "@infinitered/react-native-mlkit-text-recognition";
import type { LocalOCRResult } from "../types";

/**
 * Runs on-device MLKit text recognition on a photo URI.
 * Used as the capture-then-OCR replacement for live frame-processor OCR.
 *
 * Narrowing the recognizer's result to `{ text }` is deliberate: no consumer
 * reads block geometry, so keeping it out of `LocalOCRResult` is what let the
 * OCR library be swapped without touching a single call site.
 */
export async function recognizeTextFromPhoto(
  uri: string,
): Promise<LocalOCRResult> {
  const result = await recognizeText(uri);
  return {
    text: result.text,
  };
}
