"use client";
import { useMemo } from "react";
import { useEditor } from "./store";
import { layoutFor } from "./canvas/layoutCache";
import { clampView } from "./canvas/pages";

const btn = "text-xs border rounded px-1 bg-white hover:bg-neutral-100 disabled:opacity-40";

/** 툴바의 페이지·부 선택기 (스펙 7.4). repeat가 있을 때만 부 선택기가 보인다 */
export function PageSelector() {
  const report = useEditor((s) => s.report);
  const view = useEditor((s) => s.view);
  const setView = useEditor((s) => s.setView);
  const pages = useMemo(() => layoutFor(report), [report]);
  const v = clampView(view, pages);
  const copies = pages.length ? pages[pages.length - 1].copyIndex + 1 : 1;
  const inCopy = pages.filter((p) => p.copyIndex === v.copyIndex).length || 1;
  return (
    <div className="flex items-center gap-1 text-xs" data-testid="page-selector">
      <button className={btn} aria-label="이전 페이지" disabled={v.pageInCopy <= 0} onClick={() => setView({ pageInCopy: v.pageInCopy - 1 })}>◀</button>
      <span data-testid="page-indicator">{v.pageInCopy + 1} / {inCopy}</span>
      <button className={btn} aria-label="다음 페이지" disabled={v.pageInCopy >= inCopy - 1} onClick={() => setView({ pageInCopy: v.pageInCopy + 1 })}>▶</button>
      {report.repeat && <>
        <span className="text-neutral-400 ml-2">부</span>
        <button className={btn} aria-label="이전 부" disabled={v.copyIndex <= 0} onClick={() => setView({ copyIndex: v.copyIndex - 1, pageInCopy: 0 })}>◀</button>
        <span data-testid="copy-indicator">{v.copyIndex + 1} / {copies}</span>
        <button className={btn} aria-label="다음 부" disabled={v.copyIndex >= copies - 1} onClick={() => setView({ copyIndex: v.copyIndex + 1, pageInCopy: 0 })}>▶</button>
      </>}
    </div>
  );
}
