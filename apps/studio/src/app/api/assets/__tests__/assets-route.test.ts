// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const list = vi.fn();
const put = vi.fn();
vi.mock("@vercel/blob", () => ({ list, put }));
const { GET: getAsset } = await import("../[id]/route");
const { GET: listAssets, POST: uploadAsset } = await import("../route");

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const upload = (file = new File(["png"], "stamp.png", { type: "image/png" })) => {
  const form = new FormData();
  form.set("file", file);
  return new Request("http://localhost/api/assets", { method: "POST", body: form });
};

const saved = process.env.BLOB_READ_WRITE_TOKEN;
beforeEach(() => { list.mockReset(); put.mockReset(); });
afterEach(() => {
  if (saved === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = saved;
});

describe("asset routes without BLOB_READ_WRITE_TOKEN", () => {
  beforeEach(() => { delete process.env.BLOB_READ_WRITE_TOKEN; });

  it("GET /api/assets/[id] answers 503 JSON without calling the storage", async () => {
    const res = await getAsset(new Request("http://localhost/api/assets/a1"), ctx("a1"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "asset storage not configured" });
    expect(list).not.toHaveBeenCalled();
  });

  it("POST and GET /api/assets answer 503 JSON without calling the storage", async () => {
    for (const res of [await uploadAsset(upload()), await listAssets()]) {
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "asset storage not configured" });
    }
    expect(put).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
});

describe("GET /api/assets/[id] with storage configured", () => {
  beforeEach(() => { process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test"; });

  it("redirects to the stored blob", async () => {
    list.mockResolvedValue({ blobs: [{ url: "https://blob.example/assets/a1-stamp.png" }] });
    const res = await getAsset(new Request("http://localhost/api/assets/a1"), ctx("a1"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://blob.example/assets/a1-stamp.png");
    expect(list).toHaveBeenCalledWith({ prefix: "assets/a1-" });
  });

  it("answers 404 when no blob has the id", async () => {
    list.mockResolvedValue({ blobs: [] });
    expect((await getAsset(new Request("http://localhost/api/assets/a1"), ctx("a1"))).status).toBe(404);
  });

  it("answers 502 JSON when the storage call fails", async () => {
    list.mockRejectedValue(new Error("Vercel Blob: Access denied"));
    const res = await getAsset(new Request("http://localhost/api/assets/a1"), ctx("a1"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("Access denied");
  });
});

describe("POST /api/assets with storage configured", () => {
  beforeEach(() => { process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test"; });

  it("uploads an image with its content type", async () => {
    put.mockResolvedValue({ url: "https://blob.example/assets/x-stamp.png" });
    const res = await uploadAsset(upload());
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ url: "https://blob.example/assets/x-stamp.png", name: "stamp.png" });
    expect(put).toHaveBeenCalledWith(expect.stringMatching(/^assets\/.+-stamp\.png$/), expect.any(File),
      expect.objectContaining({ contentType: "image/png" }));
  });

  it("answers 413 JSON for a file larger than 5 MB without calling the storage", async () => {
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    const res = await uploadAsset(upload(big));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "file too large" });
    expect(put).not.toHaveBeenCalled();
  });

  it("accepts a file of exactly 5 MB", async () => {
    put.mockResolvedValue({ url: "https://blob.example/assets/x-edge.png" });
    const edge = new File([new Uint8Array(5 * 1024 * 1024)], "edge.png", { type: "image/png" });
    expect((await uploadAsset(upload(edge))).status).toBe(201);
  });

  it.each(["text/html", "application/octet-stream", ""])("answers 415 JSON for content type %j without calling the storage", async (type) => {
    const res = await uploadAsset(upload(new File(["<script>x</script>"], "evil.html", { type })));
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "unsupported file type" });
    expect(put).not.toHaveBeenCalled();
  });

  it.each(["image/jpeg", "image/webp", "image/gif", "image/svg+xml"])("accepts %s", async (type) => {
    put.mockResolvedValue({ url: "https://blob.example/assets/x-a" });
    expect((await uploadAsset(upload(new File(["x"], "a", { type })))).status).toBe(201);
    expect(put).toHaveBeenCalledWith(expect.any(String), expect.any(File), expect.objectContaining({ contentType: type }));
  });
});
