// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

// 시드가 다음 매크로태스크에서야 끝나는 저장소로, 라우트가 ready()를 기다린 뒤에 읽는지 확인한다
const seed = vi.hoisted(() => ({ reset: () => {} }));
vi.mock("@/lib/report-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/report-store")>();
  const { default: fixture } = await import("../../../../../../../packages/renderer/src/__tests__/fixtures/quality-cert.report.json");
  let store = new actual.MemoryReportStore();
  let seeded: Promise<void> | undefined;
  const start = () => {
    const target = store;
    return (seeded ??= new Promise<void>((r) => setTimeout(r, 0))
      .then(() => target.create(fixture as unknown as Parameters<typeof target.create>[0])).then(() => {}));
  };
  seed.reset = () => { store = new actual.MemoryReportStore(); seeded = undefined; };
  return { ...actual, getStore: () => { start(); return store; }, ready: start };
});
vi.mock("@daport/pdf", () => ({ renderPdf: async () => Buffer.from("%PDF-") }));

const { POST: preview } = await import("../[id]/preview/route");
const { POST: pdf } = await import("../[id]/pdf/route");

const call = (handler: typeof preview, kind: string) => handler(new Request(`http://localhost/api/reports/quality-cert/${kind}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ params: { lotNo: "L2609-0142" } }) }),
  { params: Promise.resolve({ id: "quality-cert" }) });

beforeEach(() => seed.reset());

describe("preview and PDF routes read the store only after the seed is ready", () => {
  it("preview finds the seeded report on the first request", async () => {
    expect((await call(preview, "preview")).status).toBe(200);
  });

  it("PDF finds the seeded report on the first request", async () => {
    expect((await call(pdf, "pdf")).status).toBe(200);
  });
});
