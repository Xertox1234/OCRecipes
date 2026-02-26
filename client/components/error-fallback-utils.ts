/**
 * Pure formatting utility for ErrorFallback.
 * Extracted for testability — no React or RN dependencies.
 */

/** Format error message and optional stack trace for display. */
export function formatErrorDetails(error: {
  message: string;
  stack?: string;
}): string {
  let details = `Error: ${error.message}\n\n`;
  if (error.stack) {
    details += `Stack Trace:\n${error.stack}`;
  }
  return details;
}
