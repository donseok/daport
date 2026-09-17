import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { FieldTree } from "../FieldTree";
import { DRAG_MIME } from "../bindings";

afterEach(cleanup);

const nodes = [
  { name: "NO", path: "NO", type: "string" as const },
  { name: "items", path: "items", type: "array" as const, children: [{ name: "QTY", path: "items.QTY", type: "number" as const }] },
];

describe("FieldTree", () => {
  it("renders nested nodes with type markers and toggles children", () => {
    const { getByText, queryByText } = render(<FieldTree dataset="orders" nodes={nodes} />);
    expect(getByText("NO")).toBeTruthy();
    expect(getByText("QTY")).toBeTruthy();                       // 첫 단계는 펼쳐져 있다
    fireEvent.click(getByText("items"));
    expect(queryByText("QTY")).toBeNull();
  });
  it("puts a DragField JSON on dragstart", () => {
    const { getByText } = render(<FieldTree dataset="orders" nodes={nodes} />);
    const data: Record<string, string> = {};
    const dataTransfer = { setData: (k: string, v: string) => { data[k] = v; }, effectAllowed: "" };
    fireEvent.dragStart(getByText("QTY"), { dataTransfer });
    expect(JSON.parse(data[DRAG_MIME])).toEqual({ dataset: "orders", path: "items.QTY", type: "number", isArray: false });
    fireEvent.dragStart(getByText("items"), { dataTransfer });
    expect(JSON.parse(data[DRAG_MIME])).toMatchObject({ path: "items", type: "array", isArray: true, children: [{ name: "QTY" }] });
    fireEvent.dragStart(getByText("orders"), { dataTransfer });                       // 루트 노드 = 데이터셋 자체
    expect(JSON.parse(data[DRAG_MIME])).toMatchObject({ dataset: "orders", path: "", type: "array", isArray: true, children: [{ name: "NO" }, { name: "items" }] });
  });
  it("shows the root with a hint when there are no fields", () => {
    const { getByText } = render(<FieldTree dataset="empty" nodes={[]} />);
    expect(getByText("empty")).toBeTruthy();
    expect(getByText(/필드 없음/)).toBeTruthy();
  });
});
