"use client";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import type { Report } from "@daport/core";
import { createEditorStore, EditorContext, useEditor, type EditorStore, type EditorState } from "./store";
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
import { LibraryPanel } from "./library/LibraryPanel";
import { PropsPanel } from "./panels/PropsPanel";
import { AiPanel } from "./ai/AiPanel";

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

type Tab = "elements" | "data" | "components" | "props";
const TAB_LABEL: Record<Tab, string> = { elements: "요소", data: "데이터", components: "컴포넌트", props: "입력값" };

type BottomTab = "json" | "ai";

/** componentMode가 있으면 컴포넌트 전용 편집 화면이다(스펙 7.5). 중첩 금지라 라이브러리 탭을 두지 않는다 */
export function Editor({ initial, componentMode }: { initial: Report; componentMode?: EditorState["componentMode"] }) {
  const store = useMemo(() => createEditorStore(initial, componentMode ? { componentMode } : undefined), [initial, componentMode]);
  const report = useStore(store, (s) => s.report);
  const [zoom, setZoom] = useState(1);
  const [tab, setTab] = useState<Tab>("elements");
  const [bottomTab, setBottomTab] = useState<BottomTab>("json");
  const tabs: Tab[] = componentMode ? ["elements", "props"] : ["elements", "data", "components"];
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
              {tabs.map((t) => (
                <button key={t} className={`flex-1 py-1 ${tab === t ? "font-semibold bg-neutral-100" : "text-neutral-500"}`} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>
              ))}
            </div>
            {tab === "elements" && <ElementPalette />}
            {tab === "data" && <DataPanel reportId={initial.id} />}
            {tab === "components" && <LibraryPanel />}
            {tab === "props" && <PropsPanel />}
          </aside>
          <main className="min-w-0 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 overflow-auto"><Body reportId={initial.id} zoom={zoom} /></div>
            <div className="h-64 border-t bg-white flex flex-col">
              {/* 컴포넌트 편집 화면에서는 AI 탭을 숨긴다(컴포넌트 내용 편집은 범위 밖) */}
              {!componentMode && (
                <div className="flex border-b text-xs shrink-0" role="tablist" aria-label="하단 패널">
                  <button id="bottom-tab-json" role="tab" aria-selected={bottomTab === "json"} aria-controls="bottom-panel-json"
                    className={`flex-1 py-1 ${bottomTab === "json" ? "font-semibold bg-neutral-100" : "text-neutral-500"}`} onClick={() => setBottomTab("json")}>JSON</button>
                  <button id="bottom-tab-ai" role="tab" aria-selected={bottomTab === "ai"} aria-controls="bottom-panel-ai"
                    className={`flex-1 py-1 ${bottomTab === "ai" ? "font-semibold bg-neutral-100" : "text-neutral-500"}`} onClick={() => setBottomTab("ai")}>AI</button>
                </div>
              )}
              {/* Monaco는 숨길 때도 언마운트하지 않는다(편집기 상태 보존) */}
              <div id="bottom-panel-json" role="tabpanel" {...(!componentMode ? { "aria-labelledby": "bottom-tab-json" } : {})}
                className={`flex-1 min-h-0 ${!componentMode && bottomTab === "ai" ? "hidden" : ""}`}><JsonEditor /></div>
              {/* AiPanel도 JSON과 똑같이 숨길 때 언마운트하지 않는다 — 그렇지 않으면 탭 전환마다 대화 기록이 사라지고
                  진행 중인 요청도 unmount cleanup으로 조용히 취소돼 버린다(스펙 7.1: 대화 목록 유지) */}
              {!componentMode && (
                <div id="bottom-panel-ai" role="tabpanel" aria-labelledby="bottom-tab-ai"
                  className={`flex-1 min-h-0 ${bottomTab === "json" ? "hidden" : ""}`}><AiPanel reportId={initial.id} /></div>
              )}
            </div>
          </main>
          <aside className="border-l bg-white overflow-auto"><PagePanel /><PropertyPanel /></aside>
        </div>
      </div>
    </EditorContext.Provider>
  );
}
