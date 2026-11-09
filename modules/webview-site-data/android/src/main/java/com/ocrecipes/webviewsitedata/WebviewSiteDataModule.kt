package com.ocrecipes.webviewsitedata

import android.webkit.CookieManager
import android.webkit.WebStorage
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WebviewSiteDataModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OCRWebviewSiteData")

    // react-native-webview uses the app-wide CookieManager / WebStorage
    // singletons. Both must be touched on the UI thread; resolve after the
    // cookie callback (its Boolean is "were any removed", not success).
    AsyncFunction("clearAll") { promise: Promise ->
      try {
        WebStorage.getInstance().deleteAllData()
        val cookies = CookieManager.getInstance()
        cookies.removeAllCookies {
          cookies.flush()
          promise.resolve(true)
        }
      } catch (e: Exception) {
        // CookieManager throws when no WebView provider is installed.
        promise.reject("CLEAR_FAILED", e.message, e)
      }
    }.runOnQueue(Queues.MAIN)
  }
}
