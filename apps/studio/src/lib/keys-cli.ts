import type { ApiKeyStore } from "./api-key-store";

const USAGE = [
  "사용법:",
  "  pnpm --filter studio keys create --name <이름> [--reports a,b]   키를 만들고 원문을 한 번만 출력한다",
  "  pnpm --filter studio keys list                                  키 목록 (원문 없음)",
  "  pnpm --filter studio keys revoke <kid>                          키 회수",
];

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** 키 관리 CLI 본체. scripts/keys.ts가 DB 저장소로 부르고, 테스트는 메모리 저장소를 넣는다. 반환값은 종료 코드 */
export async function runKeys(args: string[], store: ApiKeyStore, out: (line: string) => void): Promise<number> {
  const [cmd] = args;
  if (cmd === "create") {
    const name = flag(args, "--name");
    if (!name) { USAGE.forEach(out); return 1; }
    const reports = flag(args, "--reports");
    const allowed = reports ? reports.split(",").map((s) => s.trim()).filter(Boolean) : null;
    const { key, rawKey } = await store.create(name, allowed);
    out(`키를 만들었습니다: ${key.name} (kid ${key.kid}, 허용 레포트: ${allowed ? allowed.join(", ") : "전체"})`);
    out("아래 원문은 지금 한 번만 보입니다. 안전한 곳에 보관하세요:");
    out(rawKey);
    return 0;
  }
  if (cmd === "list") {
    const keys = await store.list();
    if (keys.length === 0) out("키가 없습니다");
    for (const k of keys) out(`${k.kid}  ${k.name}  허용: ${k.allowedReportIds ? k.allowedReportIds.join(",") : "전체"}  발급: ${k.createdAt}${k.revokedAt ? `  회수: ${k.revokedAt}` : ""}`);
    return 0;
  }
  if (cmd === "revoke" && args[1]) {
    await store.revoke(args[1]);
    out(`회수했습니다: ${args[1]}`);
    return 0;
  }
  USAGE.forEach(out);
  return 1;
}
