import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext, type EditorStore } from "../../store";
import { Canvas } from "../Canvas";
import { mmToPxScaled } from "../snap";

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
  { id: "b", type: "rect", x: 30, y: 30, w: 10, h: 10 },
  { id: "g", type: "group", x: 50, y: 50, w: 20, h: 20, children: [{ id: "c", type: "rect", x: 5, y: 5, w: 5, h: 5 }] },
]});

function mount(store: EditorStore, ui: React.ReactNode) {
  return render(<EditorContext.Provider value={store}>{ui}</EditorContext.Provider>);
}

function setup(zoom = 1) {
  const store = createEditorStore(report);
  const utils = mount(store, <Canvas zoom={zoom} />);
  const canvas = utils.getByTestId("canvas");
  const el = (id: string) => utils.container.querySelector(`[data-element-id="${id}"]`) as HTMLElement;
  const handle = (h: string) => utils.container.querySelector(`[data-handle="${h}"]`) as HTMLElement | null;
  const boxes = () => Array.from(utils.container.querySelectorAll<HTMLElement>(".border-blue-500.pointer-events-none")).map((d) => d.style.left);
  return { store, canvas, el, handle, boxes, ...utils };
}

/** zoom=1에서 mm를 화면 px로 (드래그 델타를 mm 단위로 쓰기 위한 도우미) */
const px = (mm: number, zoom = 1) => mmToPxScaled(mm, zoom);
const ptr = (clientX: number, clientY: number, extra: Record<string, unknown> = {}) => ({ pointerId: 1, clientX, clientY, ...extra });

beforeAll(() => {
  // jsdom 26에는 PointerEvent와 setPointerCapture가 없다. PointerEvent가 없으면 testing-library가 plain Event로
  // 대체해 clientX/shiftKey가 사라지므로 MouseEvent 기반으로 정의한다.
  class PointerEventStub extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventStub;
  Element.prototype.setPointerCapture = () => {};
});

afterEach(cleanup);

