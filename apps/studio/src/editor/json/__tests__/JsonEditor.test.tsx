import { describe, it, expect, afterEach, vi } from "vitest";
import { useRef } from "react";
import { render, cleanup, act, screen } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../../store";
import { JsonEditor } from "../JsonEditor";

// @monaco-editor/react 4.7은 첫 렌더의 onMount를 ref에 담아 두고, Monaco(CDN) 로드가 끝나면 그 첫 클로저를 부른다.
// 가짜 Editor도 똑같이 첫 onMount만 기억하고, 테스트가 원하는 시점에 마운트를 끝낸다.
// 실제 Monaco처럼 모델 편집(pushEditOperations)은 onChange를 부르고, setValue는 커서·undo 기록을 지운다.
// 편집기 밖을 누르면(mousedown) Monaco가 포커스를 잃고 onDidBlurEditorText 구독자를 부른다.
type ViewState = { cursor: number };
type Selection = { cursor: number };
type FakeCodeEditor = {
  getValue(): string;
  setValue(v: string): void;
  getModel(): { getFullModelRange(): unknown; pushStackElement(): void; pushEditOperations(before: Selection[] | null, ops: { text: string | null }[], computer: (inverse: unknown[]) => Selection[] | null): null };
  getSelections(): Selection[] | null;
  saveViewState(): ViewState;
  restoreViewState(s: ViewState | null): void;
  onDidBlurEditorText(listener: () => void): { dispose(): void };
  hasTextFocus(): boolean;
  /** 테스트 도우미: 사용자가 편집기에 입력한다 */
  type(v: string): void;
  /** 테스트 도우미: 편집기가 포커스를 잃는다 */
  blur(): void;
  cursor: number;
  focused: boolean;
  undoStackCleared: boolean;
  /** 마지막 pushEditOperations의 편집 전 선택과 커서 계산기가 돌려준 편집 후 선택 */
  lastPush: { before: Selection[] | null; after: Selection[] | null } | null;
};
let finishMount: (() => FakeCodeEditor) | null = null;

