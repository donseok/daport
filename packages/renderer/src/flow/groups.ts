export type GroupRun = { level: number; start: number; end: number; key: unknown; index: number };
export type GroupContext = { key: unknown; rows: unknown[]; index: number; level: number };

const keyOf = (v: unknown) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);
/** 그룹 키 비교. 객체는 JSON 문자열로, 그 밖은 === (문자열 "1"과 숫자 1은 다르다) */
export function sameKey(a: unknown, b: unknown): boolean { return keyOf(a) === keyOf(b); }

/**
 * 데이터 순서대로 연속된 같은 키를 구간으로 나눈다(자동 정렬 없음). 바깥 레벨의 경계는 안쪽 레벨의 경계이기도 하다.
 * keys[level][i]는 i번째 행의 level 그룹 키
 */
export function computeGroupRuns(keys: unknown[][], count: number): GroupRun[][] {
  return keys.map((_, level) => {
    const runs: GroupRun[] = [];
    let start = 0;
    for (let i = 1; i <= count; i++) {
      const boundary = i === count || keys.slice(0, level + 1).some((k) => !sameKey(k[i], k[i - 1]));
      if (boundary) { runs.push({ level, start, end: i, key: keys[level][start], index: runs.length }); start = i; }
    }
    return runs;
  });
}

/** [level][i] → i번째 행이 속한 구간 */
export function runsByRow(runs: GroupRun[][], count: number): GroupRun[][] {
  return runs.map((levelRuns) => {
    const byRow: GroupRun[] = new Array(count);
    for (const run of levelRuns) for (let i = run.start; i < run.end; i++) byRow[i] = run;
    return byRow;
  });
}

const contexts = new WeakMap<GroupRun, GroupContext>();
/** 표현식의 group 변수. rows 조각은 구간마다 한 번만 만든다 (1만 행에서 행마다 slice하지 않기 위해) */
export function groupContext(run: GroupRun, rows: unknown[]): GroupContext {
  let g = contexts.get(run);
  if (!g) { g = { key: run.key, rows: rows.slice(run.start, run.end), index: run.index, level: run.level }; contexts.set(run, g); }
  return g;
}
