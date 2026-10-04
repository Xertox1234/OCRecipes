import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { Platform } from "react-native";
import { FullWindowOverlay } from "react-native-screens";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { Toast } from "@/components/Toast";
import { useTheme } from "@/hooks/useTheme";
import type { ToastVariant, ToastAction } from "@/components/toast-utils";

interface ToastOptions {
  action?: ToastAction;
}

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
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

export function ToastProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const show = useCallback(
    (message: string, variant: ToastVariant, options?: ToastOptions) => {
      const id = nextId.current++;
      setToasts([{ id, message, variant, action: options?.action }]);
    },
    [],
  );

  const dismiss = useCallback(() => {
    setToasts([]);
  }, []);

  const success = useCallback(
    (message: string, options?: ToastOptions) =>
      show(message, "success", options),
    [show],
  );
  const error = useCallback(
    (message: string, options?: ToastOptions) =>
      show(message, "error", options),
    [show],
  );
  const info = useCallback(
    (message: string, options?: ToastOptions) => show(message, "info", options),
    [show],
  );

  const value = useMemo(
    () => ({ success, error, info, dismiss }),
    [success, error, info, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 && (
        <ToastHost key={toasts[0].id}>
          <Toast
            message={toasts[0].message}
            variant={toasts[0].variant}
            theme={theme}
            onDismiss={dismiss}
            action={toasts[0].action}
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
