import { useEffect } from "react";
import type { EditorStore } from "./store";

export function useKeyboard(store: EditorStore) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, .monaco-editor")) return;
      const s = store.getState();
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return; }
      if (meta && e.key.toLowerCase() === "d") { e.preventDefault(); s.duplicateSelected(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { if (s.selection.length) { e.preventDefault(); s.deleteSelected(); } return; }
      const step = e.shiftKey ? 5 : 0.5;
      const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (map[e.key] && s.selection.length) { e.preventDefault(); s.moveSelected(...map[e.key]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);
}
