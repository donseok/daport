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
});
