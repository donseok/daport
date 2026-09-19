import { FORBIDDEN_CONTEXT_KEYS, RESERVED_CONTEXT_NAMES, safeParseReport, type Element, type Report } from "@daport/core";
import { AiValidationError } from "./types";

const MAX_ROWS = 20;
/** 이관이 한 번에 만들 수 있는 요소 수 상한(스펙 5.3). prompts/import.ko.ts의 문구도 이 값을 그대로 쓴다 */
export const MAX_IMPORT_ELEMENTS = 120;
const DATASET_NAME_RE = /^rows[0-9]+$/;
const PARAM_TYPES = new Set(["string", "number", "date"]);
/** 파라미터 이름으로 쓰면 안 되는 것들. core의 예약어·프로토타입 오염 키를 그대로 가져와 한 곳만 관리한다 */
const FORBIDDEN_PARAM_NAMES = new Set<string>([...FORBIDDEN_CONTEXT_KEYS, ...RESERVED_CONTEXT_NAMES]);

/**
 * `params` 참조를 점(`params.x`)·대괄호(`params["x"]`, `params['x']`, 공백 포함)로 찾는다.
 * 매치했지만 이름을 뽑아내지 못하면(`params[x]`처럼 계산된 키, `params` 단독 사용 등) 신뢰할 수 없는 참조로 본다
 */
const PARAMS_REF_RE = /(?<![.\w$])params(?![\w$])(?:\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)|\s*\[\s*(?:'([^']*)'|"([^"]*)")\s*\])?/g;
/** `row`·`record` 참조. 표 밖에서는 어떤 형태(점·대괄호·단독)로 와도 금지한다 */
const ROW_RE = /(?<![.\w$])(row|record)(?![\w$])/;

export type ImportParam = { name: string; type: "string" | "number" | "date" };
export type ImportDataset = { name: string; type: "static"; rows: Record<string, unknown>[] };
export type ImportResult = { elements: Element[]; params: ImportParam[]; datasets: ImportDataset[]; warnings: string[] };

/** 모델이 낸 JSON 문자열 배열을 파싱한다. 깨진 항목은 버리고 경고만 남긴다 */
function parseItems(raw: unknown, label: string, warnings: string[]): unknown[] {
  if (!Array.isArray(raw)) return [];
  const out: unknown[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      warnings.push(`${label} 항목이 문자열이 아니라 건너뜀`);
      continue;
    }
    try {
      out.push(JSON.parse(item));
    } catch {
      warnings.push(`${label} JSON을 읽지 못해 건너뜀`);
    }
  }
  return out;
}

/**
 * 요소가 직접 가진 자식 배열들. 아직 스키마 검증 전이라 core의 childArrays(스키마 타입 전제)를
 * 그대로 쓸 수 없어, packages/core/src/schema/tree.ts와 같은 키를 plain object 기준으로 다시 훑는다.
 * group → [children], repeater → [item.children, 그룹마다 header·footer children]
 */
function childArrays(el: Record<string, unknown>): Record<string, unknown>[][] {
  const out: Record<string, unknown>[][] = [];
  if (el.type === "group" && Array.isArray(el.children)) {
    out.push(el.children as Record<string, unknown>[]);
  }
  if (el.type === "repeater") {
    const item = el.item as Record<string, unknown> | undefined;
    if (item && Array.isArray(item.children)) out.push(item.children as Record<string, unknown>[]);
    const groups = Array.isArray(el.groups) ? (el.groups as Record<string, unknown>[]) : [];
    for (const g of groups) {
      const header = g.header as Record<string, unknown> | undefined;
      const footer = g.footer as Record<string, unknown> | undefined;
      if (header && Array.isArray(header.children)) out.push(header.children as Record<string, unknown>[]);
      if (footer && Array.isArray(footer.children)) out.push(footer.children as Record<string, unknown>[]);
    }
  }
  return out;
}

/** 0-1000 정규화 좌표를 mm으로. 가로는 페이지 너비, 세로는 높이 기준이다 */
function toMm(el: Record<string, unknown>, page: { width: number; height: number }): void {
  const sx = (n: number) => (n / 1000) * page.width;
  const sy = (n: number) => (n / 1000) * page.height;
  if (typeof el.x === "number") el.x = sx(el.x);
  if (typeof el.w === "number") el.w = sx(el.w);
  if (typeof el.y === "number") el.y = sy(el.y);
  if (typeof el.h === "number") el.h = sy(el.h);
  // 표 열 너비도 가로 기준으로 바꾼다 — 합이 표 w와 같아야 스키마·렌더가 맞는다
  if (el.type === "table" && Array.isArray(el.columns)) {
    for (const c of el.columns as Record<string, unknown>[]) if (typeof c.w === "number") c.w = sx(c.w);
  }
  for (const child of childArrays(el)) for (const c of child) toMm(c, page);
}

