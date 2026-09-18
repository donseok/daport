import { getStore, ready } from "./report-store";

/** 이 연결 이름을 쓰는 저장된 레포트 id. 색인이 없으므로 draft 전체를 훑는다 (컴포넌트 사용처와 같은 방식) */
export async function findConnectionUsage(name: string): Promise<string[]> {
  const all = await findAllConnectionUsage();
  return all[name] ?? [];
}

/**
 * 모든 연결 이름 → 그 연결을 쓰는 레포트 id 목록. draft 전체를 단 한 번만 훑어서 모든 연결을 한꺼번에 버킷화한다
 * (연결마다 findConnectionUsage를 부르면 레포트 수만큼 전체 스캔이 반복된다 — GET /api/connections가 이 문제였다)
 */
export async function findAllConnectionUsage(): Promise<Record<string, string[]>> {
  await ready();
  const store = getStore();
  const out: Record<string, string[]> = {};
  for (const s of await store.list()) {
    const r = await store.get(s.id);
    if (!r) continue;
    for (const d of r.datasets) {
      if (d.type !== "sql") continue;
      (out[d.connection] ??= []).push(r.id);
    }
  }
  return out;
}
