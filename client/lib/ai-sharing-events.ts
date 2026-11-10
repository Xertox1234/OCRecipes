/**
 * "The server refused an AI request because AI sharing is off" (privacy audit
 * H3), as an app-wide signal. Every failed request becomes an `ApiError`, so
 * `ApiError` raises it and the root navigator answers by asking the question
 * again — no AI screen needs its own check.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function onAiSharingRequired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyAiSharingRequired(): void {
  listeners.forEach((listener) => listener());
}
