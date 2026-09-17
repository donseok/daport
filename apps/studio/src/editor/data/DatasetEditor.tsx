"use client";
import { useState } from "react";
import type { Dataset } from "@daport/core";
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
      {/* 화면 라벨은 오류 메시지("JSON 구문 오류")와 텍스트 매칭이 겹치지 않도록 "JSON"을 넣지 않는다. aria-label은 스펙대로 유지 */}
      <span className="text-neutral-500">행 데이터</span>
      <textarea aria-label="행(JSON)" value={text} rows={6} className="border rounded px-1 py-0.5 font-mono" onChange={(e) => change(e.target.value)} />
      {error && <span className="text-red-700">{error}</span>}
    </label>
  );
}

/** 데이터셋 하나의 편집 폼 (스펙 7.1). sql은 커넥터가 없어 JSON 편집기에서만 고친다 */
export function DatasetEditor({ dataset, onChange, onRemove }: { dataset: Dataset; onChange: (ds: Dataset) => void; onRemove: () => void }) {
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
      {dataset.type === "sql" && <div className="text-xs text-neutral-500">커넥터 미설정 — connection·query는 JSON 편집기에서 수정합니다</div>}
    </div>
  );
}
