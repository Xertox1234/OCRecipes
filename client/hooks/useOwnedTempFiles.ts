import { useCallback, useEffect, useRef } from "react";
import { deleteAsync } from "expo-file-system/legacy";

function deleteTempFile(uri: string): void {
  deleteAsync(uri, { idempotent: true }).catch(() => {});
}

/**
 * Track temp files a screen owns (camera captures, gallery-pick cache copies)
 * and delete them all when the screen unmounts. Returns a stable `own(uri)`;
 * a uri owned after unmount (a capture that finished late) is deleted at once.
 *
 * For screens whose files are not handed to another screen — the caller must
 * not `own` a uri it later passes on by route param.
 */
export function useOwnedTempFiles(): (uri: string) => void {
  const urisRef = useRef(new Set<string>());
  const unmountedRef = useRef(false);

  useEffect(() => {
    // Reset on (re)mount: StrictMode's dev double-invoke runs the cleanup once
    // before the real mount.
    unmountedRef.current = false;
    const uris = urisRef.current;
    return () => {
      unmountedRef.current = true;
      uris.forEach(deleteTempFile);
      uris.clear();
    };
  }, []);

  return useCallback((uri: string) => {
    if (unmountedRef.current) {
      deleteTempFile(uri);
      return;
    }
    urisRef.current.add(uri);
  }, []);
}
