import { Image } from "react-native";
import {
  manipulateAsync,
  SaveFormat,
  type Action,
} from "expo-image-manipulator";
import { getInfoAsync, deleteAsync } from "expo-file-system/legacy";
import { logger } from "./logger";

export interface CompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  targetSizeKB?: number;
}

export interface CompressionResult {
  uri: string;
  width: number;
  height: number;
  sizeKB: number;
}

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  maxWidth: 1024,
  maxHeight: 1024,
  quality: 0.7,
  targetSizeKB: 900, // Leave buffer under 1MB limit
};

/**
 * The resize step that fits the image inside maxWidth × maxHeight without
 * changing its shape. expo-image-manipulator scales to EXACTLY the given box
 * when both width and height are set, stretching the photo, so only the
 * limiting side is passed and the other follows the aspect ratio. An image
 * already inside the box is not resized (no upscaling). If the source size
 * can't be read, bound the width alone — the shape is still kept.
 */
async function fitWithinActions(
  uri: string,
  maxWidth: number,
  maxHeight: number,
): Promise<Action[]> {
  let size: { width: number; height: number };
  try {
    size = await Image.getSize(uri);
  } catch {
    return [{ resize: { width: maxWidth } }];
  }
  if (size.width <= maxWidth && size.height <= maxHeight) return [];
  return size.width / maxWidth >= size.height / maxHeight
    ? [{ resize: { width: maxWidth } }]
    : [{ resize: { height: maxHeight } }];
}

/**
 * Compress an image for upload
 *
 * Uses expo-image-manipulator to resize and compress images.
 * Implements adaptive quality reduction if image is still too large.
 */
export async function compressImage(
  uri: string,
  options: CompressionOptions = {},
): Promise<CompressionResult> {
  const { maxWidth, maxHeight, quality, targetSizeKB } = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const actions = await fitWithinActions(uri, maxWidth, maxHeight);

  // First pass: resize and compress
  let result = await manipulateAsync(uri, actions, {
    compress: quality,
    format: SaveFormat.JPEG,
  });

  // Check file size
  const fileInfo = await getInfoAsync(result.uri);
  let sizeKB = (fileInfo.exists ? fileInfo.size : 0) / 1024;

  // Adaptive quality reduction if still too large
  if (sizeKB > targetSizeKB && quality > 0.3) {
    const newQuality = Math.max(0.3, quality * (targetSizeKB / sizeKB));

    const firstPassUri = result.uri;
    result = await manipulateAsync(uri, actions, {
      compress: newQuality,
      format: SaveFormat.JPEG,
    });
    // Callers only clean up the file we return, so drop the discarded one.
    await cleanupImage(firstPassUri);

    const newFileInfo = await getInfoAsync(result.uri);
    sizeKB = (newFileInfo.exists ? newFileInfo.size : 0) / 1024;
  }

  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
    sizeKB: Math.round(sizeKB * 100) / 100,
  };
}

/**
 * Clean up a compressed image file
 *
 * Call this after upload to free up temporary storage.
 * From institutional learning: useeffect-cleanup-memory-leak
 */
export async function cleanupImage(uri: string): Promise<void> {
  try {
    await deleteAsync(uri, { idempotent: true });
  } catch (error) {
    // Silently ignore cleanup errors
    logger.warn("Image cleanup failed:", error);
  }
}
