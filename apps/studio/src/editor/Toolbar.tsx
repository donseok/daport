"use client";
import { useContext, useState } from "react";
import { sampleParams } from "@/lib/data";
import { EditorContext, useEditor } from "./store";

/** 실패 응답의 오류 메시지. 프록시·서버 오류 페이지는 JSON이 아니고, error가 문자열이 아닐 수도 있어 HTTP 상태로 대신한다 */
async function failureMessage(r: Response, label: string): Promise<string> {
  const body: unknown = await r.json().catch(() => null);
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  return typeof error === "string" ? error : `${label} 실패 (HTTP ${r.status})`;
}

/** reportId는 열린 레포트의 id다. 편집 모델의 id가 아니라 이 값으로 요청 경로를 정해 다른 레포트를 덮어쓰지 않는다 */
export function Toolbar({ reportId, zoom, setZoom }: { reportId: string; zoom: number; setZoom: (z: number) => void }) {
  const store = useContext(EditorContext)!;
  const report = useEditor((s) => s.report);
  const dirty = useEditor((s) => s.dirty);
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const markSaved = useEditor((s) => s.markSaved);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    // 보낸 모델을 기억해 두고, 요청이 끝났을 때 그 사이 편집이 있으면 저장 안 됨(*)으로 남긴다
    const saved = store.getState().report;
    setBusy(true);
    try {
      const r = await fetch(`/api/reports/${encodeURIComponent(reportId)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(saved) });
      if (r.ok) { markSaved(saved); return; }
      alert(await failureMessage(r, "저장"));
    } catch (e) {
      alert(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const pdf = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/reports/${encodeURIComponent(reportId)}/pdf`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ report, params: sampleParams(report) }) });
      if (!r.ok) { alert(await failureMessage(r, "PDF")); return; }
      const url = URL.createObjectURL(await r.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: `${report.name || report.id}.pdf` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);   // 클릭 직후 바로 해제하면 일부 브라우저에서 다운로드가 시작되기 전에 URL이 사라진다
    } catch (e) {
      alert(`PDF 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const btn = "text-xs border rounded px-2 py-1 bg-white hover:bg-neutral-100 disabled:opacity-50";
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b bg-white">
      <span className="font-semibold text-sm">{report.name || report.id}{dirty ? " *" : ""}</span>
      <button className={btn} onClick={undo}>되돌리기</button>
      <button className={btn} onClick={redo}>다시하기</button>
      <button className={btn} onClick={() => setMode(mode === "design" ? "preview" : "design")}>{mode === "design" ? "미리보기" : "디자인"}</button>
      <label className="text-xs ml-2">배율 <input type="range" min={0.25} max={3} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /> {Math.round(zoom * 100)}%</label>
      <div className="flex-1" />
      <button className={btn} disabled={busy} onClick={pdf}>PDF</button>
      <button className={btn} disabled={busy || !dirty} onClick={save} data-testid="save">저장</button>
    </div>
  );
}
