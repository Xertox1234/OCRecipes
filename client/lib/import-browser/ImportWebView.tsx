import { useImperativeHandle, useRef } from "react";
import type { Ref } from "react";
import { StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";
import {
  EXTRACT_LD_JSON_SCRIPT,
  parseExtractorMessage,
  shouldAllowNavigation,
} from "./import-browser-utils";

export interface ImportWebViewHandle {
  extract(): void;
  reload(): void;
  goBack(): void;
}

interface ImportWebViewProps {
  url: string;
  hidden?: boolean;
  onBlocks: (blocks: string[], currentUrl: string) => void;
  onLoadEnd?: () => void;
  onNavigationChange?: (url: string, canGoBack: boolean) => void;
  ref?: Ref<ImportWebViewHandle>;
}

/**
 * The one locked-down WebView for recipe import. Pages loaded here never reach
 * the app's auth token, app APIs or deep links: no bridge beyond the extractor
 * message, and every non-http(s) navigation is refused without being passed to
 * Linking (a spike found react-native-webview otherwise hands an iframe's
 * about:srcdoc to Linking.openURL).
 *
 * originWhitelist is ["*"] on purpose: react-native-webview checks the
 * whitelist BEFORE our handler and hands a miss to Linking.openURL, so any
 * narrower list lets pages open app deep links and external apps.
 * shouldAllowNavigation is the only gate.
 *
 * This cookie store must not be shared with any other WebView added later.
 */
export function ImportWebView({
  url,
  hidden = false,
  onBlocks,
  onLoadEnd,
  onNavigationChange,
  ref,
}: ImportWebViewProps) {
  const webRef = useRef<WebView>(null);
  const currentUrl = useRef(url);

  useImperativeHandle(ref, () => ({
    extract: () => webRef.current?.injectJavaScript(EXTRACT_LD_JSON_SCRIPT),
    reload: () => webRef.current?.reload(),
    goBack: () => webRef.current?.goBack(),
  }));

  const handleMessage = (event: WebViewMessageEvent) => {
    const blocks = parseExtractorMessage(event.nativeEvent.data);
    if (!blocks) return;
    onBlocks(blocks, event.nativeEvent.url || currentUrl.current);
  };

  return (
    <WebView
      ref={webRef}
      source={{ uri: url }}
      style={hidden ? styles.hidden : styles.visible}
      pointerEvents={hidden ? "none" : "auto"}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      accessibilityElementsHidden={hidden}
      originWhitelist={["*"]}
      onShouldStartLoadWithRequest={(req) =>
        shouldAllowNavigation(req.url, req.isTopFrame ?? true)
      }
      setSupportMultipleWindows={false}
      allowFileAccess={false}
      thirdPartyCookiesEnabled={false}
      sharedCookiesEnabled={false}
      injectedJavaScript={EXTRACT_LD_JSON_SCRIPT}
      onMessage={handleMessage}
      onLoadEnd={onLoadEnd}
      onNavigationStateChange={(nav) => {
        currentUrl.current = nav.url;
        onNavigationChange?.(nav.url, nav.canGoBack);
      }}
    />
  );
}

const styles = StyleSheet.create({
  hidden: { width: 1, height: 1, opacity: 0 },
  visible: { flex: 1 },
});
