export function shouldPushToEditor(editorText: string, report: unknown): boolean {
  try { return JSON.stringify(JSON.parse(editorText)) !== JSON.stringify(report); } catch { return true; }
}
export function parseEditorText(text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try { return { ok: true, value: JSON.parse(text) }; } catch (e) { return { ok: false, message: `JSON 구문 오류: ${(e as Error).message}` }; }
}
export function toEditorText(report: unknown): string { return JSON.stringify(report, null, 2); }

export type SyncAction = "flush" | "push" | "skip";
/**
 * 스토어의 report가 바뀌었을 때 편집기에 할 일. 편집기 → 스토어 디바운스가 대기 중이면 방금 입력한 텍스트를
 * 스토어 텍스트로 덮지 않고 먼저 스토어로 보낸다(flush). 그 밖에는 내용이 다를 때만 스토어 텍스트를 넣는다(push)
 */
export function decideSync({ pendingEdit, editorText, report }: { pendingEdit: boolean; editorText: string; report: unknown }): SyncAction {
  if (pendingEdit) return "flush";
  return shouldPushToEditor(editorText, report) ? "push" : "skip";
}
