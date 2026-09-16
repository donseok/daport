"use client";
import { useMemo, useState } from "react";
import type { Report } from "@daport/core";
import { createEditorStore, EditorContext, useEditor } from "./store";
import { useKeyboard } from "./useKeyboard";
import { Canvas } from "./canvas/Canvas";
import { Preview } from "./Preview";
import { Toolbar } from "./Toolbar";
import { ElementPalette } from "./panels/ElementPalette";
import { PropertyPanel } from "./panels/PropertyPanel";
import { PagePanel } from "./panels/PagePanel";
import { JsonEditor } from "./json/JsonEditor";

function Body({ zoom }: { zoom: number }) {
  const mode = useEditor((s) => s.mode);
  return mode === "preview" ? <Preview /> : <div className="p-8 overflow-auto h-full"><Canvas zoom={zoom} /></div>;
}

export function Editor({ initial }: { initial: Report }) {
  const store = useMemo(() => createEditorStore(initial), [initial]);
  const [zoom, setZoom] = useState(1);
  useKeyboard(store);
  return (
    <EditorContext.Provider value={store}>
      <div className="h-screen flex flex-col">
        <Toolbar zoom={zoom} setZoom={setZoom} />
        <div className="flex-1 grid grid-cols-[200px_1fr_260px] min-h-0">
          <aside className="border-r bg-white overflow-auto"><ElementPalette /></aside>
          <main className="min-w-0 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 overflow-auto"><Body zoom={zoom} /></div>
            <div className="h-64 border-t bg-white"><JsonEditor /></div>
          </main>
          <aside className="border-l bg-white overflow-auto"><PagePanel /><PropertyPanel /></aside>
        </div>
      </div>
    </EditorContext.Provider>
  );
}
