import TextRecognition from "@react-native-ml-kit/text-recognition";
import type { LocalOCRResult } from "../types";

/**
 * Runs on-device MLKit text recognition on a photo URI.
 * Used as the capture-then-OCR replacement for live frame-processor OCR.
 */
export async function recognizeTextFromPhoto(
  uri: string,
): Promise<LocalOCRResult> {
  const result = await TextRecognition.recognize(uri);
  return {
    text: result.text,
    blocks: result.blocks.map((block) => ({ text: block.text })),
  };
}
