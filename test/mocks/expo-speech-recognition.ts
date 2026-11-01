// Inert stand-in for expo-speech-recognition in Vitest. The real package
// loads a native module at import time, which does not exist under Node.
// Screens that carry a mic (useSpeechToText) import it transitively, so
// without this alias every screen test that renders one would fail to
// collect. Tests that exercise the hook itself override it with their own
// vi.mock("expo-speech-recognition", ...), which takes precedence.
export const ExpoSpeechRecognitionModule = {
  requestPermissionsAsync: () => Promise.resolve({ granted: false }),
  start: () => undefined,
  stop: () => undefined,
  abort: () => undefined,
};

export function useSpeechRecognitionEvent(
  _eventName: string,
  _listener: (event: unknown) => void,
): void {
  // no-op: no native events fire under test
}
