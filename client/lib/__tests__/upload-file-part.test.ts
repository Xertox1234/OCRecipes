import { createUploadFilePart } from "../upload-file-part";

const { fileType } = vi.hoisted(() => ({
  fileType: { value: "image/jpeg" as string | null },
}));

vi.mock("expo-file-system", () => ({
  File: class {
    type = fileType.value;
    constructor(public uri: string) {}
    bytes = async () => new Uint8Array();
  },
}));

describe("createUploadFilePart", () => {
  it("returns the file part when the MIME type is known", () => {
    fileType.value = "image/jpeg";
    const part = createUploadFilePart("file://photo.jpg");
    expect(part.type).toBe("image/jpeg");
  });

  it("throws a clear error when the file has no MIME type", () => {
    fileType.value = null;
    expect(() => createUploadFilePart("file://photo.noext")).toThrow(
      /unknown image type/,
    );
  });
});
