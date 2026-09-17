import net from "node:net";

export type Printer = { name: string; host: string; port: number };

/** DAPORT_PRINTERS="이름=host[:port],…" — 잘못된 항목은 버린다. 호스트는 응답에 넣지 않는다(라우트가 이름만 돌려준다) */
export function parsePrinters(value: string | undefined): Printer[] {
  const out: Printer[] = [];
  for (const entry of (value ?? "").split(",")) {
    const eq = entry.indexOf("=");
    if (eq <= 0) continue;
    const name = entry.slice(0, eq).trim(), addr = entry.slice(eq + 1).trim();
    if (!name || !addr) continue;
    const colon = addr.lastIndexOf(":");
    const host = colon >= 0 ? addr.slice(0, colon) : addr;
    const port = colon >= 0 ? Number(addr.slice(colon + 1)) : 9100;
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) continue;
    out.push({ name, host, port });
  }
  return out;
}

/** raw TCP 전송. 연결·쓰기가 timeoutMs 안에 끝나지 않으면 거부한다. 재시도하지 않는다(중복 인쇄 방지) */
export function sendRaw(printer: Printer, data: Buffer, timeoutMs = 10_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: printer.host, port: printer.port });
    const fail = (e: Error) => { sock.destroy(); reject(e); };
    sock.setTimeout(timeoutMs, () => fail(new Error(`printer ${printer.name} timed out after ${timeoutMs}ms`)));
    sock.on("error", fail);
    sock.on("connect", () => {
      sock.end(data, () => { sock.destroy(); resolve(data.length); });
    });
  });
}
