"use client";
import { useState } from "react";
import { sampleParams } from "@/lib/data";
import { useEditor } from "./store";

/** reportId는 열린 레포트의 id다. 편집 모델의 id가 아니라 이 값으로 요청 경로를 정해 다른 레포트를 덮어쓰지 않는다 */
export function Toolbar({ reportId, zoom, setZoom }: { reportId: string; zoom: number; setZoom: (z: number) => void }) {
  const report = useEditor((s) => s.report);
  const dirty = useEditor((s) => s.dirty);
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const markSaved = useEditor((s) => s.markSaved);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const r = await fetch(`/api/reports/${encodeURIComponent(reportId)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(report) });
    setBusy(false);
    if (r.ok) markSaved(); else alert((await r.json()).error);
  };
  const pdf = async () => {
    const r = await fetch(`/api/reports/${encodeURIComponent(reportId)}/pdf`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ report, params: sampleParams(report) }) });
    if (!r.ok) { alert((await r.json()).error); return; }
    const url = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `${report.name || report.id}.pdf` });
    a.click(); URL.revokeObjectURL(url);
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
      <button className={btn} onClick={pdf}>PDF</button>
      <button className={btn} disabled={busy || !dirty} onClick={save} data-testid="save">저장</button>
    </div>
  );
}
