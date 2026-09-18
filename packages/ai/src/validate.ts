import { applyPatch, deepClone, JsonPatchError, type Operation } from "fast-json-patch";
import { collectIds, componentKey, safeParseReport, type ComponentBody, type Element, type Report } from "@daport/core";
import { AiValidationError } from "./types";

/** 모델이 건드릴 수 있는 경로. 이 밖은 서버가 관리하는 필드(id·output 등)라 건드리지 못하게 막는다 */
export const ALLOWED_PATHS = [/^\/elements(\/|$)/, /^\/page(\/|$)/, /^\/params(\/|$)/, /^\/datasets(\/|$)/, /^\/name$/];

const ALLOWED_OPS = ["add", "remove", "replace", "move", "copy"] as const;
type AllowedOp = (typeof ALLOWED_OPS)[number];

const MAX_APPLY_ATTEMPTS = 3;

/** zod 오류 메시지를 앞 3개만 이어 붙인다 */
function firstZodMessages(error: { issues: { message: string }[] }): string {
  return error.issues.slice(0, 3).map((i) => i.message).join("; ");
}

/** raw 응답 한 항목을 Operation으로 정규화한다. 형식이 틀리면 AiValidationError */
function normalizeOp(raw: unknown): Operation {
  if (typeof raw !== "object" || raw === null) {
    throw new AiValidationError("패치 항목이 객체가 아닙니다");
  }
  const o = raw as Record<string, unknown>;
  const op = o.op;
  if (typeof op !== "string" || !(ALLOWED_OPS as readonly string[]).includes(op)) {
    throw new AiValidationError(`허용되지 않은 op입니다: ${String(op)}`);
  }
  const path = o.path;
  if (typeof path !== "string") {
    throw new AiValidationError(`path가 문자열이 아닙니다: ${String(path)}`);
  }
  const kind = op as AllowedOp;

  if (kind === "move" || kind === "copy") {
    const from = o.from;
    if (typeof from !== "string") {
      throw new AiValidationError(`from이 필요합니다: ${path}`);
    }
    return { op: kind, path, from } as Operation;
  }
  if (kind === "remove") {
    return { op: kind, path } as Operation;
  }

  // add, replace(, test): value 필수
  if (!("value" in o) || o.value === undefined) {
    throw new AiValidationError(`value가 필요합니다: ${path}`);
  }
  let value: unknown = o.value;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new AiValidationError(`value의 JSON 파싱에 실패했습니다: ${path}`);
    }
  }
  return { op: kind, path, value } as Operation;
}

function pathAllowed(path: string): boolean {
  return ALLOWED_PATHS.some((re) => re.test(path));
}

/** report 전체에서 쓰이는 id(컴포넌트 내부 트리 포함)를 모은다 */
function allIds(report: Report): Set<string> {
  const ids = collectIds(report.elements);
  for (const body of Object.values(report.components)) {
    for (const id of collectIds(body.elements)) ids.add(id);
  }
  return ids;
}

