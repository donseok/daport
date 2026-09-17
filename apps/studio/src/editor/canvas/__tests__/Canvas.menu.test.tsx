import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, fireEvent, cleanup, act, screen, waitFor } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../../store";
import { Canvas } from "../Canvas";
import { COMPONENT_MODE_REASON } from "../../library/MakeComponentDialog";

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
  { id: "b", type: "rect", x: 30, y: 30, w: 10, h: 10, style: { fill: "#eeeeee" } },
  { id: "g", type: "group", x: 50, y: 50, w: 20, h: 20, children: [{ id: "c", type: "rect", x: 5, y: 5, w: 5, h: 5, style: { fill: "#eeeeee" } }] },
]});

beforeAll(() => {
  // Canvas.test.tsx와 같은 PointerEvent 대체 (jsdom 26에는 PointerEvent가 없다)
  class PointerEventStub extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventStub;
  Element.prototype.setPointerCapture = () => {};
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup(opts?: Parameters<typeof createEditorStore>[1]) {
  const store = createEditorStore(report, opts);
  const utils = render(<EditorContext.Provider value={store}><Canvas zoom={1} /></EditorContext.Provider>);
  const el = (id: string) => utils.container.querySelector(`[data-element-id="${id}"]`) as HTMLElement;
  return { store, canvas: utils.getByTestId("canvas"), el };
}
const item = () => screen.getByRole("menuitem", { name: "컴포넌트로 만들기" }) as HTMLButtonElement;
const right = (x: number, y: number) => ({ pointerId: 1, button: 2, clientX: x, clientY: y });

describe("Canvas context menu", () => {
  it("right-click selects the element under the pointer without starting a drag and opens the menu", () => {
    const { store, canvas, el } = setup();
    fireEvent.pointerDown(el("a"), right(100, 100));
    expect(store.getState().selection).toEqual(["a"]);
    fireEvent.pointerMove(canvas, right(300, 300));
    fireEvent.pointerUp(canvas, right(300, 300));
    expect(store.getState().findElement("a")).toMatchObject({ x: 10, y: 10 });   // 오른쪽 버튼은 옮기지 않는다
    expect(store.getState().history.past).toHaveLength(0);
    fireEvent.contextMenu(el("a"), { clientX: 100, clientY: 100 });
    expect(item().disabled).toBe(false);
  });

  it("keeps a multi-selection when right-clicking one of its elements", () => {
    const { store, el } = setup();
    act(() => store.getState().select(["a", "b"]));
    fireEvent.pointerDown(el("b"), right(100, 100));
    fireEvent.contextMenu(el("b"), { clientX: 100, clientY: 100 });
    expect(store.getState().selection).toEqual(["a", "b"]);
    expect(item().disabled).toBe(false);
  });

  it("disables the item with the reason as tooltip for a mixed-parent selection and in component mode", () => {
    const { store, el } = setup();
    act(() => store.getState().select(["a", "c"]));
    fireEvent.contextMenu(el("a"), { clientX: 100, clientY: 100 });
    expect(item().disabled).toBe(true);
    expect(item().title.length).toBeGreaterThan(0);
    cleanup();
    const cm = setup({ componentMode: { componentId: "x", version: 1, props: [], sampleProps: {} } });
    act(() => cm.store.getState().select(["a"]));
    fireEvent.contextMenu(cm.el("a"), { clientX: 100, clientY: 100 });
    expect(item().disabled).toBe(true);
    expect(item().title).toBe(COMPONENT_MODE_REASON);
  });

  it("opens the dialog from the menu and closes the menu on a left click or Escape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ version: 1, hash: "h" }, { status: 201 })));
    const { store, canvas, el } = setup();
    act(() => store.getState().select(["a", "b"]));
    fireEvent.contextMenu(el("a"), { clientX: 100, clientY: 100 });
    fireEvent.pointerDown(item(), { pointerId: 1, button: 0 });                     // 메뉴 안 누름은 캔버스 선택을 바꾸지 않는다
    expect(store.getState().selection).toEqual(["a", "b"]);
    fireEvent.click(item());
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: "컴포넌트 만들기" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "Pair" } });
    fireEvent.click(screen.getByRole("button", { name: "만들기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(store.getState().report.elements.some((e) => e.type === "ref" && e.ref === "pair")).toBe(true);

    fireEvent.contextMenu(canvas, { clientX: 5, clientY: 5 });
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(canvas, { clientX: 5, clientY: 5 });
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 5, clientY: 5 });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
