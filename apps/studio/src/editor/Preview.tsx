"use client";
import { useEffect, useState } from "react";
import { sampleParams } from "@/lib/data";
import { useEditor } from "./store";

const DEBOUNCE_MS = 150;   // 스펙 5.5

export function Preview({ reportId }: { reportId: string }) {
  const report = useEditor((s) => s.report);
  const [html, setHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // 편집이 이어지면 이전 타이머와 진행 중인 요청을 버려, 늦게 온 옛 응답이 새 미리보기를 덮지 않게 한다
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/reports/${encodeURIComponent(reportId)}/preview`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ report, params: sampleParams(report) }), signal: ctrl.signal })
        .then(async (r) => { if (!r.ok) throw new Error((await r.json()).error); return r.text(); })
        .then((t) => { if (!ctrl.signal.aborted) { setHtml(t); setError(null); } })
        .catch((e) => { if (!ctrl.signal.aborted) setError(e.message); });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [report, reportId]);
  if (error) return <div className="p-4 text-red-700 text-sm">{error}</div>;
  // 스크립트 없는 정적 HTML이다. 이스케이프가 깨져도 studio 출처로 스크립트가 돌지 않게 sandbox를 둔다 (폰트 로드를 위해 same-origin만 허용)
  return <iframe title="preview" className="w-full h-full bg-neutral-300" sandbox="allow-same-origin" srcDoc={html} />;
}