function nextId(type: string, used: Set<string>): string {
  let n = 1;
  while (used.has(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}

/** add 연산의 value.id가 겹치면 <type>-<n>으로 바꾼다. 경로는 그대로 둔다(뒤 op은 인덱스 기반이라 영향 없음) */
function renameCollidingIds(patch: Operation[], report: Report): void {
  const used = allIds(report);
  for (const o of patch) {
    if (o.op !== "add") continue;
    const value = (o as { value?: unknown }).value;
    if (typeof value !== "object" || value === null) continue;
    const v = value as Record<string, unknown>;
    if (typeof v.id !== "string") continue;
    if (used.has(v.id)) {
      const type = typeof v.type === "string" ? v.type : "element";
      const id = nextId(type, used);
      v.id = id;
      used.add(id);
    } else {
      used.add(v.id);
    }
  }
}

/** validateOperation=true로 적용하고, 실패한 op을 지워가며 최대 MAX_APPLY_ATTEMPTS번 재시도한다 */
function applyWithRetry(report: Report, patch: Operation[], warnings: string[]): unknown {
  let current = patch;
  for (let attempt = 0; attempt < MAX_APPLY_ATTEMPTS; attempt++) {
    try {
      const result = applyPatch(deepClone(report), current, true, false);
      return result.newDocument;
    } catch (e) {
      if (e instanceof JsonPatchError && typeof e.index === "number" && current[e.index]) {
        const failed = current[e.index];
        warnings.push(`적용할 수 없어 건너뜀: ${failed.path}`);
        current = current.filter((_, i) => i !== e.index);
        continue;
      }
      throw new AiValidationError(`패치를 적용할 수 없습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new AiValidationError("패치를 적용할 수 없습니다: 재시도 횟수를 초과했습니다");
}

/**
 * 모델이 만든 JSON Patch 응답을 검증·적용한다: 형식 검사 → 허용 경로 필터 → id 재명명 →
 * 적용(실패 op 제거 재시도) → 스키마 검증. 원본 report는 건드리지 않는다
 */
export function validateEditPatch(report: Report, raw: unknown): { patch: Operation[]; warnings: string[]; next: Report } {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { patch?: unknown }).patch)) {
    throw new AiValidationError("응답에 patch 배열이 없습니다");
  }
  const rawOps = (raw as { patch: unknown[] }).patch;

  const normalized = rawOps.map(normalizeOp);

  const warnings: string[] = [];
  const patch: Operation[] = [];
  for (const o of normalized) {
    if (!pathAllowed(o.path)) {
      warnings.push(`금지된 경로라 건너뜀: ${o.path}`);
      continue;
    }
    patch.push(o);
  }

  renameCollidingIds(patch, report);

  const applied = applyWithRetry(report, patch, warnings);

  const parsed = safeParseReport(applied);
  if (!parsed.success) {
    throw new AiValidationError(`패치 결과가 스키마를 통과하지 못했습니다: ${firstZodMessages(parsed.error)}`);
  }

  return { patch, warnings, next: parsed.data };
}

export type LibraryLookup = (id: string) => Promise<{ version: number; body: ComponentBody } | null>;

function clampToPage(el: Element, width: number, height: number, warnings: string[]): Element {
  const e = el as Element & { x: number; y: number; w: number; h: number };
  let x = Math.max(0, e.x);
  let y = Math.max(0, e.y);
  x = Math.min(x, Math.max(0, width - e.w));
  y = Math.min(y, Math.max(0, height - e.h));
  if (x !== e.x || y !== e.y) {
    warnings.push(`페이지 안으로 위치를 조정했습니다: ${e.id}`);
    return { ...e, x, y };
  }
  return e;
}

/**
 * 모델이 생성한 요소 목록을 검증한다: JSON 문자열 파싱 → ref는 라이브러리 최신 버전으로 채움 →
 * 페이지 안으로 좌표 클램프 → 스키마 검증
 */
export async function validateGenerated(
  report: Report,
  raw: unknown,
  library: LibraryLookup,
): Promise<{ elements: Element[]; components: Record<string, ComponentBody>; warnings: string[] }> {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { elements?: unknown }).elements)) {
    throw new AiValidationError("응답에 elements 배열이 없습니다");
  }
  const rawElements = (raw as { elements: unknown[] }).elements;

  const warnings: string[] = [];
  const elements: unknown[] = [];
  for (const item of rawElements) {
    if (typeof item !== "string") {
      throw new AiValidationError("요소는 JSON 문자열이어야 합니다");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(item);
    } catch {
      throw new AiValidationError(`요소 JSON 파싱에 실패했습니다: ${item}`);
    }
    elements.push(parsed);
  }

  const components: Record<string, ComponentBody> = {};
  const width = report.page.width;
  const height = report.page.height;

  const filled: unknown[] = [];
  for (const item of elements) {
    const e = item as Record<string, unknown>;
    if (e && e.type === "ref" && typeof e.ref === "string") {
      const found = await library(e.ref);
      if (!found) {
        throw new AiValidationError(`알 수 없는 컴포넌트를 참조했습니다: ${e.ref}`);
      }
      if (e.version !== found.version) {
        warnings.push(`컴포넌트 ${e.ref}를 최신 버전(${found.version})으로 맞췄습니다`);
      }
      components[componentKey(e.ref, found.version)] = found.body;
      filled.push({ ...e, version: found.version });
    } else {
      filled.push(e);
    }
  }

  const clamped = filled.map((el) => clampToPage(el as Element, width, height, warnings));

  const parsed = safeParseReport({ ...report, elements: clamped, components });
  if (!parsed.success) {
    throw new AiValidationError(`생성된 요소가 스키마를 통과하지 못했습니다: ${firstZodMessages(parsed.error)}`);
  }

  return { elements: parsed.data.elements, components: parsed.data.components, warnings };
}
