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

/**
 * raw TCP 전송. 연결·쓰기가 timeoutMs 안에 끝나지 않으면 거부한다. 재시도하지 않는다(중복 인쇄 방지)
 * 거부 메시지에는 프린터 이름만 담는다 — 원본 Node 오류(호스트·포트 포함)는 cause로만 넘겨 서버 로그에서만 보이게 한다
 */
export function sendRaw(printer: Printer, data: Buffer, timeoutMs = 10_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: printer.host, port: printer.port });
    const fail = (message: string, cause: unknown) => { sock.destroy(); reject(new Error(message, { cause })); };
    sock.setTimeout(timeoutMs, () => fail(`프린터 "${printer.name}" 응답 시간 초과 (${timeoutMs}ms)`, new Error(`socket timeout after ${timeoutMs}ms`)));
    sock.on("error", (e) => fail(`프린터 "${printer.name}"에 연결하지 못했습니다`, e));
    sock.on("connect", () => {
      // end()의 콜백에서 바로 destroy()하지 않는다 — 이 콜백은 데이터가 커널로 넘어간
      // 시점에 불릴 뿐이라, 상대가 아직 안 읽은 데이터를 들고 있을 때 destroy()하면
      // 정상 FIN 대신 RST가 나가 라벨이 잘릴 수 있다. 소켓이 스스로 닫히도록 둔다.
      sock.end(data, () => resolve(data.length));
    });
  });
}
