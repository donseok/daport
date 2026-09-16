"use client";
import { useEffect, useState } from "react";
import { useEditor } from "./store";

export function Preview() {
  const report = useEditor((s) => s.report);
  const [html, setHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const params: Record<string, unknown> = {};
    for (const p of report.params) params[p.name] = p.default ?? "SAMPLE";
    fetch(`/api/reports/${report.id}/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ report, params }) })
      .then(async (r) => { if (!r.ok) throw new Error((await r.json()).error); return r.text(); })
      .then((t) => { setHtml(t); setError(null); })
      .catch((e) => setError(e.message));
  }, [report]);
  if (error) return <div className="p-4 text-red-700 text-sm">{error}</div>;
  return <iframe title="preview" className="w-full h-full bg-neutral-300" srcDoc={html} />;
}
