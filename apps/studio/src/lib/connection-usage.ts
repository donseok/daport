import { getStore, ready } from "./report-store";

/** 이 연결 이름을 쓰는 저장된 레포트 id. 색인이 없으므로 draft 전체를 훑는다 (컴포넌트 사용처와 같은 방식) */
export async function findConnectionUsage(name: string): Promise<string[]> {
  await ready();
  const store = getStore();
  const out: string[] = [];
  for (const s of await store.list()) {
    const r = await store.get(s.id);
    if (r?.datasets.some((d) => d.type === "sql" && d.connection === name)) out.push(r.id);
  }
  return out;
}
