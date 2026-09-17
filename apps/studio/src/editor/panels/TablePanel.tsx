"use client";
import { StyleSchema, type TableCell, type TableColumn, type TableElement, type TableGroup } from "@daport/core";
import { useEditor } from "../store";
import { NumberField, TextField, SelectField, CheckField } from "./Field";

const move = <T,>(arr: T[], i: number, d: -1 | 1): T[] => { const j = i + d; if (j < 0 || j >= arr.length) return arr; const out = arr.slice(); [out[i], out[j]] = [out[j], out[i]]; return out; };
const btn = "text-xs border rounded px-1 bg-white hover:bg-neutral-100";

/** span 있는 셀 목록 편집 (그룹 머리·소계, 페이지 소계, 합계) */
function CellsEditor({ label, cells, onChange, addLabel }: { label: string; cells: TableCell[]; onChange: (cells: TableCell[]) => void; addLabel: string }) {
  const set = (i: number, patch: Partial<TableCell>) => onChange(cells.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  return (
    <div className="flex flex-col gap-1 border-l pl-2">
      <div className="text-xs text-neutral-500">{label}</div>
      {cells.map((c, i) => (
        <div key={i} className="flex flex-col gap-1">
          <TextField label="셀 값" value={c.value} onChange={(value) => set(i, { value })} />
          <div className="flex gap-1 items-center">
            <TextField label="span" value={String(c.span)} onChange={(v) => set(i, { span: v === "all" ? "all" : Math.max(1, Math.floor(Number(v)) || 1) })} />
            <SelectField label="셀 정렬" value={c.align ?? ""} options={["", "left", "center", "right"]} onChange={(v) => set(i, { align: (v || undefined) as TableCell["align"] })} />
            <button className={btn} aria-label="셀 삭제" onClick={() => onChange(cells.filter((_, k) => k !== i))}>✕</button>
          </div>
        </div>
      ))}
      <button className={btn + " self-start"} onClick={() => onChange([...cells, { value: "", span: 1 }])}>{addLabel}</button>
    </div>
  );
}

export function TablePanel({ el }: { el: TableElement }) {
  const updateElement = useEditor((s) => s.updateElement);
  const set = (patch: Partial<TableElement>) => updateElement(el.id, patch);
  const setCol = (i: number, patch: Partial<TableColumn>) => set({ columns: el.columns.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const setGroup = (i: number, patch: Partial<TableGroup>) => set({ groups: el.groups.map((g, k) => (k === i ? { ...g, ...patch } : g)) });
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold mt-2">표</div>
      {/* 빈 값은 스키마(min 1)에 걸려 저장이 실패하므로 커밋하지 않는다 */}
      <TextField label="소스" value={el.source} onChange={(v) => { if (v.trim() !== "") set({ source: v }); }} />
      <NumberField label="행 높이" value={el.rowHeight} min={0.5} onChange={(rowHeight) => set({ rowHeight })} />
      <NumberField label="머리 높이" value={el.headerHeight} min={0.5} onChange={(headerHeight) => set({ headerHeight })} />
      <CheckField label="머리 반복" value={el.repeatHeader} onChange={(repeatHeader) => set({ repeatHeader })} />
      <SelectField label="넘침" value={el.overflow} options={["continue", "clip"]} onChange={(overflow) => set({ overflow })} />
      <SelectField label="테두리" value={el.border} options={["all", "rows", "none"]} onChange={(border) => set({ border })} />
      <NumberField label="테두리 굵기" value={el.borderStyle.strokeWidth} step={0.1} min={0} onChange={(strokeWidth) => set({ borderStyle: { ...el.borderStyle, strokeWidth } })} />
      <TextField label="테두리색" value={el.borderStyle.stroke} onChange={(stroke) => set({ borderStyle: { ...el.borderStyle, stroke } })} />

      <div className="text-xs font-semibold mt-2">열</div>
      {el.columns.map((c, i) => (
        <div key={i} className="flex flex-col gap-1 border rounded p-1">
          <TextField label="머리글" value={c.header} onChange={(header) => setCol(i, { header })} />
          <TextField label="값" value={c.value} onChange={(value) => setCol(i, { value })} />
          <NumberField label="너비" value={c.w} min={1} onChange={(w) => setCol(i, { w })} />
          <SelectField label="정렬" value={c.align ?? ""} options={["", "left", "center", "right"]} onChange={(v) => setCol(i, { align: (v || undefined) as TableColumn["align"] })} />
          <div className="flex gap-1">
            <button className={btn} aria-label="▲" onClick={() => set({ columns: move(el.columns, i, -1) })}>▲</button>
            <button className={btn} aria-label="▼" onClick={() => set({ columns: move(el.columns, i, 1) })}>▼</button>
            <button className={btn} aria-label="✕" onClick={() => set({ columns: el.columns.filter((_, k) => k !== i) })}>✕</button>
          </div>
        </div>
      ))}
      <button className={btn + " self-start"} onClick={() => set({ columns: [...el.columns, { header: `열 ${el.columns.length + 1}`, value: "", w: 30, style: StyleSchema.parse({}) }] })}>+ 열</button>

      <div className="text-xs font-semibold mt-2">그룹</div>
      {el.groups.map((g, i) => (
        <div key={i} className="flex flex-col gap-1 border rounded p-1">
          {/* 빈 값은 스키마(min 1)에 걸려 저장이 실패하므로 커밋하지 않는다 */}
          <TextField label="그룹 기준" value={g.by} onChange={(v) => { if (v.trim() !== "") setGroup(i, { by: v }); }} />
          <CheckField label="머리와 행 함께" value={g.keepHeaderWithRows} onChange={(keepHeaderWithRows) => setGroup(i, { keepHeaderWithRows })} />
          <CellsEditor label="그룹 머리" cells={g.header} onChange={(header) => setGroup(i, { header })} addLabel="+ 머리 셀" />
          <CellsEditor label="그룹 소계" cells={g.footer} onChange={(footer) => setGroup(i, { footer })} addLabel="+ 소계 셀" />
          <button className={btn + " self-start"} onClick={() => set({ groups: el.groups.filter((_, k) => k !== i) })}>그룹 삭제</button>
        </div>
      ))}
      <button className={btn + " self-start"} onClick={() => set({ groups: [...el.groups, { by: "row.", header: [{ value: "{{ group.key }}", span: "all" }], footer: [], keepHeaderWithRows: true }] })}>+ 그룹</button>

      <CellsEditor label="페이지 소계" cells={el.pageFooter} onChange={(pageFooter) => set({ pageFooter })} addLabel="+ 페이지 소계 셀" />
      <CellsEditor label="표 합계" cells={el.footer} onChange={(footer) => set({ footer })} addLabel="+ 합계 셀" />
    </div>
  );
}
