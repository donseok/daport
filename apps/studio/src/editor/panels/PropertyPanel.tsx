"use client";
import type { Element, Style } from "@daport/core";
import { useEditor } from "../store";
import { NumberField, TextField, SelectField, CheckField } from "./Field";

export function PropertyPanel() {
  const selection = useEditor((s) => s.selection);
  const el = useEditor((s) => (s.selection.length === 1 ? s.findElement(s.selection[0]) : undefined));   // 선택 요소가 바뀔 때만 재렌더
  const updateElement = useEditor((s) => s.updateElement);
  if (selection.length !== 1) return <div className="p-3 text-xs text-neutral-500">{selection.length === 0 ? "선택된 요소가 없습니다" : `${selection.length}개 선택됨`}</div>;
  if (!el) return null;
  const set = (patch: Partial<Element>) => updateElement(el.id, patch);
  const setStyle = (patch: Partial<Style>) => set({ style: { ...el.style, ...patch } });

  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="text-xs font-semibold">{el.type} <span className="text-neutral-400">#{el.id}</span></div>
      <NumberField label="X" value={el.x} onChange={(x) => set({ x })} />
      <NumberField label="Y" value={el.y} onChange={(y) => set({ y })} />
      <NumberField label="W" value={el.w} min={0} onChange={(w) => set({ w })} />
      <NumberField label="H" value={el.h} min={0} onChange={(h) => set({ h })} />
      {el.type === "line" && <><NumberField label="X2" value={el.x2} onChange={(x2) => set({ x2 })} /><NumberField label="Y2" value={el.y2} onChange={(y2) => set({ y2 })} /></>}
      {el.type === "text" && <TextField label="내용" value={el.value} multiline onChange={(value) => set({ value })} />}
      {el.type === "image" && <><TextField label="src" value={el.src} onChange={(src) => set({ src })} />
        <SelectField label="fit" value={el.fit} options={["contain", "cover", "stretch"]} onChange={(fit) => set({ fit })} /></>}
      <TextField label="visible" value={el.visible ?? ""} onChange={(v) => set({ visible: v || undefined })} />
      <div className="text-xs font-semibold mt-2">스타일</div>
      {(el.type === "text" || el.type === "pageNumber") && <>
        <NumberField label="글자크기" value={el.style.fontSize} step={0.5} min={0} onChange={(fontSize) => { if (fontSize > 0) setStyle({ fontSize }); }} />
        <CheckField label="굵게" value={el.style.bold} onChange={(bold) => setStyle({ bold })} />
        <SelectField label="정렬" value={el.style.align} options={["left", "center", "right"]} onChange={(align) => setStyle({ align })} />
        <SelectField label="세로정렬" value={el.style.valign} options={["top", "middle", "bottom"]} onChange={(valign) => setStyle({ valign })} />
        <CheckField label="줄바꿈" value={el.style.wrap} onChange={(wrap) => setStyle({ wrap })} />
        <TextField label="글자색" value={el.style.color} onChange={(color) => setStyle({ color })} />
        <NumberField label="여백" value={el.style.padding} min={0} onChange={(padding) => setStyle({ padding })} />
      </>}
      <TextField label="선색" value={el.style.stroke ?? ""} onChange={(v) => setStyle({ stroke: v || undefined })} />
      <NumberField label="선굵기" value={el.style.strokeWidth} step={0.1} min={0} onChange={(strokeWidth) => setStyle({ strokeWidth })} />
      <TextField label="배경색" value={el.style.fill ?? ""} onChange={(v) => setStyle({ fill: v || undefined })} />
      {el.type === "rect" && <NumberField label="모서리" value={el.style.radius} min={0} onChange={(radius) => setStyle({ radius })} />}
    </div>
  );
}
