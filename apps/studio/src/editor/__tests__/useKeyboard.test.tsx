import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, type EditorStore } from "../store";
import { useKeyboard } from "../useKeyboard";

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
  { id: "b", type: "rect", x: 30, y: 30, w: 10, h: 10 },
]});

function Host({ store }: { store: EditorStore }) { useKeyboard(store); return <input aria-label="field" />; }

/** document.body(아무것도 포커스되지 않은 상태)에서 keydown을 발생시키고 preventDefault 여부를 돌려준다 */
function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e.defaultPrevented;
}

function setup(select: string[] = ["a"]) {
  const store = createEditorStore(report);
  store.getState().select(select);
  const utils = render(<Host store={store} />);
  return { store, ...utils };
}

afterEach(cleanup);

describe("useKeyboard", () => {
  it("nudges the selection with arrows: 0.5mm, shift 5mm, and only prevents default when something is selected", () => {
    const { store } = setup();
    expect(press("ArrowRight")).toBe(true);
    expect(store.getState().findElement("a")).toMatchObject({ x: 10.5, y: 10 });
    expect(press("ArrowDown", { shiftKey: true })).toBe(true);
    expect(store.getState().findElement("a")).toMatchObject({ x: 10.5, y: 15 });
    expect(press("ArrowLeft", { shiftKey: true })).toBe(true);
    expect(press("ArrowUp")).toBe(true);
    expect(store.getState().findElement("a")).toMatchObject({ x: 5.5, y: 14.5 });

    store.getState().select([]);
    expect(press("ArrowRight")).toBe(false);
    expect(store.getState().findElement("a")).toMatchObject({ x: 5.5, y: 14.5 });
  });

  it("undoes with cmd/ctrl+z and redoes with shift", () => {
    const { store } = setup();
    press("ArrowRight");
    expect(store.getState().findElement("a")).toMatchObject({ x: 10.5 });
    expect(press("z", { metaKey: true })).toBe(true);
    expect(store.getState().findElement("a")).toMatchObject({ x: 10 });
    expect(press("Z", { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(store.getState().findElement("a")).toMatchObject({ x: 10.5 });
    // 수식키 없는 z는 단축키가 아니다
    expect(press("z")).toBe(false);
    expect(store.getState().findElement("a")).toMatchObject({ x: 10.5 });
  });

  it("duplicates with cmd/ctrl+d and deletes with Delete/Backspace", () => {
    const { store } = setup();
    expect(press("d", { metaKey: true })).toBe(true);
    expect(store.getState().report.elements).toHaveLength(3);
    expect(store.getState().selection).toEqual(["a-1"]);

    expect(press("Delete")).toBe(true);
    expect(store.getState().findElement("a-1")).toBeUndefined();
    expect(store.getState().selection).toEqual([]);
    // 선택이 없으면 Backspace는 아무것도 하지 않고 기본 동작도 막지 않는다
    expect(press("Backspace")).toBe(false);
    expect(store.getState().report.elements).toHaveLength(2);

    store.getState().select(["b"]);
    expect(press("Backspace")).toBe(true);
    expect(store.getState().findElement("b")).toBeUndefined();
  });

  it("ignores keys typed inside form controls", () => {
    const { store, getByLabelText } = setup();
    const input = getByLabelText("field");
    expect(press("ArrowRight", {}, input)).toBe(false);
    expect(press("Delete", {}, input)).toBe(false);
    expect(press("z", { metaKey: true }, input)).toBe(false);
    expect(store.getState().findElement("a")).toMatchObject({ x: 10 });
    expect(store.getState().report.elements).toHaveLength(2);
  });

  it("tolerates a keydown whose target is not an element (window)", () => {
    const { store } = setup();
    const onError = vi.fn();
    window.addEventListener("error", onError);
    press("ArrowRight", {}, window);
    window.removeEventListener("error", onError);
    expect(onError).not.toHaveBeenCalled();
    expect(store.getState().findElement("a")).toMatchObject({ x: 10 });
  });

  it("removes the listener on unmount", () => {
    const { store, unmount } = setup();
    unmount();
    press("ArrowRight");
    expect(store.getState().findElement("a")).toMatchObject({ x: 10 });
  });
});
