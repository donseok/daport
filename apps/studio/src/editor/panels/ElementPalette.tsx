"use client";
import { StyleSchema, type Element } from "@daport/core";
import { useEditor } from "../store";

const defaultStyle = () => StyleSchema.parse({});   // core의 기본값을 그대로 쓴다

const ITEMS: { label: string; base: string; make: (id: string) => Element }[] = [
  { label: "텍스트", base: "text", make: (id) => ({ id, type: "text", x: 10, y: 10, w: 40, h: 8, value: "텍스트", flow: "once", style: defaultStyle() }) },
  { label: "이미지", base: "image", make: (id) => ({ id, type: "image", x: 10, y: 10, w: 30, h: 30, src: "", fit: "contain", flow: "once", style: defaultStyle() }) },
  { label: "선", base: "line", make: (id) => ({ id, type: "line", x: 10, y: 10, w: 50, h: 0, x2: 60, y2: 10, flow: "once", style: { ...defaultStyle(), stroke: "#000" } }) },
  { label: "사각형", base: "rect", make: (id) => ({ id, type: "rect", x: 10, y: 10, w: 40, h: 20, flow: "once", style: { ...defaultStyle(), stroke: "#000" } }) },
  { label: "페이지번호", base: "pn", make: (id) => ({ id, type: "pageNumber", x: 10, y: 10, w: 40, h: 6, format: "{{ page }} / {{ total }}", flow: "every", style: defaultStyle() }) },
];

export function ElementPalette() {
  const addElement = useEditor((s) => s.addElement);
  const allocateId = useEditor((s) => s.allocateId);
  return (
    <div className="p-3 flex flex-col gap-1">
      <div className="text-xs font-semibold mb-1">요소</div>
      {ITEMS.map((it) => (
        <button key={it.label} className="text-left text-xs border rounded px-2 py-1 hover:bg-neutral-100" onClick={() => addElement(it.make(allocateId(it.base)))}>
          + {it.label}
        </button>
      ))}
    </div>
  );
}
