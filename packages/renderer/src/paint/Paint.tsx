import type { CSSProperties } from "react";
import { isSafeCssColor } from "@daport/core";
import type { Page, PlacedItem } from "../layout/types";

function box(i: PlacedItem): CSSProperties {
  return { left: `${i.x}mm`, top: `${i.y}mm`, width: `${i.w}mm`, height: `${i.h}mm` };
}

// 캔버스는 스키마 검증 전의 메모리 편집도 그리므로, 인라인 style에 넣기 전에 색 값을 다시 거른다 (CSS 선언 주입, url() 요청 차단)
const safeColor = (v: string | undefined) => (v !== undefined && isSafeCssColor(v) ? v : undefined);

function Item({ item }: { item: PlacedItem }) {
  const s = item.style;
  const color = safeColor(s.color), stroke = safeColor(s.stroke), fill = safeColor(s.fill);
  const border = stroke ? `${s.strokeWidth}mm solid ${stroke}` : undefined;
  const cls = "dp-el" + (item.error ? " dp-err" : "");
  const common = { className: cls, "data-element-id": item.elementId, "data-instance": item.instance, "data-role": item.role, title: item.error } as const;
  // 캔버스가 첫 항목이 아닌 반복 인스턴스에 붙이는 표시(dim: true)만 읽는다. 서버 렌더에는 이 필드가 없어 출력이 변하지 않는다
  const dimStyle = (item as { dim?: boolean }).dim ? { opacity: 0.5 } : undefined;
  switch (item.kind) {
    case "text": {
      const justify = s.valign === "middle" ? "center" : s.valign === "bottom" ? "flex-end" : "flex-start";
      return (
        <div {...common} className={cls + " dp-text"} style={{ ...box(item), fontSize: `${s.fontSize}pt`, fontWeight: s.bold ? 700 : 400,
          color, textAlign: s.align, lineHeight: `${item.lineHeight}mm`, padding: `${s.padding}mm`,
          background: fill, border,
          display: "flex", flexDirection: "column", justifyContent: justify, ...dimStyle }}>
          {item.lines.map((l, n) => <div key={n}>{l === "" ? " " : l}</div>)}
        </div>
      );
    }
    case "rect":
      return <div {...common} style={{ ...box(item), background: fill, borderRadius: `${s.radius}mm`, border, ...dimStyle }} />;
    case "line": {
      // SVG 상자를 선 두께의 절반씩 넓힌다. 높이(폭) 0에 가까운 SVG는 Chromium이 그리지 않아 가로·세로선이 사라지고,
      // 캔버스에서 잡을 영역도 없다. viewBox 단위가 mm이므로 strokeWidth도 mm로 그려진다 (non-scaling-stroke를 쓰면 px가 된다)
      const sw = s.strokeWidth, p = sw / 2;
      const left = Math.min(item.x, item.x2) - p, top = Math.min(item.y, item.y2) - p;
      const w = Math.abs(item.x2 - item.x) + sw, h = Math.abs(item.y2 - item.y) + sw;
      return (
        <svg {...common} className={cls + " dp-line"} style={{ left: `${left}mm`, top: `${top}mm`, width: `${w}mm`, height: `${h}mm`, ...dimStyle }}
          viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
          <line x1={item.x - left} y1={item.y - top} x2={item.x2 - left} y2={item.y2 - top}
            stroke={stroke ?? "#000"} strokeWidth={sw} />
        </svg>
      );
    }
    case "image":
      return <img {...common} src={item.src || undefined} alt="" style={{ ...box(item), objectFit: item.fit === "stretch" ? "fill" : item.fit, ...dimStyle }} />;
    case "placeholder":
      return <div {...common} className={cls + " dp-ph"} style={{ ...box(item), ...dimStyle }}>{item.label}</div>;
  }
}

export function PaintPage({ page }: { page: Page }) {
  return (
    <div className="dp-page" data-page-index={page.index}>
      {page.items.map((it, n) => <Item key={`${it.elementId}|${it.instance ?? ""}|${n}`} item={it} />)}
    </div>
  );
}

export function PaintPages({ pages }: { pages: Page[] }) {
  return <>{pages.map((p) => <PaintPage key={p.index} page={p} />)}</>;
}
