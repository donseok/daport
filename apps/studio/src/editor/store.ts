import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { createContext, useContext } from "react";
import { safeParseReport, type Report, type Element, type Page } from "@daport/core";
import { createHistory, commit, undo, redo, type History } from "./history";

export type Problem = { path: string; message: string };

export type EditorState = {
  history: History<Report>;
  report: Report;
  selection: string[];
  problems: Problem[];
  dirty: boolean;
  mode: "design" | "preview";
  // queries
  findElement(id: string): Element | undefined;
  allocateId(base: string): string;   // 트리 전체에서 비어 있는 `${base}-n`
  // mutations
  select(ids: string[]): void;
  toggleSelect(id: string): void;
  updateElement(id: string, patch: Partial<Element>): void;
  moveSelected(dx: number, dy: number): void;
  resizeElement(id: string, box: { x: number; y: number; w: number; h: number }): void;
  addElement(el: Element): void;
  duplicateSelected(): void;
  deleteSelected(): void;
  updatePage(patch: Partial<Page>): void;
  replaceReport(candidate: unknown): boolean;
  undo(): void;
  redo(): void;
  setMode(m: "design" | "preview"): void;
  markSaved(): void;
};

function walk(els: Element[], fn: (el: Element, parent: Element[] , idx: number) => boolean | void): boolean {
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    if (fn(el, els, i)) return true;
    if (el.type === "group" && walk(el.children, fn)) return true;
  }
  return false;
}

function newId(base: string, report: Report): string {
  const ids = new Set<string>();
  walk(report.elements, (el) => { ids.add(el.id); });
  let n = 1; let id = `${base}-${n}`;
  while (ids.has(id)) { n++; id = `${base}-${n}`; }
  return id;
}

const round = (v: number) => Math.round(v * 100) / 100;

export function createEditorStore(initial: Report) {
  return createStore<EditorState>((set, get) => {
    const apply = (mutate: (r: Report) => void) => {
      const h = commit(get().history, mutate);
      if (h !== get().history) set({ history: h, report: h.present, dirty: true, problems: [] });
    };
    return {
      history: createHistory(initial), report: initial, selection: [], problems: [], dirty: false, mode: "design",
      findElement: (id) => { let found: Element | undefined; walk(get().report.elements, (el) => { if (el.id === id) { found = el; return true; } }); return found; },
      allocateId: (base) => newId(base, get().report),
      select: (ids) => set({ selection: ids }),
      toggleSelect: (id) => set((s) => ({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] })),
      updateElement: (id, patch) => apply((r) => { walk(r.elements, (el) => { if (el.id === id) { Object.assign(el, patch); return true; } }); }),
      moveSelected: (dx, dy) => apply((r) => { const sel = new Set(get().selection); walk(r.elements, (el) => {
        if (sel.has(el.id)) { el.x = round(el.x + dx); el.y = round(el.y + dy); if (el.type === "line") { el.x2 = round(el.x2 + dx); el.y2 = round(el.y2 + dy); } } }); }),
      resizeElement: (id, box) => apply((r) => { walk(r.elements, (el) => { if (el.id === id) {
        if (el.type === "line") { el.x2 = round(el.x2 + (box.x + box.w) - (el.x + el.w)); el.y2 = round(el.y2 + (box.y + box.h) - (el.y + el.h)); }
        el.x = round(box.x); el.y = round(box.y); el.w = round(box.w); el.h = round(box.h); return true; } }); }),
      addElement: (el) => { apply((r) => { r.elements.push(el); }); set({ selection: [el.id] }); },
      duplicateSelected: () => {
        const ids: string[] = [];
        apply((r) => { const sel = new Set(get().selection); const copies: Element[] = [];
          walk(r.elements, (el) => { if (sel.has(el.id)) { const c = structuredClone(el) as Element; c.id = newId(el.id, r); c.x += 5; c.y += 5; ids.push(c.id); copies.push(c); } });
          r.elements.push(...copies); });
        set({ selection: ids });
      },
      deleteSelected: () => { apply((r) => { const sel = new Set(get().selection); const prune = (els: Element[]) => { for (let i = els.length - 1; i >= 0; i--) { if (sel.has(els[i].id)) els.splice(i, 1); else if (els[i].type === "group") prune((els[i] as any).children); } }; prune(r.elements); }); set({ selection: [] }); },
      updatePage: (patch) => apply((r) => { Object.assign(r.page, patch); }),
      replaceReport: (candidate) => {
        const res = safeParseReport(candidate);
        if (!res.success) { set({ problems: res.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }); return false; }
        apply((r) => { Object.assign(r, res.data); for (const k of Object.keys(r)) if (!(k in res.data)) delete (r as any)[k]; });
        set({ selection: get().selection.filter((id) => !!get().findElement(id)) });
        return true;
      },
      undo: () => { const h = undo(get().history); set({ history: h, report: h.present, dirty: true }); },
      redo: () => { const h = redo(get().history); set({ history: h, report: h.present, dirty: true }); },
      setMode: (mode) => set({ mode }),
      markSaved: () => set({ dirty: false }),
    };
  });
}

export type EditorStore = ReturnType<typeof createEditorStore>;
export const EditorContext = createContext<EditorStore | null>(null);
export function useEditor<T>(selector: (s: EditorState) => T): T {
  const store = useContext(EditorContext);
  if (!store) throw new Error("EditorContext missing");
  return useStore(store, selector);
}
