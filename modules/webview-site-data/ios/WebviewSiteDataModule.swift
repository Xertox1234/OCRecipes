import ExpoModulesCore
import WebKit

public final class WebviewSiteDataModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OCRWebviewSiteData")

    // react-native-webview uses WKWebsiteDataStore.default() unless
    // `incognito` or `sharedCookiesEnabled` is set (ImportWebView sets neither).
    // WebKit must be called on the main thread; resolve in its completion.
    AsyncFunction("clearAll") { (promise: Promise) in
      WKWebsiteDataStore.default().removeData(
        ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(),
        modifiedSince: .distantPast
      ) {
        promise.resolve(true)
      }
    }.runOnQueue(.main)
  }
}
