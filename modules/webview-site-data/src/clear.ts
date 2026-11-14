export interface NativeSiteData {
  /** Clears the default WebView store (cookies, storage, caches). */
  clearAll(): Promise<unknown>;
}

/**
 * Never throws: false only when the native clear fails; true once the
 * platform reports it done. An absent module (Expo Go, Vitest, an older
 * binary) is true: it ships together with react-native-webview's native code,
 * so without it no import-browser site data can exist — nothing to clear.
 */
export async function clearSiteData(
  native: NativeSiteData | null,
): Promise<boolean> {
  if (!native) return true;
  try {
    await native.clearAll();
    return true;
  } catch {
    return false;
  }
}
