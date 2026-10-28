import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  useId,
  type ReactNode,
} from "react";
import { AccessibilityInfo, Platform, StyleSheet, View } from "react-native";
import { FullWindowOverlay } from "react-native-screens";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NotificationFeedbackType } from "expo-haptics";

import { Toast } from "@/components/Toast";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import type { ToastVariant, ToastAction } from "@/components/toast-utils";
import { AbsoluteFill } from "@/constants/theme";

interface ToastOptions {
  action?: ToastAction;
  /** `success`/`error` fire a matching notification haptic by default. Pass
   *  `false` when the toast doesn't answer a user action (background errors,
   *  connectivity changes) or the caller already fired its own haptic. */
  haptic?: boolean;
}

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
  /** `Date.now()` at `show`: the dismiss window is measured from here, so a
   *  host change mid-toast (a remount) does not extend the toast. */
  createdAt: number;
}

interface ToastContextType {
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
  dismiss: () => void;
}

/** iOS presents modal routes above the root view controller, where this
 *  provider's host lives: lift the host onto the key window. */
function ToastHost({ children }: { children: React.ReactElement }) {
  if (Platform.OS !== "ios") return children;
  return (
    <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>
      <GestureHandlerRootView pointerEvents="box-none">
        {children}
      </GestureHandlerRootView>
    </FullWindowOverlay>
  );
}

const ToastContext = createContext<ToastContextType | null>(null);

/** Internal channel for `ModalToastHost`: the live toast plus a registry of
 *  mounted modal hosts. A React Native `<Modal>` presents its own view
 *  controller above the `FullWindowOverlay` window, so a toast fired while one
 *  is open renders hidden behind it. While a modal host is mounted it renders
 *  the toast instead and the root host steps aside — one visible toast, one
 *  screen-reader announcement. */
interface ModalHostChannel {
  toast: ToastItem | undefined;
  /** The top-most mounted modal host — the only one that renders the toast. */
  activeHostId: string | undefined;
  dismiss: () => void;
  register: (id: string) => () => void;
}
const ModalHostContext = createContext<ModalHostChannel | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const { notification } = useHaptics();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  // Ids of mounted modal hosts, most recently mounted last (top-most modal).
  const [modalHosts, setModalHosts] = useState<string[]>([]);

  const show = useCallback(
    (message: string, variant: ToastVariant, options?: ToastOptions) => {
      const id = nextId.current++;
      const action = options?.action;
      // Announce here, once per toast, not in a `Toast` mount effect: the toast
      // remounts when a `ModalToastHost` mounts or unmounts mid-display (the
      // root overlay and a modal host are different subtrees), and a mount
      // effect would announce it again. iOS-gated: the Android live region on
      // the message group covers the change (docs/rules/accessibility.md).
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(
          action ? `${message}. ${action.label} available.` : message,
        );
      }
      setToasts([{ id, message, variant, action, createdAt: Date.now() }]);
    },
    [],
  );

  const dismiss = useCallback(() => {
    setToasts([]);
  }, []);

  const success = useCallback(
    (message: string, options?: ToastOptions) => {
      if (options?.haptic !== false) {
        notification(NotificationFeedbackType.Success);
      }
      show(message, "success", options);
    },
    [show, notification],
  );
  const error = useCallback(
    (message: string, options?: ToastOptions) => {
      if (options?.haptic !== false) {
        notification(NotificationFeedbackType.Error);
      }
      show(message, "error", options);
    },
    [show, notification],
  );
  const info = useCallback(
    (message: string, options?: ToastOptions) => show(message, "info", options),
    [show],
  );

  const register = useCallback((id: string) => {
    setModalHosts((prev) => [...prev, id]);
    return () => setModalHosts((prev) => prev.filter((h) => h !== id));
  }, []);

  const modalChannel = useMemo(
    () => ({
      toast: toasts[0],
      activeHostId: modalHosts[modalHosts.length - 1],
      dismiss,
      register,
    }),
    [toasts, modalHosts, dismiss, register],
  );

  const value = useMemo(
    () => ({ success, error, info, dismiss }),
    [success, error, info, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      <ModalHostContext.Provider value={modalChannel}>
        {children}
      </ModalHostContext.Provider>
      {toasts.length > 0 && modalHosts.length === 0 && (
        <ToastHost key={toasts[0].id}>
          <Toast
            message={toasts[0].message}
            variant={toasts[0].variant}
            theme={theme}
            onDismiss={dismiss}
            action={toasts[0].action}
            createdAt={toasts[0].createdAt}
          />
        </ToastHost>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

/**
 * Mount inside a React Native `<Modal>` that can be open when a background
 * event toasts (the toast host in the root window renders behind it). Renders
 * the current toast over the modal's content; the root host is suppressed
 * while this is mounted, so only one `Toast` (one live region) exists. Place it
 * as the LAST child of the modal's root view so it stacks above the content.
 *
 * On iOS the toast clears NO top inset: a `pageSheet` (iPhone and iPad) is
 * laid out below the status bar, so the root safe-area top would push the
 * toast ~60 px down into the sheet's header row (seen in the #1503 sim check).
 * Android ignores `pageSheet` and opens a full-screen window that is
 * edge-to-edge (Expo no longer lets an app opt out), so it starts UNDER the status
 * bar and the toast keeps its normal safe-area top (seen on an Android 16
 * phone, 2026-10-27). A `fullScreen`/`overFullScreen` Modal on iOS would need
 * the inset back too.
 */
export function ModalToastHost() {
  // Outside a provider (isolated component tests) there is no toast to show.
  const channel = useContext(ModalHostContext);
  const register = channel?.register;
  const { theme } = useTheme();
  const hostId = useId();

  useEffect(() => register?.(hostId), [register, hostId]);

  if (!channel) return null;
  const { toast, activeHostId, dismiss } = channel;
  if (!toast || activeHostId !== hostId) return null;
  return (
    <GestureHandlerRootView style={styles.fill} pointerEvents="box-none">
      <View style={styles.fill} pointerEvents="box-none">
        <Toast
          key={toast.id}
          message={toast.message}
          variant={toast.variant}
          theme={theme}
          onDismiss={dismiss}
          action={toast.action}
          createdAt={toast.createdAt}
          topInset={Platform.OS === "android" ? undefined : 0}
        />
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: { ...AbsoluteFill },
});
