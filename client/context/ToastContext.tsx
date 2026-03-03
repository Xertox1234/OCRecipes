import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";

import { Toast } from "@/components/Toast";
import { useTheme } from "@/hooks/useTheme";
import type { ToastVariant } from "@/components/toast-utils";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextType {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const show = useCallback((message: string, variant: ToastVariant) => {
    const id = nextId.current++;
    setToasts([{ id, message, variant }]);
  }, []);

  const dismiss = useCallback(() => {
    setToasts([]);
  }, []);

  const success = useCallback(
    (message: string) => show(message, "success"),
    [show],
  );
  const error = useCallback(
    (message: string) => show(message, "error"),
    [show],
  );
  const info = useCallback((message: string) => show(message, "info"), [show]);

  return (
    <ToastContext.Provider value={{ success, error, info }}>
      {children}
      {toasts.length > 0 && (
        <Toast
          key={toasts[0].id}
          message={toasts[0].message}
          variant={toasts[0].variant}
          theme={theme}
          onDismiss={dismiss}
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
