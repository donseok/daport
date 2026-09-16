"use client";
import type { Element } from "@daport/core";
import { useEditor } from "../store";

const ITEMS: { label: string; make: (id: string) => Element }[] = [
  { label: "텍스트", make: (id) => ({ id, type: "text", x: 10, y: 10, w: 40, h: 8, value: "텍스트", flow: "once", style: defaultStyle() }) },
  { label: "이미지", make: (id) => ({ id, type: "image", x: 10, y: 10, w: 30, h: 30, src: "", fit: "contain", flow: "once", style: defaultStyle() }) },
  { label: "선", make: (id) => ({ id, type: "line", x: 10, y: 10, w: 50, h: 0, x2: 60, y2: 10, flow: "once", style: { ...defaultStyle(), stroke: "#000" } }) },
  { label: "사각형", make: (id) => ({ id, type: "rect", x: 10, y: 10, w: 40, h: 20, flow: "once", style: { ...defaultStyle(), stroke: "#000" } }) },
  { label: "페이지번호", make: (id) => ({ id, type: "pageNumber", x: 10, y: 10, w: 40, h: 6, format: "{{ page }} / {{ total }}", flow: "every", style: defaultStyle() }) },
];

function defaultStyle() {
  return { fontFamily: "Pretendard" as const, fontSize: 10, bold: false, color: "#000000", align: "left" as const, valign: "top" as const, wrap: true, lineHeight: 1.3, strokeWidth: 0.2, radius: 0, padding: 0 };
}

export function ElementPalette() {
  const addElement = useEditor((s) => s.addElement);
  const findElement = useEditor((s) => s.findElement);
  const nextId = (base: string) => { let n = 1; while (findElement(`${base}-${n}`)) n++; return `${base}-${n}`; };
  return (
    <div className="p-3 flex flex-col gap-1">
      <div className="text-xs font-semibold mb-1">요소</div>
      {ITEMS.map((it) => (
        <button key={it.label} className="text-left text-xs border rounded px-2 py-1 hover:bg-neutral-100" onClick={() => addElement(it.make(nextId(it.label === "텍스트" ? "text" : it.label === "이미지" ? "image" : it.label === "선" ? "line" : it.label === "사각형" ? "rect" : "pn")))}>
          + {it.label}
        </button>
      ))}
    </div>
  );
}
