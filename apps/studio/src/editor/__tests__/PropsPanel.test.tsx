import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { parseReport, type ComponentProp } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { PropsPanel } from "../panels/PropsPanel";

const report = parseReport({ id: "component-hdr", version: 1, page: { width: 100, height: 20, margin: [0, 0, 0, 0] } });

function setup(props: ComponentProp[] = [], sampleProps: Record<string, unknown> = {}) {
  const store = createEditorStore(report, { componentMode: { componentId: "hdr", version: 1, props, sampleProps } });
  render(<EditorContext.Provider value={store}><PropsPanel /></EditorContext.Provider>);
  const row = (i: number) => within(screen.getByTestId(`prop-${i}`));
  const mode = () => store.getState().componentMode!;
  return { store, row, mode };
}

afterEach(cleanup);

describe("PropsPanel", () => {
  it("adds string props with unique names outside the undo history and marks the component dirty", () => {
    const { store, mode } = setup();
    fireEvent.click(screen.getByRole("button", { name: "입력값 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "입력값 추가" }));
    expect(mode().props).toEqual([{ name: "prop1", type: "string", default: "" }, { name: "prop2", type: "string", default: "" }]);
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().report).toBe(report);
    expect(store.getState().history.past).toHaveLength(0);
  });

  it("renames a prop, moves its sample value and warns about invalid or duplicate names", () => {
    const { row, mode } = setup([{ name: "a", type: "string", default: "" }, { name: "b", type: "string", default: "" }], { a: "샘플" });
    fireEvent.change(row(0).getByLabelText("이름"), { target: { value: "title" } });
    expect(mode().props[0].name).toBe("title");
    expect(mode().sampleProps).toEqual({ title: "샘플" });
    fireEvent.change(row(0).getByLabelText("이름"), { target: { value: "1bad" } });
    expect(row(0).getByText("이름은 영문자·숫자·_이며 숫자로 시작할 수 없습니다")).toBeTruthy();
    fireEvent.change(row(0).getByLabelText("이름"), { target: { value: "b" } });
    expect(row(0).getByText("이름이 겹칩니다")).toBeTruthy();
    expect(row(1).getByText("이름이 겹칩니다")).toBeTruthy();
  });

  it("changes the type with a typed default, edits default and label, and drops the stale sample", () => {
    const { row, mode } = setup([{ name: "n", type: "string", default: "x", label: "개수" }], { n: "x" });
    fireEvent.change(row(0).getByLabelText("타입"), { target: { value: "number" } });
    expect(mode().props[0]).toEqual({ name: "n", type: "number", default: 0, label: "개수" });
    expect(mode().sampleProps).toEqual({});
    fireEvent.change(row(0).getByLabelText("기본값"), { target: { value: "3" } });
    expect(mode().props[0]).toMatchObject({ default: 3 });
    fireEvent.change(row(0).getByLabelText("타입"), { target: { value: "boolean" } });
    expect(mode().props[0]).toMatchObject({ type: "boolean", default: false });
    fireEvent.click(row(0).getByLabelText("기본값"));
    expect(mode().props[0]).toMatchObject({ default: true });
    fireEvent.change(row(0).getByLabelText("타입"), { target: { value: "image" } });
    expect(mode().props[0]).toMatchObject({ type: "image", default: "" });
    fireEvent.change(row(0).getByLabelText("기본값"), { target: { value: "asset://logo" } });
    expect(mode().props[0]).toMatchObject({ default: "asset://logo" });
    fireEvent.change(row(0).getByLabelText("라벨"), { target: { value: "" } });
    expect(mode().props[0]).toEqual({ name: "n", type: "image", default: "asset://logo" });   // 빈 라벨은 지운다
  });

  it("moves props up and down, disables moves at the ends and deletes with its sample value", () => {
    const three: ComponentProp[] = [{ name: "a", type: "string", default: "" }, { name: "b", type: "number", default: 1 }, { name: "c", type: "boolean", default: true }];
    const { row, mode } = setup(three, { a: "x", b: 2 });
    expect((row(0).getByRole("button", { name: "위로" }) as HTMLButtonElement).disabled).toBe(true);
    expect((row(2).getByRole("button", { name: "아래로" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(row(0).getByRole("button", { name: "아래로" }));
    expect(mode().props.map((p) => p.name)).toEqual(["b", "a", "c"]);
    fireEvent.click(row(2).getByRole("button", { name: "위로" }));
    expect(mode().props.map((p) => p.name)).toEqual(["b", "c", "a"]);
    fireEvent.click(row(0).getByRole("button", { name: "삭제" }));
    expect(mode().props.map((p) => p.name)).toEqual(["c", "a"]);
    expect(mode().sampleProps).toEqual({ a: "x" });
  });

  it("edits sample values by type without touching the declarations, and shows defaults when unset", () => {
    const props: ComponentProp[] = [{ name: "title", type: "string", default: "기본" }, { name: "qty", type: "number", default: 1 }, { name: "show", type: "boolean", default: true }];
    const { row, mode } = setup(props, {});
    expect((row(0).getByLabelText("샘플 값") as HTMLInputElement).value).toBe("기본");
    expect((row(2).getByLabelText("샘플 값") as HTMLInputElement).checked).toBe(true);
    fireEvent.change(row(0).getByLabelText("샘플 값"), { target: { value: "샘플" } });
    fireEvent.change(row(1).getByLabelText("샘플 값"), { target: { value: "7" } });
    fireEvent.change(row(1).getByLabelText("샘플 값"), { target: { value: "" } });   // 숫자가 아니면 커밋하지 않는다
    fireEvent.click(row(2).getByLabelText("샘플 값"));
    expect(mode().sampleProps).toEqual({ title: "샘플", qty: 7, show: false });
    expect(mode().props).toEqual(props);                                             // 샘플 값은 선언을 바꾸지 않는다
  });
});