/**
 * 문자열 하나를 검사해 필요하면 비운다. allowRow가 true면 표 열처럼 행 컨텍스트에서 평가되는
 * 값이라 row·record 참조를 허용한다. params 참조는 항상 이름을 뽑아 allowed에 있는지 본다 —
 * 이름을 뽑을 수 없는 참조(계산된 키 등)는 신뢰할 수 없으므로 비운다
 */
function cleanExpr(v: string, allowed: Set<string>, warnings: string[], allowRow: boolean): string {
  for (const m of v.matchAll(PARAMS_REF_RE)) {
    const name = m[1] ?? m[2] ?? m[3] ?? null;
    if (name === null) {
      warnings.push("파라미터 참조를 식별할 수 없어 표현식을 비웠습니다");
      return "";
    }
    if (!allowed.has(name)) {
      warnings.push(`선언되지 않은 파라미터 ${name}를 써서 표현식을 비웠습니다`);
      return "";
    }
  }
  if (!allowRow && ROW_RE.test(v)) {
    warnings.push("표 밖에서 row 참조를 써서 표현식을 비웠습니다");
    return "";
  }
  return v;
}

/**
 * 요소 트리의 모든 문자열 값을 제자리에서 고친다. row·record 참조는 표 밖에서만 막는다.
 * 표 요소 자신의 value·src·visible은 다른 요소와 똑같이 검사하고, 행 컨텍스트를 쓰는 열 value만 예외로 둔다
 */
function fixExpressions(el: Record<string, unknown>, allowed: Set<string>, warnings: string[]): void {
  if (typeof el.value === "string") el.value = cleanExpr(el.value, allowed, warnings, false);
  if (typeof el.src === "string") el.src = cleanExpr(el.src, allowed, warnings, false);
  if (typeof el.visible === "string") el.visible = cleanExpr(el.visible, allowed, warnings, false);
  if (el.type === "table" && Array.isArray(el.columns)) {
    for (const c of el.columns as Record<string, unknown>[]) {
      if (typeof c.value === "string") c.value = cleanExpr(c.value, allowed, warnings, true);
    }
  }
  for (const child of childArrays(el)) for (const c of child) fixExpressions(c, allowed, warnings);
}

/**
 * 최상위 요소를 페이지 안으로 민다. 자식 좌표는 부모(자기 자신) 기준 상대좌표라 렌더러가
 * flatten할 때 부모 원점을 더해준다(packages/renderer/src/layout/flatten.ts) — 부모만 옮기면
 * 자식은 이미 부모를 따라간 것이므로 자식 좌표는 그대로 둔다
 */
function clampToPage(el: Record<string, unknown>, page: { width: number; height: number }, warnings: string[]): void {
  const w = typeof el.w === "number" ? el.w : 0;
  const h = typeof el.h === "number" ? el.h : 0;
  const x = typeof el.x === "number" ? el.x : 0;
  const y = typeof el.y === "number" ? el.y : 0;
  const nx = Math.min(Math.max(0, x), Math.max(0, page.width - w));
  const ny = Math.min(Math.max(0, y), Math.max(0, page.height - h));
  if (nx !== x || ny !== y) {
    warnings.push(`요소 ${String(el.id)}를 페이지 안으로 옮겼습니다`);
    el.x = nx;
    el.y = ny;
  }
}

/**
 * 이관 응답을 검증한다 (스펙 6장): 파싱 → mm 변환 → 페이지 보정 → id 정리 →
 * params 병합 → datasets 규칙 → parseReport. 원본 report는 건드리지 않는다
 */
