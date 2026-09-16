import { describe, it, expect, afterEach, vi } from "vitest";
import { useRef } from "react";
import { render, cleanup, act } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../../store";
import { JsonEditor } from "../JsonEditor";

// @monaco-editor/react 4.7은 첫 렌더의 onMount를 ref에 담아 두고, Monaco(CDN) 로드가 끝나면 그 첫 클로저를 부른다.
// 가짜 Editor도 똑같이 첫 onMount만 기억하고, 테스트가 원하는 시점에 마운트를 끝낸다.
type FakeCodeEditor = { getValue(): string; setValue(v: string): void };
let finishMount: (() => FakeCodeEditor) | null = null;

vi.mock("@monaco-editor/react", () => ({
  default: function FakeEditor(props: { onMount?: (editor: FakeCodeEditor, monaco: unknown) => void; onChange?: (v?: string) => void }) {
    const onMountRef = useRef(props.onMount);
    const onChangeRef = useRef(props.onChange);
    onChangeRef.current = props.onChange;   // 실제 라이브러리도 onChange는 최신 것을 구독한다
    finishMount = () => {
      let value = "";
      const editor: FakeCodeEditor = { getValue: () => value, setValue: (v) => { value = v; onChangeRef.current?.(v); } };
      const monaco = { languages: { json: { jsonDefaults: { setDiagnosticsOptions: () => {} } } } };
      onMountRef.current?.(editor, monaco);
      return editor;
    };
    return <div data-testid="monaco" />;
  },
}));

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "title", type: "text", x: 15, y: 20, w: 50, h: 10, value: "T" },
]});

afterEach(() => { cleanup(); finishMount = null; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("JsonEditor", () => {
  it("fills the editor with the current report when Monaco finishes loading after a canvas edit", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));   // 스키마 요청은 응답하지 않는다
    const store = createEditorStore(report);
    render(<EditorContext.Provider value={store}><JsonEditor /></EditorContext.Provider>);

    // Monaco가 아직 로드 중일 때 캔버스에서 제목을 옮긴다
    act(() => { store.getState().select(["title"]); store.getState().moveSelected(25.5, 0); });
    expect(store.getState().report.elements[0].x).toBe(40.5);

    let editor!: FakeCodeEditor;
    act(() => { editor = finishMount!(); });
    expect(JSON.parse(editor.getValue()).elements[0].x).toBe(40.5);

    // 편집기 내용이 스토어로 되돌아와도 캔버스 편집이 되돌려지지 않는다
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(store.getState().report.elements[0].x).toBe(40.5);
  });
});
