import { forwardRef } from "react";

/**
 * Stub for react-native-webview (native view manager). Inert: renders nothing,
 * but records the last props so tests can pin a wrapper's configuration.
 */
let lastProps: Record<string, unknown> = {};

export function getLastWebViewProps(): Record<string, unknown> {
  return lastProps;
}

export const WebView = forwardRef(function WebViewMock(
  props: Record<string, unknown>,
) {
  lastProps = props;
  return null;
});

export default WebView;
