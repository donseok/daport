"use client";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import type { Report } from "@daport/core";
import { createEditorStore, EditorContext, useEditor, type EditorStore } from "./store";
import { useKeyboard } from "./useKeyboard";
import { Canvas } from "./canvas/Canvas";
import { Preview } from "./Preview";
import { Toolbar } from "./Toolbar";
import { ElementPalette } from "./panels/ElementPalette";
import { PropertyPanel } from "./panels/PropertyPanel";
import { PagePanel } from "./panels/PagePanel";
import { JsonEditor } from "./json/JsonEditor";
import { EditorErrorBoundary } from "./EditorErrorBoundary";
import { DataPanel } from "./data/DataPanel";

function Body({ reportId, zoom }: { reportId: string; zoom: number }) {
  const mode = useEditor((s) => s.mode);
  const report = useEditor((s) => s.report);
  // 렌더 오류는 이 영역만 폴백으로 바꾼다. 모드를 바꾸면 새로 마운트하고, 레포트를 고치면(JSON 편집 등) 스스로 다시 그려 본다
  return (
    <EditorErrorBoundary key={mode} resetKey={report}>
      {mode === "preview" ? <Preview reportId={reportId} /> : <div className="p-8 overflow-auto h-full"><Canvas zoom={zoom} /></div>}
    </EditorErrorBoundary>
  );
}

/** 저장하지 않은 편집이 있는 동안에만 문서를 떠날 때(탭 닫기·새로고침·주소창 이동) 브라우저의 이탈 확인을 띄운다 */
function useUnsavedChangesWarning(store: EditorStore) {
  const dirty = useStore(store, (s) => s.dirty);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };   // returnValue는 옛 브라우저용
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}

export function Editor({ initial }: { initial: Report }) {
  const store = useMemo(() => createEditorStore(initial), [initial]);
  const report = useStore(store, (s) => s.report);
  const [zoom, setZoom] = useState(1);
  const [tab, setTab] = useState<"elements" | "data">("elements");
  useKeyboard(store);
  useUnsavedChangesWarning(store);
  return (
    <EditorContext.Provider value={store}>
      <div className="h-screen flex flex-col">
        {/* 툴바의 PageSelector도 layoutFor를 쓴다. layoutFor는 전체 함수라 던지지 않지만, 벨트-앤-브레이스로 여기도 가둔다 */}
        <EditorErrorBoundary resetKey={report}>
          <Toolbar reportId={initial.id} zoom={zoom} setZoom={setZoom} />
        </EditorErrorBoundary>
        <div className="flex-1 grid grid-cols-[260px_1fr_280px] min-h-0">
          <aside className="border-r bg-white overflow-auto flex flex-col">
            <div className="flex border-b text-xs">
              {(["elements", "data"] as const).map((t) => (
                <button key={t} className={`flex-1 py-1 ${tab === t ? "font-semibold bg-neutral-100" : "text-neutral-500"}`} onClick={() => setTab(t)}>{t === "elements" ? "요소" : "데이터"}</button>
              ))}
            </div>
            {tab === "elements" ? <ElementPalette /> : <DataPanel reportId={initial.id} />}
          </aside>
          <main className="min-w-0 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 overflow-auto"><Body reportId={initial.id} zoom={zoom} /></div>
            <div className="h-64 border-t bg-white"><JsonEditor /></div>
          </main>
          <aside className="border-l bg-white overflow-auto"><PagePanel /><PropertyPanel /></aside>
        </div>
      </div>
    </EditorContext.Provider>
  );
}
