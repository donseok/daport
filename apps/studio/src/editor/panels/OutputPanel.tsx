"use client";
import type { LabelOutput } from "@daport/core";
import { useEditor } from "../store";
import { Field, NumberField, SelectField } from "./Field";

const DEFAULT_LABEL: LabelOutput = { language: "zpl", dpi: 203, threshold: 128, copies: 1 };

/** 빈 값이면 undefined, 범위 밖이면 커밋하지 않는 선택 정수 입력 (농도·속도) */
function OptionalIntField({ label, value, min, max, onChange }: { label: string; value: number | undefined; min: number; max: number; onChange: (v: number | undefined) => void }) {
  return <Field label={label}><input aria-label={label} type="number" min={min} max={max} value={value ?? ""} className="w-full border rounded px-1 py-0.5"
    onChange={(e) => { if (e.target.value === "") { onChange(undefined); return; } const n = e.target.valueAsNumber; if (Number.isInteger(n) && n >= min && n <= max) onChange(n); }} /></Field>;
}

/** 출력 설정 (스펙 7.2). 라벨이면 언어·DPI·임계값·농도·속도·매수 */
export function OutputPanel() {
  const output = useEditor((s) => s.report.output);
  const setOutput = useEditor((s) => s.setOutput);
  const label = output.kind === "label" ? output.label : undefined;
  const setLabel = (patch: Partial<LabelOutput>) => setOutput({ kind: "label", label: { ...(label ?? DEFAULT_LABEL), ...patch } });
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold mt-2">출력</div>
      <SelectField label="출력 종류" value={output.kind} options={["pdf", "label"]} onChange={(kind) => setOutput(kind === "pdf" ? { kind: "pdf" } : { kind: "label", label: label ?? DEFAULT_LABEL })} />
      {label && <>
        <SelectField label="언어" value={label.language} options={["zpl", "tspl"]} onChange={(language) => setLabel({ language })} />
        <SelectField label="DPI" value={String(label.dpi)} options={["203", "300"]} onChange={(v) => setLabel({ dpi: Number(v) as 203 | 300 })} />
        <NumberField label="임계값" value={label.threshold} step={1} min={0} onChange={(v) => { if (Number.isInteger(v) && v <= 255) setLabel({ threshold: v }); }} />
        <OptionalIntField label="농도" value={label.darkness} min={0} max={30} onChange={(darkness) => setLabel({ darkness })} />
        <OptionalIntField label="속도" value={label.speed} min={1} max={14} onChange={(speed) => setLabel({ speed })} />
        <NumberField label="매수" value={label.copies} step={1} min={1} onChange={(v) => { if (Number.isInteger(v)) setLabel({ copies: v }); }} />
      </>}
    </div>
  );
}
