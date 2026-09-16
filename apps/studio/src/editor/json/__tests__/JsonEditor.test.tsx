import { describe, it, expect, afterEach, vi } from "vitest";
import { useRef } from "react";
import { render, cleanup, act } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../../store";
import { JsonEditor } from "../JsonEditor";

// @monaco-editor/react 4.7은 첫 렌더의 onMount를 ref에 담아 두고, Monaco(CDN) 로드가 끝나면 그 첫 클로저를 부른다.
// 가짜 Editor도 똑같이 첫 onMount만 기억하고, 테스트가 원하는 시점에 마운트를 끝낸다.
// 실제 Monaco처럼 모델 편집(pushEditOperations)은 onChange를 부르고, setValue는 커서·undo 기록을 지운다.
type ViewState = { cursor: number };
type FakeCodeEditor = {
  getValue(): string;
  setValue(v: string): void;
  getModel(): { getFullModelRange(): unknown; pushStackElement(): void; pushEditOperations(before: unknown, ops: { text: string | null }[], computer: unknown): null };
  saveViewState(): ViewState;
  restoreViewState(s: ViewState | null): void;
  /** 테스트 도우미: 사용자가 편집기에 입력한다 */
  type(v: string): void;
  cursor: number;
  undoStackCleared: boolean;
};
let finishMount: (() => FakeCodeEditor) | null = null;

vi.mock("@monaco-editor/react", () => ({
  default: function FakeEditor(props: { onMount?: (editor: FakeCodeEditor, monaco: unknown) => void; onChange?: (v?: string) => void }) {
    const onMountRef = useRef(props.onMount);
    const onChangeRef = useRef(props.onChange);
    onChangeRef.current = props.onChange;   // 실제 라이브러리도 onChange는 최신 것을 구독한다
    finishMount = () => {
      let value = "";
      const editor: FakeCodeEditor = {
        cursor: 0, undoStackCleared: false,
        getValue: () => value,
        setValue: (v) => { value = v; editor.cursor = 0; editor.undoStackCleared = true; onChangeRef.current?.(v); },
        getModel: () => ({
          getFullModelRange: () => ({ full: true }),
          pushStackElement: () => {},
          pushEditOperations: (_before, ops) => { value = ops[0].text ?? ""; editor.cursor = value.length; onChangeRef.current?.(value); return null; },
        }),
        saveViewState: () => ({ cursor: editor.cursor }),
        restoreViewState: (s) => { if (s) editor.cursor = s.cursor; },
        type: (v) => { value = v; editor.cursor = 7; onChangeRef.current?.(v); },
      };
      const monaco = { languages: { json: { jsonDefaults: { setDiagnosticsOptions: () => {} } } } };
      onMountRef.current?.(editor, monaco);
      editor.undoStackCleared = false;   // 마운트 시 초기 내용 설정은 기록을 지워도 된다
      return editor;
    };
    return <div data-testid="monaco" />;
  },
}));

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "title", type: "text", x: 15, y: 20, w: 50, h: 10, value: "T" },
]});

function setup() {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));   // 스키마 요청은 응답하지 않는다
  const store = createEditorStore(report);
  render(<EditorContext.Provider value={store}><JsonEditor /></EditorContext.Provider>);
  const mountEditor = () => { let editor!: FakeCodeEditor; act(() => { editor = finishMount!(); }); return editor; };
  return { store, mountEditor };
}

const titleOf = (text: string) => JSON.parse(text).elements[0];

afterEach(() => { cleanup(); finishMount = null; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("JsonEditor", () => {
  it("fills the editor with the current report when Monaco finishes loading after a canvas edit", async () => {
    const { store, mountEditor } = setup();

    // Monaco가 아직 로드 중일 때 캔버스에서 제목을 옮긴다
    act(() => { store.getState().select(["title"]); store.getState().moveSelected(25.5, 0); });
    expect(store.getState().report.elements[0].x).toBe(40.5);

    const editor = mountEditor();
    expect(titleOf(editor.getValue()).x).toBe(40.5);

    // 편집기 내용이 스토어로 되돌아와도 캔버스 편집이 되돌려지지 않는다
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(store.getState().report.elements[0].x).toBe(40.5);
  });

  it("pushes store changes as an undoable model edit that keeps the cursor and is not treated as typing", async () => {
    const { store, mountEditor } = setup();
    const editor = mountEditor();
    editor.cursor = 42;

    act(() => { store.getState().select(["title"]); store.getState().moveSelected(10, 0); });
    expect(titleOf(editor.getValue()).x).toBe(25);
    expect(editor.cursor).toBe(42);                   // 뷰 상태 복원
    expect(editor.undoStackCleared).toBe(false);      // setValue를 쓰지 않는다

    // 반영 직후(디바운스 창 안)의 되돌리기가 방금 넣은 텍스트로 다시 덮이지 않는다
    act(() => store.getState().undo());
    expect(store.getState().report.elements[0].x).toBe(15);
    expect(titleOf(editor.getValue()).x).toBe(15);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(store.getState().report.elements[0].x).toBe(15);
    expect(titleOf(editor.getValue()).x).toBe(15);
  });

  it("flushes text typed during the debounce before syncing a store change, instead of overwriting it", async () => {
    const { store, mountEditor } = setup();
    const editor = mountEditor();

    const typed = editor.getValue().replace('"value": "T"', '"value": "typed"');
    act(() => editor.type(typed));
    act(() => store.getState().updatePage({ width: 120 }));   // 400ms가 지나기 전에 다른 곳에서 스토어가 바뀐다

    expect(editor.getValue()).toBe(typed);                     // 입력한 텍스트가 그대로 남는다
    expect(editor.cursor).toBe(7);
    expect(store.getState().report.elements[0]).toMatchObject({ value: "typed" });   // 기다리지 않고 바로 반영
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(editor.getValue()).toBe(typed);
    expect(store.getState().report.elements[0]).toMatchObject({ value: "typed" });
  });

  it("keeps half-typed invalid JSON when a store change lands during the debounce", async () => {
    const { store, mountEditor } = setup();
    const editor = mountEditor();

    act(() => editor.type('{ "id": "r", '));
    act(() => store.getState().updatePage({ width: 120 }));
    expect(editor.getValue()).toBe('{ "id": "r", ');
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(editor.getValue()).toBe('{ "id": "r", ');
  });
});
