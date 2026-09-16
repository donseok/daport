// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const list = vi.fn();
const put = vi.fn();
vi.mock("@vercel/blob", () => ({ list, put }));
const { GET: getAsset } = await import("../[id]/route");
const { GET: listAssets, POST: uploadAsset } = await import("../route");

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const upload = () => {
  const form = new FormData();
  form.set("file", new File(["png"], "stamp.png", { type: "image/png" }));
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
