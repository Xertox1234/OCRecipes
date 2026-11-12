import { Image } from "expo-image";
import {
  cacheDirectory,
  readDirectoryAsync,
  deleteAsync,
} from "expo-file-system/legacy";
import { logger } from "@/lib/logger";

/**
 * Name prefix of the temp JPEG written when a recipe picture is pasted from
 * the clipboard (ImportRecipeSheet). Shared with the writer so the sign-out
 * sweep below matches exactly the files it makes.
 */
export const CLIPBOARD_TEMP_PREFIX = "clipboard_recipe_";

/**
 * Pictures the last session left on the device, outside our storage keys:
 * expo-image's cache (memory + disk — recipe, product and chat pictures) and
 * pasted-picture temp files. Run by the sign-out wipe (clearDurableLocalState).
 *
 * Best-effort and never throws, and deliberately reports nothing back: the
 * wipe's return value gates the durable-owner marker, and expo-image answers
 * `false` for reasons that are not failures (Android with no activity, web
 * always) — counting those would re-run the whole wipe, offline queue
 * included, at every launch.
 *
 * Only our own prefix is deleted from the cache folder — never the folder.
 * Not covered: pictures shown with react-native's own Image (OS URL cache).
 */
export async function clearDeviceImageLeftovers(): Promise<void> {
  for (const clear of [
    () => Image.clearMemoryCache(),
    () => Image.clearDiskCache(),
  ]) {
    try {
      await clear();
    } catch (err) {
      logger.warn("Sign-out: image cache clear failed", err);
    }
  }

  if (!cacheDirectory) return;
  let names: string[];
  try {
    names = await readDirectoryAsync(cacheDirectory);
  } catch (err) {
    logger.warn("Sign-out: could not list the cache folder", err);
    return;
  }
  for (const name of names) {
    if (!name.startsWith(CLIPBOARD_TEMP_PREFIX)) continue;
    try {
      await deleteAsync(`${cacheDirectory}${name}`, { idempotent: true });
    } catch (err) {
      logger.warn("Sign-out: temp picture delete failed", err);
    }
  }
}