vi.mock("@monaco-editor/react", () => ({
  default: function FakeEditor(props: { onMount?: (editor: FakeCodeEditor, monaco: unknown) => void; onChange?: (v?: string) => void }) {
    const onMountRef = useRef(props.onMount);
    const onChangeRef = useRef(props.onChange);
    onChangeRef.current = props.onChange;   // 실제 라이브러리도 onChange는 최신 것을 구독한다
    finishMount = () => {
      let value = "";
      const blurListeners: (() => void)[] = [];
      const editor: FakeCodeEditor = {
        cursor: 0, focused: false, undoStackCleared: false, lastPush: null,
        getValue: () => value,
        setValue: (v) => { value = v; editor.cursor = 0; editor.undoStackCleared = true; onChangeRef.current?.(v); },
        getModel: () => ({
          getFullModelRange: () => ({ full: true }),
          pushStackElement: () => {},
          pushEditOperations: (before, ops, computer) => {
            value = ops[0].text ?? ""; editor.cursor = value.length;
            editor.lastPush = { before, after: computer([]) };
            onChangeRef.current?.(value); return null;
          },
        }),
        getSelections: () => [{ cursor: editor.cursor }],
        saveViewState: () => ({ cursor: editor.cursor }),
        restoreViewState: (s) => { if (s) editor.cursor = s.cursor; },
        onDidBlurEditorText: (listener) => { blurListeners.push(listener); return { dispose: () => {} }; },
        hasTextFocus: () => editor.focused,
        type: (v) => { value = v; editor.cursor = 7; editor.focused = true; onChangeRef.current?.(v); },
        blur: () => { editor.focused = false; for (const l of blurListeners) l(); },
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
  // 편집기가 스토어로 커밋하는 모든 경로를 본다 (원래 동작은 그대로 부른다)
  const replaceReport = vi.spyOn(store.getState(), "replaceReport");
  render(<EditorContext.Provider value={store}><JsonEditor /></EditorContext.Provider>);
  const mountEditor = () => { let editor!: FakeCodeEditor; act(() => { editor = finishMount!(); }); return editor; };
  return { store, mountEditor, replaceReport };
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
    // Monaco undo 기록에 편집 전·후 선택을 남겨, 편집기 안에서 Ctrl+Z로 되돌려도 커서가 문서 끝으로 튀지 않는다
    expect(editor.lastPush).toEqual({ before: [{ cursor: 42 }], after: [{ cursor: 42 }] });

    // 반영 직후(디바운스 창 안)의 되돌리기가 방금 넣은 텍스트로 다시 덮이지 않는다
    act(() => store.getState().undo());
    expect(store.getState().report.elements[0].x).toBe(15);
    expect(titleOf(editor.getValue()).x).toBe(15);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(store.getState().report.elements[0].x).toBe(15);
    expect(titleOf(editor.getValue()).x).toBe(15);
  });

  it("commits text typed during the debounce when the editor loses focus, so a following canvas change lands on top", async () => {
    const { store, mountEditor } = setup();
    const editor = mountEditor();

    const typed = editor.getValue().replace('"value": "T"', '"value": "typed"');
    act(() => editor.type(typed));
    // 캔버스·팔레트·툴바·패널을 누르면 그 변경보다 mousedown의 포커스 이동(blur)이 먼저 온다
    act(() => editor.blur());
    expect(store.getState().report.elements[0]).toMatchObject({ value: "typed" });   // 기다리지 않고 바로 반영
    act(() => store.getState().updatePage({ width: 120 }));

    expect(store.getState().report.elements[0]).toMatchObject({ value: "typed" });   // 입력도
    expect(store.getState().report.page.width).toBe(120);                            // 뒤이은 변경도 남는다
    expect(JSON.parse(editor.getValue())).toMatchObject({ page: { width: 120 }, elements: [{ value: "typed" }] });
    expect(editor.cursor).toBe(7);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(store.getState().report.page.width).toBe(120);
    expect(store.getState().report.elements[0]).toMatchObject({ value: "typed" });

    act(() => store.getState().undo());                        // 되돌리기는 뒤에 온 변경부터 하나씩 되돌린다
    expect(store.getState().report.page.width).toBe(100);
    expect(store.getState().report.elements[0]).toMatchObject({ value: "typed" });
  });

  it("does nothing on blur when no typed text is pending", () => {
    const { store, mountEditor, replaceReport } = setup();
    const editor = mountEditor();
    act(() => { store.getState().select(["title"]); store.getState().moveSelected(10, 0); });
    const history = store.getState().history;
    act(() => editor.blur());
    expect(replaceReport).not.toHaveBeenCalled();   // 같은 내용이면 스토어가 걸러 주지만, 편집기가 아예 커밋하지 않아야 한다
    expect(store.getState().history).toBe(history);
  });

  it("flushes text typed during the debounce before syncing a store change that lands while the editor still has focus", async () => {
    const { store, mountEditor } = setup();
    const editor = mountEditor();

    const typed = editor.getValue().replace('"value": "T"', '"value": "typed"');
    act(() => editor.type(typed));
    act(() => store.getState().updatePage({ width: 120 }));   // blur 없이 400ms가 지나기 전에 다른 곳에서 스토어가 바뀐다

    expect(editor.getValue()).toBe(typed);                     // 입력한 텍스트가 그대로 남는다
    expect(editor.cursor).toBe(7);
    expect(store.getState().report.elements[0]).toMatchObject({ value: "typed" });   // 기다리지 않고 바로 반영
    // 대가: 이 효과는 스토어 변경이 커밋된 뒤에 돌므로, 입력 텍스트(width 100)가 그 변경을 덮는다. 되돌리기로 되찾을 수 있다.
    // 포커스를 가진 편집기에서 스토어가 바뀌는 경우는 드물다(단축키는 Monaco 안에서 무시되고, 다른 곳을 누르면 blur가 먼저 커밋한다)
    expect(store.getState().report.page.width).toBe(100);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(editor.getValue()).toBe(typed);
    expect(store.getState().report.elements[0]).toMatchObject({ value: "typed" });
    expect(store.getState().report.page.width).toBe(100);
    act(() => store.getState().undo());
    expect(store.getState().report.page.width).toBe(120);
  });

  it("clears the JSON syntax error banner when store text replaces the broken editor text", async () => {
    const { store, mountEditor } = setup();
    const editor = mountEditor();

    act(() => editor.type("{ bad"));
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(screen.queryByText(/JSON 구문 오류/)).not.toBeNull();

    // 대기 중인 입력이 없고 편집기 텍스트가 깨져 있으므로 스토어 텍스트가 들어간다. 스토어 텍스트는 늘 올바른 JSON이다
    act(() => store.getState().updatePage({ width: 120 }));
    expect(JSON.parse(editor.getValue())).toMatchObject({ page: { width: 120 } });
    expect(screen.queryByText(/JSON 구문 오류/)).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByText(/JSON 구문 오류/)).toBeNull();
  });

  it("hides the schema error banner when the text is changed back to the current report or undo replaces it", async () => {
    const { store, mountEditor } = setup();
    const editor = mountEditor();
    const original = editor.getValue();

    act(() => editor.type(original.replace('"w": 50', '"w": -5')));
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(screen.queryByText(/elements\.0\.w/)).not.toBeNull();
    act(() => editor.type(original));                          // 원래 값으로 되돌린다. 모델은 바뀌지 않는다
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(screen.queryByText(/elements\.0\.w/)).toBeNull();

    act(() => store.getState().updatePage({ width: 120 }));
    act(() => editor.type(editor.getValue().replace('"w": 50', '"w": -5')));
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(screen.queryByText(/elements\.0\.w/)).not.toBeNull();
    act(() => store.getState().undo());                         // 되돌리기가 편집기 텍스트를 스토어 텍스트로 바꾼다
    expect(titleOf(editor.getValue()).w).toBe(50);
    expect(screen.queryByText(/elements\.0\.w/)).toBeNull();
  });

  it("keeps the typed text and cursor while focused when the committed report only adds defaults or reorders keys", async () => {
    const { store, mountEditor } = setup();
    const editor = mountEditor();

    // 필수 필드만 넣은 요소를 입력하고 멈춘다. 스토어 모델에는 기본값(flow, style 등)이 채워진다
    const typed = editor.getValue().replace('"value": "T"\n    }', '"value": "T"\n    }, {"id":"b","type":"rect","x":1,"y":1,"w":1,"h":1}');
    expect(typed).not.toBe(editor.getValue());
    act(() => editor.type(typed));
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(store.getState().findElement("b")).toMatchObject({ flow: "once" });
    expect(editor.getValue()).toBe(typed);            // 줄이 늘어 커서가 엉뚱한 곳에 가지 않도록 텍스트를 그대로 둔다
    expect(editor.cursor).toBe(7);
    expect(editor.lastPush).toBeNull();

    // 편집기 밖의 변경은 정리된 스토어 텍스트를 넣는다
    act(() => editor.blur());
    act(() => store.getState().updatePage({ width: 120 }));
    expect(JSON.parse(editor.getValue())).toMatchObject({ page: { width: 120 }, elements: [{ id: "title" }, { id: "b", flow: "once" }] });
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
