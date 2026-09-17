import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { parseReport, parseComponentBody } from "@daport/core";
import { createEditorStore, EditorContext } from "../../store";
import { Canvas } from "../Canvas";
import { mmToPxScaled } from "../snap";

const body = parseComponentBody({ name: "헤더", w: 40, h: 10, props: [{ name: "title", type: "string", default: "제목" }], elements: [
  { id: "t", type: "text", x: 2, y: 2, w: 30, h: 5, value: "{{ props.title }}" },
  { id: "frame", type: "rect", x: 0, y: 0, w: 40, h: 10, style: { stroke: "#000", strokeWidth: 0.3 } },
]});
const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, components: { "hdr@1": body }, elements: [
  { id: "hdr-1", type: "ref", ref: "hdr", version: 1, x: 10, y: 10, w: 40, h: 10, props: { title: "A" } },
  { id: "hdr-2", type: "ref", ref: "hdr", version: 1, x: 10, y: 40, w: 40, h: 10, props: { title: "B" } },
  { id: "a", type: "text", x: 60, y: 70, w: 20, h: 5, value: "A" },
]});

const px = (mm: number) => mmToPxScaled(mm, 1);
const ptr = (clientX: number, clientY: number, extra: Record<string, unknown> = {}) => ({ pointerId: 1, clientX, clientY, ...extra });

function setup() {
  const store = createEditorStore(report);
  const utils = render(<EditorContext.Provider value={store}><Canvas zoom={1} /></EditorContext.Provider>);
  const q = (sel: string) => utils.container.querySelector(sel) as HTMLElement;
  const canvas = utils.getByTestId("canvas");
  const boxes = () => Array.from(utils.container.querySelectorAll<HTMLElement>(".border-blue-500.pointer-events-none"))
    .map((d) => [d.style.left, d.style.top, d.style.width, d.style.height]);
  const handle = (h: string) => utils.container.querySelector(`[data-handle="${h}"]`);
  return { store, q, canvas, boxes, handle, ...utils };
}

beforeAll(() => {
  class PointerEventStub extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventStub;
  Element.prototype.setPointerCapture = () => {};
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Canvas component instances", () => {
  it("draws each instance with its own props under the instance id", () => {
    const { q } = setup();
    expect(q('[data-element-id="hdr-1"][data-instance="hdr-1/t"]').textContent).toBe("A");
    expect(q('[data-element-id="hdr-2"][data-instance="hdr-2/t"]').textContent).toBe("B");
    expect(q('[data-element-id="hdr-1"][data-role="refBox"]')).not.toBeNull();
  });
  it("selects the instance from a child or its empty area, boxes the refBox and shows no resize handles", () => {
    const { store, q, canvas, boxes, handle } = setup();
    fireEvent.pointerDown(q('[data-element-id="hdr-1"][data-instance="hdr-1/t"]'), ptr(px(15), px(14)));
    fireEvent.pointerUp(canvas, ptr(px(15), px(14)));
    expect(store.getState().selection).toEqual(["hdr-1"]);
    expect(boxes()).toEqual([["10mm", "10mm", "40mm", "10mm"]]);
    expect(handle("se")).toBeNull();

    fireEvent.pointerDown(q('[data-element-id="hdr-2"][data-role="refBox"]'), ptr(px(45), px(48)));
    fireEvent.pointerUp(canvas, ptr(px(45), px(48)));
    expect(store.getState().selection).toEqual(["hdr-2"]);
    expect(boxes()).toEqual([["10mm", "40mm", "40mm", "10mm"]]);
    expect(handle("se")).toBeNull();

    act(() => store.getState().select(["a"]));
    expect(handle("se")).not.toBeNull();                                           // 일반 요소는 그대로 핸들이 있다
  });
  it("picks the instance even when the topmost node is a hollow frame inside the component", () => {
    const { store, q } = setup();
    const stack = vi.fn<(x: number, y: number) => Element[]>();
    Object.defineProperty(document, "elementsFromPoint", { value: stack, configurable: true });   // jsdom에는 없다
    try {
      stack.mockReturnValue([q('[data-element-id="hdr-1"][data-instance="hdr-1/frame"]'), q('[data-element-id="hdr-1"][data-role="refBox"]'), q(".dp-page")]);
      fireEvent.pointerDown(q('[data-element-id="hdr-1"][data-instance="hdr-1/frame"]'), ptr(px(35), px(18)));   // 틀의 선에서 먼 안쪽
      expect(store.getState().selection).toEqual(["hdr-1"]);
    } finally {
      delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    }
  });
  it("moves the whole instance as one undo step without changing its size", () => {
    const { store, q, canvas, boxes } = setup();
    fireEvent.pointerDown(q('[data-element-id="hdr-1"][data-instance="hdr-1/t"]'), ptr(0, 0));
    fireEvent.pointerMove(canvas, ptr(px(5.2), px(2)));
    expect(boxes()).toEqual([["15mm", "12mm", "40mm", "10mm"]]);                     // 고스트
    fireEvent.pointerUp(canvas, ptr(px(5.2), px(2)));
    expect(store.getState().findElement("hdr-1")).toMatchObject({ x: 15, y: 12, w: 40, h: 10 });
    expect(store.getState().findElement("hdr-2")).toMatchObject({ x: 10, y: 40 });
    expect(store.getState().history.past).toHaveLength(1);
    expect(q('[data-element-id="hdr-1"][data-instance="hdr-1/t"]').style.left).toBe("17mm");   // 자식도 함께 옮겨 그린다
  });
  it("opens the component editor in a new tab on double-click of an instance only", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { q } = setup();
    fireEvent.doubleClick(q('[data-element-id="hdr-2"][data-instance="hdr-2/t"]'), { clientX: px(15), clientY: px(44) });
    expect(open).toHaveBeenCalledWith("/components/hdr", "_blank", "noopener");
    fireEvent.doubleClick(q('[data-element-id="a"]'), { clientX: px(65), clientY: px(72) });
    fireEvent.doubleClick(q(".dp-page"), { clientX: px(90), clientY: px(90) });
    expect(open).toHaveBeenCalledTimes(1);
  });
});
