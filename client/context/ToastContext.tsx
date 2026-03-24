import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

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
    () => ({ success, error, info }),
    [success, error, info],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 && (
        <Toast
          key={toasts[0].id}
          message={toasts[0].message}
          variant={toasts[0].variant}
          theme={theme}
          onDismiss={dismiss}
          action={toasts[0].action}
        />
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
