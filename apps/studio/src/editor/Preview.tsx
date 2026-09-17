"use client";
import { useEffect, useState } from "react";
import { requestBody } from "@/lib/data";
import { useEditor } from "./store";

const DEBOUNCE_MS = 150;   // 스펙 5.5

export function Preview({ reportId }: { reportId: string }) {
  const report = useEditor((s) => s.report);
  const liveData = useEditor((s) => s.liveData);
  const bitmapPreview = useEditor((s) => s.bitmapPreview);
  const [html, setHtml] = useState("");
  const [bitmapUrl, setBitmapUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isLabel = report.output.kind === "label";
  useEffect(() => {
    // 편집이 이어지면 이전 타이머와 진행 중인 요청을 버려, 늦게 온 옛 응답이 새 미리보기를 덮지 않게 한다
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      if (isLabel && bitmapPreview) {
        fetch(`/api/reports/${encodeURIComponent(reportId)}/label?preview=png`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(requestBody(report, liveData)), signal: ctrl.signal })
          .then(async (r) => {
            if (r.ok) return r.blob();
            const body = await r.json().catch(() => ({}));
            throw new Error(typeof body.error === "string" ? body.error : `미리보기 실패 (HTTP ${r.status})`);
          })
          .then((blob) => {
            if (ctrl.signal.aborted) return;
            setBitmapUrl(URL.createObjectURL(blob));
            setError(null);
          })
          .catch((e) => { if (!ctrl.signal.aborted) setError(e.message); });
        return;
      }
      fetch(`/api/reports/${encodeURIComponent(reportId)}/preview`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody(report, liveData)), signal: ctrl.signal })
        .then(async (r) => {
          if (r.ok) return r.text();
          const body = await r.json().catch(() => ({}));
          const lines = Array.isArray(body.datasetErrors) ? body.datasetErrors.map((d: { dataset: string; code: string; message: string }) => `${d.dataset}: ${d.code} — ${d.message}`) : [];
          throw new Error([typeof body.error === "string" ? body.error : `미리보기 실패 (HTTP ${r.status})`, ...lines].join("\n"));
        })
        .then((t) => { if (!ctrl.signal.aborted) { setHtml(t); setError(null); } })
        .catch((e) => { if (!ctrl.signal.aborted) setError(e.message); });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [report, reportId, liveData, isLabel, bitmapPreview]);
  useEffect(() => () => { if (bitmapUrl) URL.revokeObjectURL(bitmapUrl); }, [bitmapUrl]);
  if (error) return <div className="p-4 text-red-700 text-sm whitespace-pre-wrap">{error}</div>;
  if (isLabel && bitmapPreview) {
    return bitmapUrl ? <img data-testid="bitmap-preview" alt="라벨 비트맵" className="bg-white shadow" src={bitmapUrl} /> : null;
  }
  // 스크립트 없는 정적 HTML이다. 이스케이프가 깨져도 studio 출처로 스크립트가 돌지 않게 sandbox를 둔다 (폰트 로드를 위해 same-origin만 허용)
  return <iframe title="preview" className="w-full h-full bg-neutral-300" sandbox="allow-same-origin" srcDoc={html} />;
}
