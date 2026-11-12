package com.ocrecipes.webviewsitedata

import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
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
      clearHttpCache()
    }.runOnQueue(Queues.MAIN)
  }

  // The HTTP cache (pages and pictures of visited sites) has no singleton:
  // clearCache is an instance method whose effect is app-wide, so a throwaway
  // WebView does it. Best-effort and apart from the cookie step on purpose —
  // a failure here must neither skip the cookie removal nor reject clearAll
  // (a rejection makes the sign-out wipe run again at every launch).
  private fun clearHttpCache() {
    val context = appContext.reactContext?.applicationContext ?: return
    try {
      val webView = WebView(context)
      webView.clearCache(true)
      webView.destroy()
    } catch (e: Exception) {
      Log.w("OCRWebviewSiteData", "HTTP cache clear failed", e)
    }
  }
}
