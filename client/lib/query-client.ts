import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { tokenStorage } from "./token-storage";
import { ApiError } from "./api-error";

/**
 * Gets the base URL for the Express API server (e.g., "http://localhost:3000")
 * @returns {string} The API base URL
 */
export function getApiUrl(): string {
  let host = process.env.EXPO_PUBLIC_DOMAIN;

  if (!host) {
    // Fallback for development — set EXPO_PUBLIC_DOMAIN in .env
    console.warn("EXPO_PUBLIC_DOMAIN not set, falling back to localhost:3000");
    return "http://localhost:3000";
  }

  // Check if host starts with http:// or https://
  if (host.startsWith("http://") || host.startsWith("https://")) {
    return host;
  }

  // For localhost, use http, otherwise use https
  const protocol = host.startsWith("localhost") ? "http" : "https";
  let url = new URL(`${protocol}://${host}`);

  return url.href;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    // Preserve the machine-readable `code` from the standard error body
    // ({ error, code? }) so callers can branch on it (e.g. PREMIUM_REQUIRED).
    let code: string | undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        typeof (parsed as { code?: unknown }).code === "string"
      ) {
        code = (parsed as { code: string }).code;
      }
    } catch {
      // Non-JSON error body — no machine-readable code to extract.
    }
    // Message keeps the `${status}: ${text}` shape so the 4xx retry guard
    // and existing message-based callers stay valid.
    throw new ApiError(`${res.status}: ${text}`, code);
  }
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
  init?: RequestInit,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const headers: Record<string, string> = {};
  if (data) {
    headers["Content-Type"] = "application/json";
  }

  const token = await tokenStorage.get();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...init,
    method,
    headers: { ...(init?.headers as Record<string, string>), ...headers },
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = getApiUrl();
    const url = new URL(queryKey.join("/") as string, baseUrl);

    const headers: Record<string, string> = {};
    const token = await tokenStorage.get();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(url, {
      headers,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

/**
 * Resolves a recipe image URL to a fully-qualified URI.
 * Handles absolute URLs (http/https), data URIs, and server-relative paths.
 */
export function resolveImageUrl(
  imageUrl: string | null | undefined,
): string | null {
  if (!imageUrl) return null;
  if (imageUrl.startsWith("http") || imageUrl.startsWith("data:"))
    return imageUrl;
  return `${getApiUrl()}${imageUrl}`;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: (failureCount, error) => {
        // Don't retry client errors (4xx) — only retry transient/server errors
        if (error instanceof Error && /^4\d\d:/.test(error.message))
          return false;
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
