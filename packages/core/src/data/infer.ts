export type FieldType = "string" | "number" | "boolean" | "date" | "object" | "array" | "null";
export type FieldNode = { name: string; path: string; type: FieldType; children?: FieldNode[] };

/** ISO 8601 날짜·일시 (2026-09-17, 2026-09-17T05:02:00Z, 2026-09-17 05:02:00+09:00 등) */
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

function typeOf(v: unknown): FieldType {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  if (v instanceof Date) return "date";
  switch (typeof v) {
    case "number": return "number";
    case "boolean": return "boolean";
    case "string": return DATE_RE.test(v) ? "date" : "string";
    case "object": return "object";
    default: return "string";
  }
}

/** null이 아닌 가장 흔한 타입. 동률이면 string. 전부 null이면 null */
function pickType(counts: Map<FieldType, number>): FieldType {
  let best: FieldType | null = null, bestN = -1, tie = false;
  for (const [t, n] of counts) {
    if (t === "null") continue;
    if (n > bestN) { best = t; bestN = n; tie = false; }
    else if (n === bestN) tie = true;
  }
  if (best === null) return "null";
  return tie ? "string" : best;
}

function inferObjects(objs: Record<string, unknown>[], prefix: string, depth: number, maxDepth: number): FieldNode[] {
  const order: string[] = [];
  const counts = new Map<string, Map<FieldType, number>>();
  const nested = new Map<string, unknown[]>();     // object·array 값 (하위 필드 추론용)
  for (const o of objs) {
    for (const [k, v] of Object.entries(o)) {
      if (!counts.has(k)) { order.push(k); counts.set(k, new Map()); nested.set(k, []); }
      const t = typeOf(v);
      const c = counts.get(k)!;
      c.set(t, (c.get(t) ?? 0) + 1);
      if (t === "object" || t === "array") nested.get(k)!.push(v);
    }
  }
  return order.map((name) => {
    const type = pickType(counts.get(name)!);
    const path = prefix ? `${prefix}.${name}` : name;
    const node: FieldNode = { name, path, type };
    if (depth < maxDepth) {
      const vals = nested.get(name)!;
      if (type === "object") node.children = inferObjects(vals.filter(isObject), path, depth + 1, maxDepth);
      if (type === "array") node.children = inferObjects(vals.flatMap((a) => (Array.isArray(a) ? a.filter(isObject) : [])), path, depth + 1, maxDepth);
    }
    return node;
  });
}

/**
 * 행 배열(또는 객체 하나)의 앞 sampleSize행에서 필드 트리를 추론한다. 순수 함수.
 * 키는 처음 본 순서, 타입은 null이 아닌 가장 흔한 타입(동률이면 string). object·array는 깊이 maxDepth까지 하위 필드를 가진다.
 * columnTypes가 있으면(sql 데이터셋의 컬럼 타입 힌트) 최상위 키의 타입을 덮어쓰고, 행이 없어도 그 키들로 노드를 만든다
 */
export function inferFields(rows: unknown, opts: { sampleSize?: number; maxDepth?: number; columnTypes?: Record<string, FieldType> } = {}): FieldNode[] {
  const { sampleSize = 200, maxDepth = 5, columnTypes } = opts;
  const list = Array.isArray(rows) ? rows.slice(0, sampleSize) : isObject(rows) ? [rows] : [];
  const nodes = inferObjects(list.filter(isObject), "", 0, maxDepth);
  if (!columnTypes) return nodes;
  const byName = new Map(nodes.map((n) => [n.name, n]));
  for (const [name, type] of Object.entries(columnTypes)) {
    const node = byName.get(name);
    if (node) node.type = type;
    else nodes.push({ name, path: name, type });
  }
  return nodes;
}