describe("Canvas", () => {
  it("selects on pointerdown, shows a live ghost during the drag, and commits the snapped move on pointerup", () => {
    const { store, canvas, el, boxes } = setup();
    expect(boxes()).toEqual([]);

    fireEvent.pointerDown(el("a"), ptr(100, 100));
    expect(store.getState().selection).toEqual(["a"]);
    expect(boxes()).toEqual(["10mm"]);

    fireEvent.pointerMove(canvas, ptr(100 + px(10.2), 100));
    expect(boxes()).toEqual(["20mm"]);                                          // 10.2 → 0.5mm 그리드 스냅 → +10
    expect(store.getState().findElement("a")).toMatchObject({ x: 10, y: 10 });  // 아직 커밋 전
    expect(store.getState().history.past).toHaveLength(0);

    fireEvent.pointerUp(canvas, ptr(100 + px(10.2), 100));
    expect(store.getState().findElement("a")).toMatchObject({ x: 20, y: 10, w: 20, h: 5 });
    expect(store.getState().history.past).toHaveLength(1);
    expect(boxes()).toEqual(["20mm"]);
  });

  it("does not create a history entry for a click without movement", () => {
    const { store, canvas, el } = setup();
    fireEvent.pointerDown(el("a"), ptr(100, 100));
    fireEvent.pointerUp(canvas, ptr(100, 100));
    expect(store.getState().history.past).toHaveLength(0);
  });

  it("resizes with the se handle and moves the opposite edge with the nw handle", () => {
    const { store, canvas, handle } = setup();
    act(() => store.getState().select(["a"]));
    expect(handle("se")).not.toBeNull();

    fireEvent.pointerDown(handle("se")!, ptr(0, 0));
    fireEvent.pointerMove(canvas, ptr(px(5), px(2.5)));
    fireEvent.pointerUp(canvas, ptr(px(5), px(2.5)));
    expect(store.getState().findElement("a")).toMatchObject({ x: 10, y: 10, w: 25, h: 7.5 });
    expect(store.getState().selection).toEqual(["a"]);                          // 핸들 클릭은 선택을 바꾸지 않는다

    fireEvent.pointerDown(handle("nw")!, ptr(0, 0));
    fireEvent.pointerMove(canvas, ptr(px(-5), px(-2)));
    fireEvent.pointerUp(canvas, ptr(px(-5), px(-2)));
    expect(store.getState().findElement("a")).toMatchObject({ x: 5, y: 8, w: 30, h: 9.5 });
    expect(store.getState().history.past).toHaveLength(2);
  });

  it("shift-click toggles multi-selection, hides handles, and a drag moves all as one history entry", () => {
    const { store, canvas, el, handle, boxes } = setup();
    fireEvent.pointerDown(el("a"), ptr(0, 0));
    fireEvent.pointerUp(canvas, ptr(0, 0));
    expect(handle("se")).not.toBeNull();

    fireEvent.pointerDown(el("b"), ptr(0, 0, { shiftKey: true }));
    fireEvent.pointerUp(canvas, ptr(0, 0));
    expect(store.getState().selection).toEqual(["a", "b"]);
    expect(handle("se")).toBeNull();
    expect(boxes()).toEqual(["10mm", "30mm"]);

    // 이미 선택된 요소를 끌면 선택 전체가 함께 움직인다
    fireEvent.pointerDown(el("a"), ptr(0, 0));
    fireEvent.pointerMove(canvas, ptr(px(10), px(5)));
    expect(boxes()).toEqual(["20mm", "40mm"]);
    fireEvent.pointerUp(canvas, ptr(px(10), px(5)));
    expect(store.getState().findElement("a")).toMatchObject({ x: 20, y: 15 });
    expect(store.getState().findElement("b")).toMatchObject({ x: 40, y: 35 });
    expect(store.getState().selection).toEqual(["a", "b"]);
    expect(store.getState().history.past).toHaveLength(1);                      // 한 제스처 = 한 번의 undo

    // shift-click으로 다시 빼기
    fireEvent.pointerDown(el("b"), ptr(0, 0, { shiftKey: true }));
    expect(store.getState().selection).toEqual(["a"]);
  });

  it("keeps a group child's offset relative to its group", () => {
    const { store, canvas, el, boxes } = setup();
    fireEvent.pointerDown(el("c"), ptr(0, 0));
    expect(boxes()).toEqual(["55mm"]);                                          // layout 절대좌표 (50+5)
    fireEvent.pointerMove(canvas, ptr(px(10), 0));
    fireEvent.pointerUp(canvas, ptr(px(10), 0));
    expect(store.getState().findElement("c")).toMatchObject({ x: 15, y: 5 });   // 그룹 기준 상대좌표 유지
    expect(store.getState().findElement("g")).toMatchObject({ x: 50, y: 50 });
    expect(boxes()).toEqual(["65mm"]);
  });

  it("clears the selection when clicking empty page area", () => {
    const { store, canvas, boxes } = setup();
    act(() => store.getState().select(["a", "b"]));
    expect(boxes()).toHaveLength(2);
    fireEvent.pointerDown(canvas.querySelector(".dp-page")!, ptr(0, 0));
    expect(store.getState().selection).toEqual([]);
    expect(boxes()).toEqual([]);
    fireEvent.pointerMove(canvas, ptr(px(10), 0));
    fireEvent.pointerUp(canvas, ptr(px(10), 0));
    expect(store.getState().history.past).toHaveLength(0);
  });

  it("divides the pointer delta by zoom", () => {
    const { store, canvas, el } = setup(2);
    fireEvent.pointerDown(el("a"), ptr(0, 0));
    fireEvent.pointerMove(canvas, ptr(px(10, 1), 0));                             // zoom 2에서 같은 px는 5mm
    fireEvent.pointerUp(canvas, ptr(px(10, 1), 0));
    expect(store.getState().findElement("a")).toMatchObject({ x: 15, y: 10 });
  });

  it("picks the element under a hollow rect unless the pointer is on the rect's stroke", () => {
    // 품질보증서의 info-box처럼 채우기 없는 틀이 셀들보다 나중에 그려져 DOM 맨 위에 있는 경우
    const store = createEditorStore(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
      { id: "cell", type: "text", x: 10, y: 10, w: 40, h: 10, value: "V" },
      { id: "frame", type: "rect", x: 5, y: 5, w: 50, h: 20, style: { stroke: "#000", strokeWidth: 0.3 } },
    ]}));
    const utils = mount(store, <Canvas zoom={1} />);
    const node = (id: string) => utils.container.querySelector(`[data-element-id="${id}"]`) as HTMLElement;
    const pageNode = utils.container.querySelector(".dp-page") as HTMLElement;
    const stack = vi.fn<(x: number, y: number) => Element[]>();
    Object.defineProperty(document, "elementsFromPoint", { value: stack, configurable: true });   // jsdom에는 없다
    try {
      // 틀 안쪽(셀 위) → 셀
      stack.mockReturnValue([node("frame"), node("cell").firstElementChild!, node("cell"), pageNode]);
      fireEvent.pointerDown(node("frame"), ptr(px(20), px(15)));
      fireEvent.pointerUp(node("frame"), ptr(px(20), px(15)));
      expect(stack).toHaveBeenLastCalledWith(px(20), px(15));
      expect(store.getState().selection).toEqual(["cell"]);

      // 틀의 선 위 → 틀
      stack.mockReturnValue([node("frame"), pageNode]);
      fireEvent.pointerDown(node("frame"), ptr(px(5.2), px(15)));
      fireEvent.pointerUp(node("frame"), ptr(px(5.2), px(15)));
      expect(store.getState().selection).toEqual(["frame"]);

      // 틀 안쪽의 빈 곳 → 선택 해제
      fireEvent.pointerDown(node("frame"), ptr(px(30), px(22)));
      expect(store.getState().selection).toEqual([]);
    } finally {
      delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    }
  });

  it("rewrites asset:// image sources like preview and PDF do", () => {
    const store = createEditorStore(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
      { id: "stamp", type: "image", x: 0, y: 0, w: 10, h: 10, src: "asset://stamp" },
      { id: "logo", type: "image", x: 20, y: 0, w: 10, h: 10, src: "https://example.com/logo.png" },
    ]}));
    const { container } = mount(store, <Canvas zoom={1} />);
    expect(container.querySelector('[data-element-id="stamp"]')!.getAttribute("src")).toBe("/api/assets/stamp");
    expect(container.querySelector('[data-element-id="logo"]')!.getAttribute("src")).toBe("https://example.com/logo.png");
  });

  it("shows #ERR for a broken expression even when the report fails on expression errors", () => {
    // 스펙 10: 디자이너는 요소마다 #ERR을 보이고, onExpressionError는 미리보기·PDF 렌더만 따른다
    const store = createEditorStore(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, onExpressionError: "fail", elements: [
      { id: "broken", type: "text", x: 0, y: 0, w: 30, h: 5, value: "{{ cert..X }}" },
      { id: "ok", type: "text", x: 0, y: 10, w: 30, h: 5, value: "fine" },
    ]}));
    const { container } = mount(store, <Canvas zoom={1} />);
    expect(container.querySelector('[data-element-id="broken"]')!.textContent).toBe("#ERR");
    expect(container.querySelector('[data-element-id="ok"]')!.textContent).toBe("fine");
  });

  it("lets a flat line keep zero height or width when dragging a handle, so it does not tilt", () => {
    const store = createEditorStore(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
      { id: "h", type: "line", x: 10, y: 80, w: 50, h: 0, x2: 60, y2: 80 },
      { id: "v", type: "line", x: 90, y: 10, w: 0, h: 40, x2: 90, y2: 50 },
    ]}));
    const { container, getByTestId } = mount(store, <Canvas zoom={1} />);
    const canvas = getByTestId("canvas");
    const handle = (h: string) => container.querySelector(`[data-handle="${h}"]`) as HTMLElement;
    const drag = (h: string, dx: number, dy: number) => {
      fireEvent.pointerDown(handle(h), ptr(0, 0));
      fireEvent.pointerMove(canvas, ptr(dx, dy));
      fireEvent.pointerUp(canvas, ptr(dx, dy));
    };
    act(() => store.getState().select(["h"]));
    drag("n", 0, px(0.1));                  // 스냅하면 0mm
    drag("s", 0, px(-3));
    drag("n", 0, px(3));
    expect(store.getState().findElement("h")).toMatchObject({ x: 10, y: 80, w: 50, h: 0, x2: 60, y2: 80 });
    act(() => store.getState().select(["v"]));
    drag("e", px(-3), 0);
    drag("w", px(3), 0);
    expect(store.getState().findElement("v")).toMatchObject({ x: 90, y: 10, w: 0, h: 40, x2: 90, y2: 50 });
    expect(store.getState().history.past).toHaveLength(0);
  });

  it("places a line's selection box on its bounding box, so right-to-left and grouped lines move and resize in place", () => {
    const store = createEditorStore(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
      { id: "rl", type: "line", x: 60, y: 30, w: 50, h: 10, x2: 10, y2: 20 },
      { id: "g", type: "group", x: 50, y: 50, w: 20, h: 20, children: [{ id: "gl", type: "line", x: 20, y: 10, w: 15, h: 10, x2: 5, y2: 0 }] },
    ]}));
    const { container, getByTestId } = mount(store, <Canvas zoom={1} />);
    const canvas = getByTestId("canvas");
    const node = (id: string) => container.querySelector(`[data-element-id="${id}"]`) as HTMLElement;
    const handle = (h: string) => container.querySelector(`[data-handle="${h}"]`) as HTMLElement;
    const box = () => {
      const d = container.querySelector<HTMLElement>(".border-blue-500.pointer-events-none")!;
      return [d.style.left, d.style.top, d.style.width, d.style.height];
    };
    const drag = (target: HTMLElement, dx: number, dy: number) => {
      fireEvent.pointerDown(target, ptr(0, 0));
      fireEvent.pointerMove(canvas, ptr(dx, dy));
      fireEvent.pointerUp(canvas, ptr(dx, dy));
    };

    fireEvent.pointerDown(node("rl"), ptr(0, 0));
    expect(store.getState().selection).toEqual(["rl"]);
    expect(box()).toEqual(["10mm", "20mm", "50mm", "10mm"]);                     // 왼쪽 = min(x, x2)
    fireEvent.pointerMove(canvas, ptr(px(5), 0));
    expect(box()).toEqual(["15mm", "20mm", "50mm", "10mm"]);                     // 고스트도 상자에서 출발한다
    fireEvent.pointerUp(canvas, ptr(px(5), 0));
    expect(store.getState().findElement("rl")).toMatchObject({ x: 65, y: 30, x2: 15, y2: 20, w: 50, h: 10 });

    drag(handle("e"), px(10), 0);                                                   // 오른쪽 변 = 시작점
    expect(store.getState().findElement("rl")).toMatchObject({ x: 75, y: 30, x2: 15, y2: 20, w: 60, h: 10 });
    expect(box()).toEqual(["15mm", "20mm", "60mm", "10mm"]);

    act(() => store.getState().select(["gl"]));
    expect(box()).toEqual(["55mm", "50mm", "15mm", "10mm"]);                     // 그룹 자식은 절대좌표 상자
    drag(handle("w"), px(-5), 0);
    expect(store.getState().findElement("gl")).toMatchObject({ x: 20, y: 10, x2: 0, y2: 0, w: 20, h: 10 });
    expect(box()).toEqual(["50mm", "50mm", "20mm", "10mm"]);
  });

  it("discards the drag on pointercancel without committing", () => {
    const { store, canvas, el, boxes } = setup();
    fireEvent.pointerDown(el("a"), ptr(0, 0));
    fireEvent.pointerMove(canvas, ptr(px(10), 0));
    expect(boxes()).toEqual(["20mm"]);
    fireEvent.pointerCancel(canvas, ptr(px(10), 0));
    expect(boxes()).toEqual(["10mm"]);                                          // 고스트 제거
    fireEvent.pointerUp(canvas, ptr(px(10), 0));                                  // 취소 뒤의 pointerup은 아무것도 커밋하지 않는다
    expect(store.getState().findElement("a")).toMatchObject({ x: 10, y: 10 });
    expect(store.getState().history.past).toHaveLength(0);
  });
});
