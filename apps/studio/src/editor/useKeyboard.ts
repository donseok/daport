import { useEffect } from "react";
import type { EditorStore } from "./store";

export function useKeyboard(store: EditorStore) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // target이 window/document인 합성 이벤트도 들어올 수 있으므로 Element일 때만 폼 컨트롤 안인지 본다
      if (!(e.target instanceof Element) || e.target.closest("input, textarea, select, .monaco-editor")) return;
      const s = store.getState();
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return; }
      // 미리보기에서는 캔버스와 선택 상자가 가려져 있으므로 보이지 않는 선택을 복제·삭제·이동하지 않는다
      if (s.mode !== "design") return;
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
