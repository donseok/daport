"use client";
import type { RepeaterElement, RepeaterGroup } from "@daport/core";
import { useEditor } from "../store";
import { NumberField, TextField, SelectField, CheckField } from "./Field";

const btn = "text-xs border rounded px-1 bg-white hover:bg-neutral-100";

/** 반복 영역 속성 (스펙 7.3). 그룹 머리·소계의 자식은 JSON 편집기나 캔버스(선택 후 팔레트)로 넣는다 */
export function RepeaterPanel({ el }: { el: RepeaterElement }) {
  const updateElement = useEditor((s) => s.updateElement);
  const set = (patch: Partial<RepeaterElement>) => updateElement(el.id, patch);
  const setGroup = (i: number, patch: Partial<RepeaterGroup>) => set({ groups: el.groups.map((g, k) => (k === i ? { ...g, ...patch } : g)) });
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold mt-2">반복 영역</div>
      {/* 빈 값은 스키마(min 1)에 걸려 저장이 실패하므로 커밋하지 않는다 */}
      <TextField label="소스" value={el.source} onChange={(v) => { if (v.trim() !== "") set({ source: v }); }} />
      <SelectField label="배치" value={el.layout} options={["list", "grid"]} onChange={(layout) => set({ layout })} />
      <NumberField label="가로 간격" value={el.gap[0]} min={0} onChange={(v) => set({ gap: [v, el.gap[1]] })} />
      <NumberField label="세로 간격" value={el.gap[1]} min={0} onChange={(v) => set({ gap: [el.gap[0], v] })} />
      <NumberField label="항목 너비" value={el.item.w} min={1} onChange={(w) => set({ item: { ...el.item, w } })} />
      <NumberField label="항목 높이" value={el.item.h} min={1} onChange={(h) => set({ item: { ...el.item, h } })} />
      <SelectField label="넘침" value={el.overflow} options={["continue", "clip"]} onChange={(overflow) => set({ overflow })} />

      <div className="text-xs font-semibold mt-2">그룹</div>
      {el.groups.map((g, i) => (
        <div key={i} className="flex flex-col gap-1 border rounded p-1">
          {/* 빈 값은 스키마(min 1)에 걸려 저장이 실패하므로 커밋하지 않는다 */}
          <TextField label="그룹 기준" value={g.by} onChange={(v) => { if (v.trim() !== "") setGroup(i, { by: v }); }} />
          <CheckField label="머리 사용" value={!!g.header} onChange={(on) => setGroup(i, { header: on ? { h: 8, children: [] } : undefined })} />
          {g.header && <NumberField label="머리 높이" value={g.header.h} min={1} onChange={(h) => setGroup(i, { header: { ...g.header!, h } })} />}
          <CheckField label="소계 사용" value={!!g.footer} onChange={(on) => setGroup(i, { footer: on ? { h: 6, children: [] } : undefined })} />
          {g.footer && <NumberField label="소계 높이" value={g.footer.h} min={1} onChange={(h) => setGroup(i, { footer: { ...g.footer!, h } })} />}
          <div className="text-xs text-neutral-400">머리·소계 자식은 JSON 편집기에서 편집합니다</div>
          <button className={btn + " self-start"} onClick={() => set({ groups: el.groups.filter((_, k) => k !== i) })}>그룹 삭제</button>
        </div>
      ))}
      <button className={btn + " self-start"} onClick={() => set({ groups: [...el.groups, { by: "item.", header: { h: 8, children: [] } }] })}>+ 그룹</button>
    </div>
  );
}
