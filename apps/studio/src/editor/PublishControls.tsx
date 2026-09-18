"use client";
import { useCallback, useEffect, useState } from "react";
import { useEditor } from "./store";

type VersionRow = { version: number; createdAt: string; note: string | null; hash: string; published: boolean };
type Versions = { versions: VersionRow[]; publishedVersion: number | null; draftHash: string };

async function failureMessage(r: Response, label: string): Promise<string> {
  const body: unknown = await r.json().catch(() => null);
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  return typeof error === "string" ? error : `${label} 실패 (HTTP ${r.status})`;
}
const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString("ko-KR") : "");

/** 툴바 배포 영역 (4단계 스펙 7.1): 상태 배지, 배포, 버전 패널(되돌리기·보기), 연동 안내 */
export function PublishControls({ reportId }: { reportId: string }) {
  const dirty = useEditor((s) => s.dirty);
  const [info, setInfo] = useState<Versions | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const base = `/api/reports/${encodeURIComponent(reportId)}`;

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${base}/versions`, { method: "GET" });
      if (!r.ok) return;
      // 다른 테스트의 fetch 목은 모든 URL에 {}를 돌려준다. Versions 모양이 아니면 배지를 갱신하지 않는다
      const j: unknown = await r.json();
      if (j && typeof j === "object" && Array.isArray((j as { versions?: unknown }).versions)) setInfo(j as Versions);
    } catch { /* 배지는 마지막 값을 유지한다 */ }
  }, [base]);
  // 저장이 끝나 dirty가 false로 돌아올 때 draftHash를 다시 읽어 "수정됨" 배지를 맞춘다 (마운트 시에도 한 번 읽는다)
  useEffect(() => { if (!dirty) void refresh(); }, [dirty, refresh]);

  const published = info?.versions.find((v) => v.version === info.publishedVersion) ?? null;
  const modified = !!published && published.hash !== info!.draftHash;
  const badge = !info ? "…" : !published ? "미배포" : `v${published.version} 배포됨${modified ? " · 수정됨" : ""}`;

  const publish = async () => {
    const note = window.prompt("배포 메모 (선택)", "") ?? null;
    if (note === null) return;   // 취소
    setBusy(true);
    try {
      const r = await fetch(`${base}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(note.trim() ? { note: note.trim() } : {}) });
      if (!r.ok) { alert(await failureMessage(r, "배포")); return; }
      await refresh();
    } catch (e) { alert(`배포 실패: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  const republish = async (version: number) => {
    if (!window.confirm(`v${version}을(를) 배포 버전으로 되돌립니다. draft는 바뀌지 않습니다. 계속할까요?`)) return;
    setBusy(true);
    try {
      const r = await fetch(`${base}/published`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ version }) });
      if (!r.ok) { alert(await failureMessage(r, "되돌리기")); return; }
      await refresh();
    } catch (e) { alert(`되돌리기 실패: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  const view = async (version: number) => {
    try {
      const r = await fetch(`${base}/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version, params: {} }) });
      if (!r.ok) { alert(await failureMessage(r, "미리보기")); return; }
      setPreviewHtml(await r.text());
    } catch (e) { alert(`미리보기 실패: ${e instanceof Error ? e.message : String(e)}`); }
  };

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const btn = "text-xs border rounded px-2 py-1 bg-white hover:bg-neutral-100 disabled:opacity-50";
  return (
    <>
      <span data-testid="publish-badge" className={`text-xs px-2 py-0.5 rounded ${modified ? "bg-amber-100 text-amber-800" : published ? "bg-green-100 text-green-800" : "bg-neutral-100 text-neutral-600"}`}>{badge}</span>
      <button className={btn} data-testid="publish" disabled={busy || dirty || !info} title={dirty ? "먼저 저장하세요" : undefined} onClick={publish}>배포</button>
      <button className={btn} onClick={() => setOpen((o) => !o)}>버전</button>
      {open && info && (
        <div data-testid="versions-panel" className="absolute right-3 top-12 z-20 w-[28rem] max-h-[70vh] overflow-auto bg-white border rounded shadow p-3 text-xs">
          <div className="font-semibold mb-2">버전</div>
          {info.versions.length === 0 && <div className="text-neutral-500 mb-2">아직 배포한 버전이 없습니다</div>}
          <ul className="divide-y">
            {info.versions.map((v) => (
              <li key={v.version} data-version={v.version} className="py-1 flex items-center gap-2">
                <span className="font-mono">v{v.version}</span>
                <span className="text-neutral-500">{fmt(v.createdAt)}</span>
                <span className="flex-1 truncate" title={v.note ?? undefined}>{v.note ?? ""}</span>
                {v.published && <span className="text-green-700">배포됨</span>}
                {!v.published && <button name="republish" className={btn} disabled={busy} onClick={() => republish(v.version)}>이 버전으로 배포</button>}
                <button name="view" className={btn} onClick={() => view(v.version)}>보기</button>
              </li>
            ))}
          </ul>
          <details className="mt-3">
            <summary className="cursor-pointer">연동</summary>
            <pre data-testid="integration-snippet" className="mt-1 whitespace-pre-wrap break-all bg-neutral-50 border rounded p-2 select-all">{[
              `# 배포 버전 렌더 (pdf | html | zpl | tspl | png)`,
              `curl -X POST ${origin}${base}/render \\`,
              `  -H 'X-API-Key: <API_KEY>' -H 'content-type: application/json' \\`,
              `  -d '{"format":"pdf","params":{}}' -o out.pdf`,
              ``,
              `# 임베드용 모델 JSON`,
              `curl ${origin}${base}/published -H 'X-API-Key: <API_KEY>'`,
            ].join("\n")}</pre>
          </details>
        </div>
      )}
      {previewHtml !== null && (
        <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center" onClick={() => setPreviewHtml(null)}>
          <div className="bg-white rounded shadow w-[90vw] h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center px-3 py-2 border-b text-sm"><span>배포 버전 미리보기 (읽기 전용)</span><button className={btn} onClick={() => setPreviewHtml(null)}>닫기</button></div>
            <iframe data-testid="version-preview" title="배포 버전 미리보기" className="flex-1 w-full" sandbox="" srcDoc={previewHtml} />
          </div>
        </div>
      )}
    </>
  );
}
