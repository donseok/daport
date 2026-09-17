// @vitest-environment node
import { describe, it, expect } from "vitest";
import net from "node:net";
import { parsePrinters, sendRaw } from "../printers";

describe("parsePrinters", () => {
  it("parses name=host[:port] entries, defaulting the port to 9100", () => {
    expect(parsePrinters("라인1=192.168.10.21:9100, 포장=printer.local ,,bad,=x,y=")).toEqual([
      { name: "라인1", host: "192.168.10.21", port: 9100 }, { name: "포장", host: "printer.local", port: 9100 }]);
    expect(parsePrinters(undefined)).toEqual([]);
    expect(parsePrinters("a=h:notaport")).toEqual([]);
  });
});

describe("sendRaw", () => {
  it("sends the bytes to a TCP server and resolves with the byte count", async () => {
    const received: Buffer[] = [];
    const server = net.createServer((sock) => { sock.on("data", (d) => received.push(d)); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    const bytes = await sendRaw({ name: "t", host: "127.0.0.1", port }, Buffer.from("^XA^XZ\n"), 2000);
    expect(bytes).toBe(7);
    await new Promise((r) => setTimeout(r, 50));
    expect(Buffer.concat(received).toString()).toBe("^XA^XZ\n");
    await new Promise<void>((r) => server.close(() => r()));
  });
  it("rejects when the printer refuses the connection, with a sanitized message and the original error as cause", async () => {
    const server = net.createServer(); await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    await new Promise<void>((r) => server.close(() => r()));   // 닫힌 포트
    const err = await sendRaw({ name: "t", host: "127.0.0.1", port }, Buffer.from("x"), 2000).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('프린터 "t"에 연결하지 못했습니다');
    expect(err.message).not.toMatch(/127\.0\.0\.1|:\d{4,5}/);
    expect(err.cause).toBeInstanceOf(Error);
  });
  it("rejects with a sanitized timeout message and cause when the printer never responds", async () => {
    // 연결은 받아주지만 아무것도 읽지 않는 서버. 커널 수신 버퍼보다 훨씬 큰 페이로드를 보내
    // sock.end()의 flush가 절대 끝나지 않게 만든다 — 타임아웃만이 유일하게 가능한 결과라 레이스가 없다
    let accepted: net.Socket | undefined;
    const server = net.createServer((sock) => { accepted = sock; });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    const bigPayload = Buffer.alloc(64 * 1024 * 1024);
    const err = await sendRaw({ name: "t", host: "127.0.0.1", port }, bigPayload, 100).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/응답 시간 초과/);
    expect(err.cause).toBeInstanceOf(Error);
    accepted?.destroy();   // 클라이언트가 destroy()로 RST를 보내도, 서버 쪽 소켓은 정리해야 close()가 끝난다
    await new Promise<void>((r) => server.close(() => r()));
  });
});
