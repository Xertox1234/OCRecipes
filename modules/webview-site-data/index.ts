// Our own bridge to the platform WebView store the import browser uses
// (react-native-webview's default data store). One function: forget every
// site's cookies and storage — recipe-site sign-ins made in the app.
import { requireOptionalNativeModule } from "expo";

import { clearSiteData, type NativeSiteData } from "./src/clear";

// Optional, not requireNativeModule: this is imported by the sign-out sweep,
// so a binary without the module (Expo Go, Vitest) must not throw at import.
const Native =
  requireOptionalNativeModule<NativeSiteData>("OCRWebviewSiteData");

/** Never throws; false only when the native clear failed. */
export function clearImportBrowserData(): Promise<boolean> {
  return clearSiteData(Native);
}
