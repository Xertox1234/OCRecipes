import { File as ExpoFile } from "expo-file-system";

/**
 * Build a multipart part for an on-disk image.
 *
 * A file object with bytes(), not RN's `{ uri, type, name }`: the global fetch
 * is `expo/fetch` since SDK 57, and it rejects that shape ("Unsupported
 * FormDataPart implementation"). Name and MIME type come from the file's
 * extension, so an unknown or missing extension gives `type === null` — the
 * part would go out without a content-type, busboy would default it to
 * `text/plain`, and the server's multer filter would reject it with an unclear
 * error. Fail here with a clear one instead.
 */
export function createUploadFilePart(uri: string): ExpoFile {
  const file = new ExpoFile(uri);
  if (!file.type) {
    throw new Error(
      `Cannot upload ${uri}: unknown image type (no recognizable file extension)`,
    );
  }
  return file;
}
