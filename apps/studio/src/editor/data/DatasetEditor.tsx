"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Dataset } from "@daport/core";
import { bindNames, guardSql, DatasetFailure } from "@daport/datasource/sql";   // 클라이언트 안전 서브패스 (Node 전용 코드 없음)
import { TextField, SelectField } from "../panels/Field";

const isObject = (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v);
const headersToText = (h: Record<string, string>) => Object.entries(h).map(([k, v]) => `${k}: ${v}`).join("\n");
const textToHeaders = (t: string) => Object.fromEntries(t.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(":"); return i < 0 ? [l, ""] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

function StaticRows({ rows, onChange }: { rows: Record<string, unknown>[]; onChange: (rows: Record<string, unknown>[]) => void }) {
  // 입력 중인 텍스트는 로컬로 두고 올바른 객체 배열일 때만 커밋한다 (깨진 JSON이 스토어에 들어가지 않게)
  const [text, setText] = useState(() => JSON.stringify(rows, null, 2));
  const [error, setError] = useState<string | null>(null);
  const change = (v: string) => {
    setText(v);
    let parsed: unknown;
    try { parsed = JSON.parse(v); } catch (e) { setError(`JSON 구문 오류: ${(e as Error).message}`); return; }
    if (!Array.isArray(parsed) || !parsed.every(isObject)) { setError("객체 배열이어야 합니다"); return; }
    setError(null);
    onChange(parsed as Record<string, unknown>[]);
  };
  return (
    <label className="flex flex-col gap-1 text-xs">
      {/* WCAG 2.5.3(label in name): 화면에 보이는 라벨과 접근성 이름(aria-label)이 같아야 한다 */}
      <span className="text-neutral-500">행(JSON)</span>
      <textarea aria-label="행(JSON)" value={text} rows={6} className="border rounded px-1 py-0.5 font-mono" onChange={(e) => change(e.target.value)} />
      {error && <span className="text-red-700">{error}</span>}
    </label>
  );
}

type ParamLike = { name: string; type?: string };

function SqlForm({ dataset, params, set }: { dataset: Extract<Dataset, { type: "sql" }>; params: ParamLike[]; set: (p: Partial<Dataset>) => void }) {
  const [connections, setConnections] = useState<{ name: string; via: string }[] | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/connections", { method: "GET" }).then((r) => (r.ok ? r.json() : [])).then((l: unknown) => setConnections(Array.isArray(l) ? (l as { name: string; via: string }[]) : [])).catch(() => setConnections([]));
  }, []);
  const binds = bindNames(dataset.query);
  const missing = binds.filter((b) => !params.some((p) => p.name === b));
  const check = () => {
    try { guardSql(dataset.query); setVerdict("허용되는 조회문입니다"); }
    catch (e) { setVerdict(e instanceof DatasetFailure ? e.message : String(e)); }
  };
  return (
    <>
      <label className="flex flex-col gap-1 text-xs"><span className="text-neutral-500">연결</span>
        <select aria-label="연결" className="border rounded px-1 py-0.5" value={dataset.connection} onChange={(e) => set({ connection: e.target.value })}>
          <option value="">(선택)</option>
          {(connections ?? []).map((c) => <option key={c.name} value={c.name}>{c.name} ({c.via})</option>)}
        </select></label>
      {connections && connections.length === 0 && <span className="text-xs text-amber-700">연결을 먼저 등록하세요: <Link className="underline" href="/settings/connections">연결 관리</Link></span>}
      <label className="flex flex-col gap-1 text-xs"><span className="text-neutral-500">쿼리</span>
        <textarea aria-label="쿼리" rows={4} className="border rounded px-1 py-0.5 font-mono" value={dataset.query} onChange={(e) => set({ query: e.target.value })} /></label>
      <div data-testid="binds" className="text-xs text-neutral-600">
        바인드: {binds.length ? binds.map((b) => `:${b}`).join(", ") : "없음"}
        {missing.length > 0 && <span className="text-amber-700"> · 파라미터에 없음: {missing.join(", ")}</span>}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <button className="border rounded px-2 py-0.5 bg-white hover:bg-neutral-100" onClick={check}>쿼리 확인</button>
        {verdict && <span data-testid="guard-result" className={verdict.startsWith("허용") ? "text-green-700" : "text-red-700"}>{verdict}</span>}
      </div>
    </>
  );
}

/** 데이터셋 하나의 편집 폼 (스펙 7.1). sql은 연결 선택·쿼리·바인드 힌트·클라이언트 가드 확인을 제공한다 */
export function DatasetEditor({ dataset, params = [], onChange, onRemove }: { dataset: Dataset; params?: ParamLike[]; onChange: (ds: Dataset) => void; onRemove: () => void }) {
  const set = (patch: Partial<Dataset>) => onChange({ ...dataset, ...patch } as Dataset);
  return (
    <div className="border rounded p-2 flex flex-col gap-1" data-testid={`dataset-${dataset.name}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-neutral-500">{dataset.type}</span>
        <div className="flex-1" />
        <button className="text-xs text-red-700" onClick={onRemove}>삭제</button>
      </div>
      <TextField label="이름" value={dataset.name} onChange={(name) => set({ name })} />
      {dataset.type === "static" && <StaticRows key={dataset.name} rows={dataset.rows} onChange={(rows) => set({ rows })} />}
      {dataset.type === "http" && <>
        <SelectField label="method" value={dataset.method} options={["GET", "POST"]} onChange={(method) => set({ method })} />
        <TextField label="url" value={dataset.url} onChange={(url) => set({ url })} />
        <label className="flex flex-col gap-1 text-xs"><span className="text-neutral-500">헤더</span>
          <textarea aria-label="헤더" rows={2} className="border rounded px-1 py-0.5 font-mono" value={headersToText(dataset.headers)} onChange={(e) => set({ headers: textToHeaders(e.target.value) })} /></label>
        {dataset.method === "POST" && <label className="flex flex-col gap-1 text-xs"><span className="text-neutral-500">본문</span>
          <textarea aria-label="본문" rows={2} className="border rounded px-1 py-0.5 font-mono" value={dataset.body ?? ""} onChange={(e) => set({ body: e.target.value })} /></label>}
        <TextField label="rowsPath" value={dataset.rowsPath ?? ""} onChange={(v) => set({ rowsPath: v || undefined })} />
      </>}
      {dataset.type === "sql" && <SqlForm dataset={dataset} params={params} set={set} />}
    </div>
  );
}
