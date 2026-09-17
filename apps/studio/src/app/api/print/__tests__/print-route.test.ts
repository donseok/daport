// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import net from "node:net";

const renderLabel = vi.fn();
vi.mock("@daport/label", async (orig) => ({ ...(await orig<typeof import("@daport/label")>()), renderLabel }));
const { POST } = await import("../route");

const label = { id: "lb", version: 1, page: { width: 60, height: 40 }, output: { kind: "label", label: { language: "zpl", dpi: 203 } } };
const call = (body: unknown) => POST(new Request("http://localhost/api/print", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
let server: net.Server; let received: Buffer[]; let port: number;
beforeEach(async () => {
  received = [];
  server = net.createServer((s) => s.on("data", (d) => received.push(d)));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as net.AddressInfo).port;
  vi.stubEnv("DAPORT_PRINTERS", `가짜=127.0.0.1:${port}`);
  renderLabel.mockReset().mockResolvedValue({ language: "zpl", dpi: 203, pages: 2, data: Buffer.from("^XA^XZ\n^XA^XZ\n"), mime: "text/plain", filename: "lb.zpl" });
});
afterEach(async () => { vi.unstubAllEnvs(); await new Promise<void>((r) => server.close(() => r())); });

describe("POST /api/print", () => {
  it("renders the label and sends it to the named printer", async () => {
    const res = await call({ printer: "가짜", report: label, params: {} });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ printer: "가짜", bytes: 14, pages: 2 });
    await new Promise((r) => setTimeout(r, 50));
    expect(Buffer.concat(received).toString()).toBe("^XA^XZ\n^XA^XZ\n");
  });
  it("returns 400 for an unknown printer, a missing report, or a pdf report", async () => {
    expect((await call({ printer: "없음", report: label })).status).toBe(400);
    expect((await call({ printer: "가짜" })).status).toBe(400);
    expect((await call({ printer: "가짜", report: { ...label, output: { kind: "pdf" } } })).status).toBe(400);
    expect(renderLabel).not.toHaveBeenCalled();
  });
  it("returns 502 when the printer cannot be reached and never retries, without leaking the host/port", async () => {
    await new Promise<void>((r) => server.close(() => r()));
    server = net.createServer();   // afterEach가 닫을 수 있게 빈 서버로 바꿔 둔다 (listen 안 함)
    const res = await call({ printer: "가짜", report: label });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.printer).toBe("가짜");
    expect(body.error).not.toMatch(/127\.0\.0\.1|:\d{4,5}/);
    expect(renderLabel).toHaveBeenCalledTimes(1);
  });
});
