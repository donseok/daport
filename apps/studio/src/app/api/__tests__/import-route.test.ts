// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { buildBundle } from "@/lib/bundle";
import { MAX_BODY_BYTES } from "@/lib/body";

const { POST } = await import("../import/route");
const { getStore, ready } = await import("@/lib/report-store");

// undici가 FormData 본문에 content-length를 자동으로 붙이지 않아, 라우트의 헤더 선검사(M1)를 통과하려면 직접 재야 한다.
// FormData를 두 Request에 각각 넘기면 그때마다 새 boundary로 직렬화돼 headers와 어긋나므로, 한 번 직렬화한 바이트(blob)를
// 그 직렬화가 낳은 content-type 헤더와 함께 그대로 재사용한다
async function multipart(fields: Record<string, string | File>): Promise<Request> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const probe = new Request("http://x", { method: "POST", body: form });
  const blob = await probe.blob();
  const headers = new Headers(probe.headers);
  headers.set("content-length", String(blob.size));
  return new Request("http://studio.local/api/import", { method: "POST", headers, body: blob });
}

describe("POST /api/import", () => {
  it("400 BUNDLE_INVALID for a non-zip file", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "bad.zip", { type: "application/zip" });
    const res = await POST(await multipart({ file }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BUNDLE_INVALID");
  });

  it("400 for a connectionMap that is not a JSON object of strings", async () => {
    const report = parseReport({ id: "imp-cm", name: "C", version: 1, page: { width: 100, height: 100 } });
    const zip = buildBundle([{ report, source: "draft" }], [], []);
    const file = new File([new Uint8Array(zip)], "x.zip", { type: "application/zip" });
    const res = await POST(await multipart({ file, connectionMap: JSON.stringify({ a: 1 }) }));
    expect(res.status).toBe(400);
  });

  it("creates a report on the success path and returns { imported, skipped, warnings }", async () => {
    await ready();
    const id = `imp-${Date.now()}`;
    const report = parseReport({ id, name: "N", version: 1, page: { width: 100, height: 100 } });
    const zip = buildBundle([{ report, source: "draft" }], [], []);
    const file = new File([new Uint8Array(zip)], "y.zip", { type: "application/zip" });
    const res = await POST(await multipart({ file }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: [{ id, action: "created" }], skipped: [], warnings: [] });
    expect(await getStore().get(id)).toMatchObject({ id });
  });

  it("411 when content-length is missing, without reading the body", async () => {
    const fakeReq = {
      headers: new Headers(),
      formData: async () => { throw new Error("본문을 읽으면 안 된다"); },
    } as unknown as Request;
    const res = await POST(fakeReq);
    expect(res.status).toBe(411);
    expect((await res.json()).error).toBe("content-length가 필요합니다");
  });

  // file.size 상한(413)은 req.formData()가 이미 본문 전체를 읽은 "뒤"에 걸리므로, 실제로 20MB를 할당하지 않고는
  // 재현하기 어렵다. 대신 그 앞의 content-length 선검사(:10-11)는 헤더만 보고 본문을 읽지 않으므로, formData가
  // 호출되지 않는 가짜 Request로 가볍게 재현한다
  it("413 when the declared content-length exceeds the cap, without reading the body", async () => {
    const fakeReq = {
      headers: new Headers({ "content-length": String(MAX_BODY_BYTES + 1) }),
      formData: async () => { throw new Error("본문을 읽으면 안 된다"); },
    } as unknown as Request;
    const res = await POST(fakeReq);
    expect(res.status).toBe(413);
  });
});
