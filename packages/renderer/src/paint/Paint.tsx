import type { CSSProperties } from "react";
import type { Page, PlacedItem } from "../layout/types";

function box(i: PlacedItem): CSSProperties {
  return { left: `${i.x}mm`, top: `${i.y}mm`, width: `${i.w}mm`, height: `${i.h}mm` };
}

function Item({ item }: { item: PlacedItem }) {
  const s = item.style;
  const cls = "dp-el" + (item.error ? " dp-err" : "");
  const common = { className: cls, "data-element-id": item.elementId, title: item.error } as const;
  switch (item.kind) {
    case "text": {
      const justify = s.valign === "middle" ? "center" : s.valign === "bottom" ? "flex-end" : "flex-start";
      return (
        <div {...common} className={cls + " dp-text"} style={{ ...box(item), fontSize: `${s.fontSize}pt`, fontWeight: s.bold ? 700 : 400,
          color: s.color, textAlign: s.align, lineHeight: `${item.lineHeight}mm`, padding: `${s.padding}mm`,
          background: s.fill, border: s.stroke ? `${s.strokeWidth}mm solid ${s.stroke}` : undefined,
          display: "flex", flexDirection: "column", justifyContent: justify }}>
          {item.lines.map((l, n) => <div key={n}>{l === "" ? " " : l}</div>)}
        </div>
      );
    }
    case "rect":
      return <div {...common} style={{ ...box(item), background: s.fill, borderRadius: `${s.radius}mm`,
        border: s.stroke ? `${s.strokeWidth}mm solid ${s.stroke}` : undefined }} />;
    case "line": {
      const minX = Math.min(item.x, item.x2), minY = Math.min(item.y, item.y2);
      const w = Math.max(Math.abs(item.x2 - item.x), 0.01), h = Math.max(Math.abs(item.y2 - item.y), 0.01);
      return (
        <svg {...common} className={cls + " dp-line"} style={{ left: `${minX}mm`, top: `${minY}mm`, width: `${w}mm`, height: `${h}mm` }}
          viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
          <line x1={item.x - minX} y1={item.y - minY} x2={item.x2 - minX} y2={item.y2 - minY}
            stroke={s.stroke ?? "#000"} strokeWidth={s.strokeWidth} vectorEffect="non-scaling-stroke" />
        </svg>
      );
    }
    case "image":
      return <img {...common} src={item.src || undefined} alt="" style={{ ...box(item), objectFit: item.fit === "stretch" ? "fill" : item.fit }} />;
    case "placeholder":
      return <div {...common} className={cls + " dp-ph"} style={box(item)}>{item.label}</div>;
  }
}

export function PaintPage({ page }: { page: Page }) {
  return (
    <div className="dp-page" data-page-index={page.index}>
      {page.items.map((it) => <Item key={it.elementId} item={it} />)}
    </div>
  );
}

export function PaintPages({ pages }: { pages: Page[] }) {
  return <>{pages.map((p) => <PaintPage key={p.index} page={p} />)}</>;
}
