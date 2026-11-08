export interface NativeSiteData {
  /** Clears the default WebView store (cookies, storage, caches). */
  clearAll(): Promise<unknown>;
}

/**
 * Never throws: false when the native module is absent (Expo Go, Vitest) or
 * the native clear fails, true once the platform reports it done.
 */
export async function clearSiteData(
  native: NativeSiteData | null,
): Promise<boolean> {
  if (!native) return false;
  try {
    await native.clearAll();
    return true;
  } catch {
    return false;
  }
}
