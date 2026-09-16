export function shouldPushToEditor(editorText: string, report: unknown): boolean {
  try { return JSON.stringify(JSON.parse(editorText)) !== JSON.stringify(report); } catch { return true; }
}
export function parseEditorText(text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try { return { ok: true, value: JSON.parse(text) }; } catch (e) { return { ok: false, message: `JSON 구문 오류: ${(e as Error).message}` }; }
}
export function toEditorText(report: unknown): string { return JSON.stringify(report, null, 2); }
