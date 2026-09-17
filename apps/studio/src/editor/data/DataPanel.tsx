"use client";
import { useState } from "react";
import { inferFields, type Dataset, type FieldNode } from "@daport/core";
import { useEditor } from "../store";

/** sample 라우트의 오류 항목. 클라이언트 번들이 @daport/datasource를 끌어오지 않도록 여기서 모양만 적는다 (T15와 같은 레인이 아니다) */
type DatasetError = { dataset: string; code: string; message: string };
import { TextField } from "../panels/Field";
import { DatasetEditor } from "./DatasetEditor";
import { FieldTree } from "./FieldTree";

type SampleResponse = { data: Record<string, unknown[]>; fields: Record<string, FieldNode[]>; errors: DatasetError[]; capturedAt: string };

function newDatasetName(datasets: Dataset[]): string {
  let n = 1; while (datasets.some((d) => d.name === `dataset-${n}`)) n++;
  return `dataset-${n}`;
}

/** 파라미터 샘플 값, 데이터셋 목록, 샘플 가져오기, 필드 트리 (스펙 7.1) */
export function DataPanel({ reportId }: { reportId: string }) {
  const report = useEditor((s) => s.report);
  const setSample = useEditor((s) => s.setSample);
  const setDatasets = useEditor((s) => s.setDatasets);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<DatasetError[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const sample = report.sample;
  const sampleParams = sample?.params ?? {};

  const setParam = (name: string, value: string) =>
    setSample({ params: { ...sampleParams, [name]: value }, data: sample?.data ?? {}, capturedAt: sample?.capturedAt ?? new Date(0).toISOString() });
  const replaceDataset = (i: number, ds: Dataset) => setDatasets(report.datasets.map((d, k) => (k === i ? ds : d)));
  const removeDataset = (i: number) => setDatasets(report.datasets.filter((_, k) => k !== i));
  const add = (type: "static" | "http") => {
    const name = newDatasetName(report.datasets);
    setDatasets([...report.datasets, type === "static" ? { name, type, rows: [] } : { name, type, url: "", method: "GET", headers: {} }]);
  };
  const fetchSample = async () => {
    setBusy(true); setFailure(null);
    try {
      const r = await fetch(`/api/reports/${encodeURIComponent(reportId)}/sample`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ report, params: sampleParams }) });
      const body = await r.json().catch(() => null);
      if (!r.ok) { setFailure(typeof body?.error === "string" ? body.error : `샘플 가져오기 실패 (HTTP ${r.status})`); return; }
      const res = body as SampleResponse;
      // 성공한 데이터셋만 덮어쓴다(실패한 것은 이전 샘플 유지). 되돌리기 한 단위
      setSample({ params: sampleParams, data: { ...(sample?.data ?? {}), ...res.data }, capturedAt: res.capturedAt });
      setErrors(res.errors);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const rowsFor = (ds: Dataset): unknown => sample?.data?.[ds.name] ?? (ds.type === "static" ? ds.rows : []);
  const btn = "text-xs border rounded px-2 py-1 bg-white hover:bg-neutral-100 disabled:opacity-50";

  return (
    <div className="p-3 flex flex-col gap-3">
      <section className="flex flex-col gap-1">
        <div className="text-xs font-semibold">파라미터</div>
        {report.params.length === 0 && <div className="text-xs text-neutral-400">없음 (JSON 편집기에서 params를 추가)</div>}
        {report.params.map((p) => <TextField key={p.name} label={p.name} value={String(sampleParams[p.name] ?? "")} onChange={(v) => setParam(p.name, v)} />)}
      </section>
      <section className="flex flex-col gap-1">
        <div className="text-xs font-semibold">데이터셋</div>
        {report.datasets.map((ds, i) => <DatasetEditor key={i} dataset={ds} onChange={(d) => replaceDataset(i, d)} onRemove={() => removeDataset(i)} />)}
        <div className="flex gap-1">
          <button className={btn} onClick={() => add("static")}>+ static</button>
          <button className={btn} onClick={() => add("http")}>+ http</button>
        </div>
      </section>
      <section className="flex flex-col gap-1">
        <button className={btn} disabled={busy} onClick={fetchSample} data-testid="fetch-sample">샘플 가져오기</button>
        {sample?.capturedAt && <div className="text-xs text-neutral-400">{sample.capturedAt}</div>}
        {failure && <div className="text-xs text-red-700">{failure}</div>}
        {errors.map((e) => <div key={e.dataset} className="text-xs text-red-700">{e.dataset}: {e.code} — {e.message}</div>)}
      </section>
      <section className="flex flex-col gap-2">
        <div className="text-xs font-semibold">필드</div>
        {report.datasets.map((ds) => <FieldTree key={ds.name} dataset={ds.name} nodes={inferFields(rowsFor(ds))} />)}
      </section>
    </div>
  );
}