export function validateImported(report: Report, raw: unknown, page: { width: number; height: number }): ImportResult {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { elements?: unknown }).elements)) {
    throw new AiValidationError("응답에 elements 배열이 없습니다");
  }
  const warnings: string[] = [];
  const r = raw as { elements: unknown[]; params?: unknown; datasets?: unknown };

  // 배열·null 등 객체가 아닌 항목은 스키마 검증까지 가지 않고 여기서 버린다
  const parsedElements = parseItems(r.elements, "요소", warnings).filter((e): e is Record<string, unknown> => {
    if (typeof e !== "object" || e === null || Array.isArray(e)) {
      warnings.push("요소 JSON이 객체가 아니라 건너뜀");
      return false;
    }
    return true;
  });
  // 프롬프트가 120개를 상한으로 지시하지만 모델이 넘겨 낼 수 있으므로 여기서도 강제한다(스펙 5.3)
  const elements = parsedElements.slice(0, MAX_IMPORT_ELEMENTS);
  if (parsedElements.length > MAX_IMPORT_ELEMENTS) {
    warnings.push(`요소가 ${MAX_IMPORT_ELEMENTS}개를 넘어 ${parsedElements.length - MAX_IMPORT_ELEMENTS}개를 버렸습니다`);
  }

  // params: 이름·타입 규칙을 통과한 것만. 기존 이름과 겹치면 모델 쪽을 버린다
  const existing = new Set(report.params.map((p) => p.name));
  const params: ImportParam[] = [];
  for (const p of parseItems(r.params, "파라미터", warnings)) {
    const o = p as { name?: unknown; type?: unknown };
    const name = typeof o.name === "string" ? o.name : "";
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      warnings.push(`파라미터 이름 규칙을 어겨 버렸습니다: ${name}`);
      continue;
    }
    if (FORBIDDEN_PARAM_NAMES.has(name)) {
      warnings.push(`예약된 이름이라 파라미터로 쓸 수 없어 버렸습니다: ${name}`);
      continue;
    }
    if (existing.has(name)) continue;
    const type = typeof o.type === "string" && PARAM_TYPES.has(o.type) ? (o.type as ImportParam["type"]) : "string";
    params.push({ name, type });
    existing.add(name);
  }

  // datasets: rows<N> 정적만, 20행까지
  const datasets: ImportDataset[] = [];
  for (const d of parseItems(r.datasets, "데이터셋", warnings)) {
    const o = d as { name?: unknown; rows?: unknown };
    const name = typeof o.name === "string" ? o.name : "";
    if (!DATASET_NAME_RE.test(name)) {
      warnings.push(`데이터셋 이름 규칙(rows<숫자>)을 어겨 버렸습니다: ${name}`);
      continue;
    }
    // 배열·null 등 객체가 아닌 행은 요소와 같은 방식으로 그 행만 버린다 — 표 하나 전체를 무효로 만들지 않는다
    const rawRows = Array.isArray(o.rows) ? o.rows : [];
    const rows: Record<string, unknown>[] = [];
    for (const row of rawRows) {
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        warnings.push(`${name}의 행이 객체가 아니라 건너뜀`);
        continue;
      }
      rows.push(row as Record<string, unknown>);
    }
    if (rows.length > MAX_ROWS) warnings.push(`${name}의 행이 많아 ${MAX_ROWS}행까지만 남겼습니다`);
    datasets.push({ name, type: "static", rows: rows.slice(0, MAX_ROWS) });
  }

  // 남은 데이터셋이 없는 표는 렌더할 수 없다 — 표를 함께 버린다
  const names = new Set(datasets.map((d) => d.name));
  const kept = elements.filter((e) => {
    // 좌표가 유한수가 아니면(Infinity·NaN 등) mm 변환·클램프 계산이 깨지므로 스케일링 전에 버린다
    if (!["x", "y", "w", "h"].every((k) => typeof e[k] === "number" && Number.isFinite(e[k] as number))) {
      warnings.push(`좌표가 유효한 수가 아니라 요소를 버렸습니다: ${String(e.id)}`);
      return false;
    }
    if (e.type !== "table") return true;
    const src = typeof e.source === "string" ? e.source : "";
    if (names.has(src)) return true;
    warnings.push(`데이터셋 ${src || "(없음)"}을 쓸 수 없어 표를 버렸습니다`);
    return false;
  });
  // 표가 하나도 남지 않았으면 데이터셋도 의미가 없다
  const usedNames = new Set(kept.filter((e) => e.type === "table").map((e) => String(e.source)));
  const finalDatasets = datasets.filter((d) => usedNames.has(d.name));

  // existing에는 report가 이미 가진 파라미터 이름(호출자가 낸 문서라 예약어를 걸러낸 적이 없다)이 섞여 있다.
  // 표현식에서 실제로 쓸 수 있게 허용하는 이름 집합에서는 새 이름과 똑같이 금지 목록을 통과시킨다
  const allowed = new Set([...params.map((p) => p.name), ...existing].filter((n) => !FORBIDDEN_PARAM_NAMES.has(n)));
  for (const e of kept) {
    toMm(e, page);
    fixExpressions(e, allowed, warnings);
    clampToPage(e, page, warnings);
  }

  // id 중복 정리
  const seen = new Set<string>();
  for (const e of kept) {
    let id = typeof e.id === "string" && e.id ? e.id : `${String(e.type)}-1`;
    if (seen.has(id)) {
      let n = 2;
      while (seen.has(`${id}-${n}`)) n += 1;
      warnings.push(`id 충돌로 ${id} → ${id}-${n}로 바꿨습니다`);
      id = `${id}-${n}`;
    }
    e.id = id;
    seen.add(id);
  }

  const candidate = {
    ...report,
    elements: kept,
    params: [...report.params, ...params],
    datasets: [...report.datasets, ...finalDatasets],
  };
  const parsed = safeParseReport(candidate);
  if (!parsed.success) {
    const msgs = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new AiValidationError(`인식 결과가 스키마를 통과하지 못했습니다: ${msgs}`);
  }
  return { elements: parsed.data.elements, params, datasets: finalDatasets, warnings };
}
