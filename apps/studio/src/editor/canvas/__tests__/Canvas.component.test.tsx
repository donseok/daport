import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { parseReport, parseComponentBody } from "@daport/core";
import { createEditorStore, EditorContext, type EditorStore } from "../../store";
import { Canvas } from "../Canvas";
import { mmToPxScaled } from "../snap";
import { COMPONENT_MIME } from "../../library/api";
import { DRAG_MIME } from "../../data/bindings";

const body = parseComponentBody({ name: "헤더", w: 40, h: 10, props: [{ name: "title", type: "string", default: "제목" }],
  elements: [{ id: "t", type: "text", x: 0, y: 0, w: 40, h: 10, value: "{{ props.title }}" }] });
const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "a", type: "text", x: 10, y: 60, w: 20, h: 5, value: "A" },
]});
const detail = { summary: { id: "hdr", name: "헤더", latestVersion: 3, w: 40, h: 10, updatedAt: "2026-09-17T00:00:00.000Z" }, versions: [], latest: body };
const px = (mm: number) => mmToPxScaled(mm, 1);
const dt = (mime: string, value: string) => ({ types: [mime], getData: (k: string) => (k === mime ? value : ""), dropEffect: "copy" });

function mount(store: EditorStore) {
  const utils = render(<EditorContext.Provider value={store}><Canvas zoom={1} /></EditorContext.Provider>);
  return { ...utils, q: (sel: string) => utils.container.querySelector(sel) as HTMLElement };
}
function stubFetch(response: () => Response) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => response());
  vi.stubGlobal("fetch", fn);
  return fn;
}

// Canvas.drop.test.tsx와 같은 이유로 DragEvent 대역을 둔다 (jsdom에는 DragEvent가 없어 clientX/clientY가 사라진다)
beforeAll(() => {
  Element.prototype.setPointerCapture = () => {};
  class DragEventStub extends MouseEvent { constructor(type: string, init: MouseEventInit = {}) { super(type, init); } }
  (window as unknown as { DragEvent: unknown }).DragEvent = DragEventStub;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Canvas component drop", () => {
  it("accepts the component mime on dragover", () => {
    const { q } = mount(createEditorStore(report));
    expect(fireEvent.dragOver(q(".dp-page"), { dataTransfer: dt(COMPONENT_MIME, "") })).toBe(false);   // preventDefault = 놓기 허용
    expect(fireEvent.dragOver(q(".dp-page"), { dataTransfer: { types: ["text/plain"], getData: () => "" } })).toBe(true);
  });
  it("fetches the latest version and inserts a ref at the snapped drop point as one undo step", async () => {
    const fetchMock = stubFetch(() => new Response(JSON.stringify(detail), { status: 200 }));
    const store = createEditorStore(report);
    const { q } = mount(store);
    fireEvent.drop(q(".dp-page"), { clientX: px(20.3), clientY: px(10.2), dataTransfer: dt(COMPONENT_MIME, "hdr") });
    await waitFor(() => expect(store.getState().findElement("hdr-1")).toBeDefined());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/components/hdr");
    expect(store.getState().findElement("hdr-1")).toMatchObject({ type: "ref", ref: "hdr", version: 3, x: 20.5, y: 10, w: 40, h: 10, flow: "once", props: {} });
    expect(store.getState().report.components).toEqual({ "hdr@3": body });
    expect(store.getState().history.past).toHaveLength(1);
    expect(q('[data-testid="drop-warning"]')).toBeNull();
  });
  it("shows the server error and leaves the report unchanged when the component cannot be fetched", async () => {
    stubFetch(() => new Response(JSON.stringify({ error: "component not found: nope" }), { status: 404 }));
    const store = createEditorStore(report);
    const { findByTestId, q } = mount(store);
    fireEvent.drop(q(".dp-page"), { clientX: px(20), clientY: px(10), dataTransfer: dt(COMPONENT_MIME, "nope") });
    expect((await findByTestId("drop-warning")).textContent).toBe("컴포넌트를 넣지 못했습니다: component not found: nope");
    expect(store.getState().report.elements.map((e) => e.id)).toEqual(["a"]);
    expect(store.getState().history.past).toHaveLength(0);
  });
  it("refuses component drops in component mode but still accepts data fields", async () => {
    const fetchMock = stubFetch(() => new Response(JSON.stringify(detail), { status: 200 }));
    const store = createEditorStore(report, { componentMode: { componentId: "sig", version: 1, props: [], sampleProps: {} } });
    const { q, findByTestId } = mount(store);
    expect(fireEvent.dragOver(q(".dp-page"), { dataTransfer: dt(COMPONENT_MIME, "") })).toBe(true);
    expect(fireEvent.dragOver(q(".dp-page"), { dataTransfer: dt(DRAG_MIME, "") })).toBe(false);
    fireEvent.drop(q(".dp-page"), { clientX: px(20), clientY: px(10), dataTransfer: dt(COMPONENT_MIME, "hdr") });
    expect((await findByTestId("drop-warning")).textContent).toBe("컴포넌트 안에는 컴포넌트를 넣을 수 없습니다");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.getState().report.elements.map((e) => e.id)).toEqual(["a"]);
  });
});
