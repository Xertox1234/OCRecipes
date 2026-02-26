/**
 * Wrapper utility for rendering React Native components in jsdom tests.
 * Provides ThemeContext and QueryClientProvider so components
 * behave as they would in the real app.
 */
import React from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** Create a fresh wrapper per render call to avoid shared state. */
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

/**
 * Render a component wrapped with QueryClientProvider.
 * Theme is provided by the mocked react-native `useColorScheme` → `useTheme()`.
 */
export function renderComponent(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return render(ui, { wrapper: createWrapper(), ...options });
}
