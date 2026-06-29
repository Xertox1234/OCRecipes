import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMock = vi.fn();
// Vitest 4 forwards `new` to the mock impl via Reflect.construct; arrow
// functions have no [[Construct]] slot, so the plan's arrow-function mocks
// throw "is not a constructor". Use regular function expressions (which a
// returned object short-circuits under `new`) so the SDK constructors are
// constructable. Test assertions and both URL contracts are unchanged.
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(function () {
    return { send: sendMock };
  }),
  PutObjectCommand: vi.fn(function (input) {
    return { __cmd: "Put", input };
  }),
  DeleteObjectCommand: vi.fn(function (input) {
    return { __cmd: "Delete", input };
  }),
}));

const R2_ENV = {
  R2_ACCOUNT_ID: "acct123",
  R2_ACCESS_KEY_ID: "ak",
  R2_SECRET_ACCESS_KEY: "sk",
  R2_BUCKET: "ocrecipes-images",
  R2_PUBLIC_BASE_URL: "https://img.example.com",
};

function setR2Env(on: boolean) {
  for (const k of Object.keys(R2_ENV)) delete process.env[k];
  if (on) Object.assign(process.env, R2_ENV);
}

async function load() {
  vi.resetModules();
  return await import("../image-store");
}

describe("image-store", () => {
  beforeEach(() => sendMock.mockReset().mockResolvedValue({}));
  afterEach(() => setR2Env(false));

  it("isR2Configured is false when any R2 var is missing", async () => {
    setR2Env(true);
    delete process.env.R2_BUCKET;
    const { isR2Configured } = await load();
    expect(isR2Configured()).toBe(false);
  });

  it("isR2Configured is true when all R2 vars are present", async () => {
    setR2Env(true);
    const { isR2Configured } = await load();
    expect(isR2Configured()).toBe(true);
  });

  it("saveRecipeImage uploads to R2 and returns an absolute CDN URL", async () => {
    setR2Env(true);
    const { saveRecipeImage } = await load();
    const url = await saveRecipeImage(Buffer.from("png-bytes"));
    expect(sendMock).toHaveBeenCalledTimes(1);
    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.__cmd).toBe("Put");
    expect(cmd.input.Bucket).toBe("ocrecipes-images");
    expect(cmd.input.Key).toMatch(/^recipe-images\/recipe-[0-9a-f-]+\.png$/);
    expect(cmd.input.ContentType).toBe("image/png");
    expect(url).toMatch(
      /^https:\/\/img\.example\.com\/recipe-images\/recipe-[0-9a-f-]+\.png$/,
    );
  });

  it("saveAvatar uploads under avatars/ with a random key and the given extension", async () => {
    setR2Env(true);
    const { saveAvatar } = await load();
    const url = await saveAvatar(Buffer.from("jpg-bytes"), "jpg");
    const cmd = sendMock.mock.calls[0][0];
    // Key must be a UUID — not userId/timestamp, which leak on the public CDN
    expect(cmd.input.Key).toMatch(/^avatars\/[0-9a-f-]{36}\.jpg$/);
    expect(cmd.input.ContentType).toBe("image/jpeg");
    expect(url).toMatch(
      /^https:\/\/img\.example\.com\/avatars\/[0-9a-f-]{36}\.jpg$/,
    );
  });

  it("deleteImage sends a DeleteObjectCommand for an R2 URL", async () => {
    setR2Env(true);
    const { deleteImage } = await load();
    await deleteImage(
      "https://img.example.com/avatars/user-42-1.jpg",
      "avatar",
    );
    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.__cmd).toBe("Delete");
    expect(cmd.input.Key).toBe("avatars/user-42-1.jpg");
  });

  it("deleteImage deletes a recipe-images R2 object for kind=recipe", async () => {
    setR2Env(true);
    const { deleteImage } = await load();
    await deleteImage(
      "https://img.example.com/recipe-images/recipe-abc.png",
      "recipe",
    );
    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.__cmd).toBe("Delete");
    expect(cmd.input.Key).toBe("recipe-images/recipe-abc.png");
  });

  it("deleteImage strips a cache-busting ?v= query from the derived R2 key", async () => {
    setR2Env(true);
    const { deleteImage } = await load();
    await deleteImage(
      "https://img.example.com/recipe-images/recipe-abc.png?v=1719600000000",
      "recipe",
    );
    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.__cmd).toBe("Delete");
    // Key must NOT include the query — else the real object is never deleted (orphan).
    expect(cmd.input.Key).toBe("recipe-images/recipe-abc.png");
  });

  it("deleteImage refuses an R2 key outside the kind's prefix (no delete)", async () => {
    setR2Env(true);
    const { deleteImage } = await load();
    // avatar object passed with kind=recipe — must not be deleted (IDOR guard)
    await deleteImage("https://img.example.com/avatars/victim.jpg", "recipe");
    // recipe object passed with kind=avatar — must not be deleted
    await deleteImage(
      "https://img.example.com/recipe-images/recipe-abc.png",
      "avatar",
    );
    // arbitrary bucket key derivable from the URL — must not be deleted
    await deleteImage("https://img.example.com/other/whatever.bin", "recipe");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects oversized recipe images", async () => {
    setR2Env(true);
    const { saveRecipeImage } = await load();
    const tooBig = Buffer.alloc(10 * 1024 * 1024 + 1);
    await expect(saveRecipeImage(tooBig)).rejects.toThrow(/too large/i);
  });

  it("disk fallback returns a relative path when R2 is unconfigured", async () => {
    setR2Env(false);
    const fsp = await import("node:fs");
    // `mkdir` returns Promise<string | undefined> and `writeFile` returns
    // Promise<void>; both accept `undefined` without a cast. The plan used
    // `undefined as never`, but the repo's no-restricted-syntax ESLint rule
    // forbids `as never` in tests — the resolved value and assertions are
    // unchanged.
    vi.spyOn(fsp.default.promises, "mkdir").mockResolvedValue(undefined);
    vi.spyOn(fsp.default.promises, "writeFile").mockResolvedValue(undefined);
    const { saveRecipeImage } = await load();
    const url = await saveRecipeImage(Buffer.from("png-bytes"));
    expect(url).toMatch(/^\/api\/recipe-images\/recipe-[0-9a-f-]+\.png$/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("deleteImage removes a legacy disk file when R2 is unconfigured", async () => {
    setR2Env(false);
    const fsp = await import("node:fs");
    const unlinkSpy = vi
      .spyOn(fsp.default.promises, "unlink")
      .mockResolvedValue(undefined);
    const { deleteImage } = await load();
    await deleteImage("/api/avatars/user-42-1.jpg", "avatar");
    expect(unlinkSpy).toHaveBeenCalledTimes(1);
    const calledPath = unlinkSpy.mock.calls[0][0] as string;
    expect(calledPath).toMatch(/uploads\/avatars\/user-42-1\.jpg$/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("deleteImage refuses a legacy disk path outside the kind's prefix", async () => {
    setR2Env(false);
    const fsp = await import("node:fs");
    const unlinkSpy = vi
      .spyOn(fsp.default.promises, "unlink")
      .mockResolvedValue(undefined);
    const { deleteImage } = await load();
    await deleteImage("/api/avatars/victim.jpg", "recipe");
    await deleteImage("/api/recipe-images/recipe-abc.png", "avatar");
    expect(unlinkSpy).not.toHaveBeenCalled();
  });

  it("deleteImage strips path traversal from a legacy disk URL (basename)", async () => {
    setR2Env(false);
    const fsp = await import("node:fs");
    const unlinkSpy = vi
      .spyOn(fsp.default.promises, "unlink")
      .mockResolvedValue(undefined);
    const { deleteImage } = await load();
    await deleteImage("/api/avatars/../../etc/passwd", "avatar");
    expect(unlinkSpy).toHaveBeenCalledTimes(1);
    const calledPath = unlinkSpy.mock.calls[0][0] as string;
    expect(calledPath).not.toContain("..");
    expect(calledPath).toMatch(/uploads\/avatars\/passwd$/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("deleteImage is a no-op for an unrecognized URL", async () => {
    setR2Env(true);
    const { deleteImage } = await load();
    await deleteImage("https://other.cdn.com/img.jpg", "avatar");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("handles a trailing slash in R2_PUBLIC_BASE_URL without doubling", async () => {
    setR2Env(true);
    process.env.R2_PUBLIC_BASE_URL = "https://img.example.com/";
    const { saveRecipeImage } = await load();
    const url = await saveRecipeImage(Buffer.from("png"));
    expect(url).not.toMatch(/example\.com\/\/+/);
    expect(url).toMatch(/^https:\/\/img\.example\.com\/recipe-images\//);
  });

  it("saveAvatar sets image/webp content-type for webp", async () => {
    setR2Env(true);
    const { saveAvatar } = await load();
    await saveAvatar(Buffer.from("webp"), "webp");
    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.input.ContentType).toBe("image/webp");
    expect(cmd.input.Key).toMatch(/^avatars\/[0-9a-f-]{36}\.webp$/);
  });
});
