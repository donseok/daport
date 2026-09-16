import { compare } from "fast-json-patch";
import { safeParseReport } from "@daport/core";

export function shouldPushToEditor(editorText: string, report: unknown): boolean {
  try { return JSON.stringify(JSON.parse(editorText)) !== JSON.stringify(report); } catch { return true; }
}
export function parseEditorText(text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try { return { ok: true, value: JSON.parse(text) }; } catch (e) { return { ok: false, message: `JSON 구문 오류: ${(e as Error).message}` }; }
}
export function toEditorText(report: unknown): string { return JSON.stringify(report, null, 2); }

/** 편집기 텍스트를 스키마로 해석하면(기본값 채움) report와 같은 모델인가. 키 순서는 보지 않는다 */
export function describesReport(editorText: string, report: object): boolean {
  let parsed: unknown;
  try { parsed = JSON.parse(editorText); } catch { return false; }
  const res = safeParseReport(parsed);
  return res.success && compare(res.data, report).length === 0;
}

export type SyncAction = "flush" | "push" | "skip";
/**
 * 스토어의 report가 바뀌었을 때 편집기에 할 일. 편집기 → 스토어 디바운스가 대기 중이면 방금 입력한 텍스트를
 * 스토어 텍스트로 덮지 않고 먼저 스토어로 보낸다(flush). 그 밖에는 내용이 다를 때만 스토어 텍스트를 넣는다(push).
 * 편집기에 포커스가 있고 텍스트가 기본값·키 순서만 다른 같은 모델이면 넣지 않는다(skip). 정리된 텍스트는 줄이 늘어
 * 같은 줄·칸으로 되돌린 커서가 엉뚱한 곳에 가고, 다음 입력이 문서를 깨뜨린다
 */
export function decideSync({ pendingEdit, editorText, report, editorFocused = false }: { pendingEdit: boolean; editorText: string; report: object; editorFocused?: boolean }): SyncAction {
  if (pendingEdit) return "flush";
  if (!shouldPushToEditor(editorText, report)) return "skip";
  return editorFocused && describesReport(editorText, report) ? "skip" : "push";
}
