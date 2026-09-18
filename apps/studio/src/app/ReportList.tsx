"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReportSummary } from "@/lib/report-store";

type ImportResult = { imported: { id: string; action: "created" | { version: number } }[]; skipped: { id: string; reason: string }[]; warnings: string[] };

const statusOf = (r: ReportSummary) => r.publishedVersion === null ? "미배포" : `v${r.publishedVersion}${r.modified ? " · 수정됨" : ""}`;

/** 홈 레포트 목록 (4단계 스펙 7.2): 배포 상태, 선택 내보내기, 번들 가져오기 */
export function ReportList({ reports }: { reports: ReportSummary[] }) {
  const router = useRouter();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const toggle = (id: string) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const exportZip = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reports: [...checked].map((id) => ({ id })) }) });
      if (!r.ok) { alert(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `내보내기 실패 (HTTP ${r.status})`); return; }
      const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "daport-export.zip";
      const url = URL.createObjectURL(await r.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);   // 클릭 직후 바로 해제하면 일부 브라우저에서 다운로드가 시작되기 전에 URL이 사라진다 (Toolbar.download와 동일)
    } catch (e) { alert(`내보내기 실패: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  const importZip = async (file: File) => {
    setBusy(true); setResult(null);
    try {
      const form = new FormData(); form.append("file", file);
      const r = await fetch("/api/import", { method: "POST", body: form });
      const body = (await r.json().catch(() => null)) as (ImportResult & { error?: string }) | null;
      if (!r.ok || !body) { alert(body?.error ?? `가져오기 실패 (HTTP ${r.status})`); return; }
      setResult(body);
      router.refresh();
    } catch (e) { alert(`가져오기 실패: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  const btn = "text-xs border rounded px-2 py-1 bg-white hover:bg-neutral-100 disabled:opacity-50";
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <button className={btn} disabled={busy || checked.size === 0} onClick={exportZip}>내보내기</button>
        <label className={`${btn} cursor-pointer`}>가져오기<input type="file" accept=".zip,application/zip" aria-label="번들 파일" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importZip(f); e.target.value = ""; }} /></label>
        <Link className="text-xs text-blue-700 hover:underline ml-auto" href="/settings/keys">API 키</Link>
      </div>
      <ul className="divide-y bg-white border rounded mb-3">
        {reports.map((r) => (
          <li key={r.id} className="p-3 flex items-center gap-3">
            <input type="checkbox" aria-label={`선택 ${r.id}`} checked={checked.has(r.id)} onChange={() => toggle(r.id)} />
            <Link className="text-blue-700 hover:underline flex-1" href={`/reports/${r.id}`}>{r.name || r.id}</Link>
            <span data-testid={`status-${r.id}`} className={`text-xs ${r.modified ? "text-amber-700" : r.publishedVersion === null ? "text-neutral-400" : "text-green-700"}`}>{statusOf(r)}</span>
          </li>
        ))}
        {reports.length === 0 && <li className="p-3 text-neutral-500 text-sm">레포트가 없습니다</li>}
      </ul>
      {result && (
        <div data-testid="import-result" className="text-xs bg-neutral-50 border rounded p-2 mb-4">
          <div className="font-semibold mb-1">가져오기 결과</div>
          {result.imported.map((i) => <div key={i.id}>{i.id}: {i.action === "created" ? "새 레포트" : `v${i.action.version} 추가`}</div>)}
          {result.skipped.map((s) => <div key={s.id} className="text-red-700">{s.id}: {s.reason}</div>)}
          {result.warnings.map((w, k) => <div key={k} className="text-amber-700">{w}</div>)}
        </div>
      )}
    </div>
  );
}
