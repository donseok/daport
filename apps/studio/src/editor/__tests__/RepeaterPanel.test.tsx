import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { parseReport, type RepeaterElement } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { PropertyPanel } from "../panels/PropertyPanel";

afterEach(cleanup);

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "cards", type: "repeater", x: 5, y: 20, w: 90, h: 60, source: "lots", item: { w: 30, h: 20, children: [] } },
]});

function setup() {
  const store = createEditorStore(report);
  store.getState().select(["cards"]);
  const utils = render(<EditorContext.Provider value={store}><PropertyPanel /></EditorContext.Provider>);
  return { store, rep: () => store.getState().findElement("cards") as RepeaterElement, ...utils };
}

describe("RepeaterPanel", () => {
  it("edits source, layout, gap, item size and overflow", () => {
    const { getByLabelText, rep } = setup();
    fireEvent.change(getByLabelText("소스"), { target: { value: "orders" } });
    fireEvent.change(getByLabelText("배치"), { target: { value: "grid" } });
    fireEvent.change(getByLabelText("가로 간격"), { target: { value: "2" } });
    fireEvent.change(getByLabelText("세로 간격"), { target: { value: "3" } });
    fireEvent.change(getByLabelText("항목 너비"), { target: { value: "40" } });
    fireEvent.change(getByLabelText("항목 높이"), { target: { value: "25" } });
    fireEvent.change(getByLabelText("넘침"), { target: { value: "clip" } });
    expect(rep()).toMatchObject({ source: "orders", layout: "grid", gap: [2, 3], item: { w: 40, h: 25 }, overflow: "clip" });
  });
  it("adds and edits groups with header/footer band heights and removes them", () => {
    const { getByRole, getByLabelText, rep } = setup();
    fireEvent.click(getByRole("button", { name: "+ 그룹" }));
    expect(rep().groups).toEqual([{ by: "item.", header: { h: 8, children: [] } }]);
    fireEvent.change(getByLabelText("그룹 기준"), { target: { value: "item.LINE" } });
    fireEvent.change(getByLabelText("머리 높이"), { target: { value: "10" } });
    expect(rep().groups[0]).toMatchObject({ by: "item.LINE", header: { h: 10 } });
    fireEvent.click(getByLabelText("소계 사용"));
    expect(rep().groups[0].footer).toEqual({ h: 6, children: [] });
    fireEvent.click(getByLabelText("머리 사용"));
    expect(rep().groups[0].header).toBeUndefined();
    fireEvent.click(getByRole("button", { name: "그룹 삭제" }));
    expect(rep().groups).toEqual([]);
  });
  it("does not commit an empty or whitespace source/group-by, but commits a real value", () => {
    const { getByLabelText, getByRole, rep } = setup();
    fireEvent.change(getByLabelText("소스"), { target: { value: "" } });
    expect(rep().source).toBe("lots");
    fireEvent.change(getByLabelText("소스"), { target: { value: "   " } });
    expect(rep().source).toBe("lots");
    fireEvent.change(getByLabelText("소스"), { target: { value: "orders" } });
    expect(rep().source).toBe("orders");

    fireEvent.click(getByRole("button", { name: "+ 그룹" }));
    fireEvent.change(getByLabelText("그룹 기준"), { target: { value: "" } });
    expect(rep().groups[0].by).toBe("item.");
    fireEvent.change(getByLabelText("그룹 기준"), { target: { value: "   " } });
    expect(rep().groups[0].by).toBe("item.");
    fireEvent.change(getByLabelText("그룹 기준"), { target: { value: "item.LINE" } });
    expect(rep().groups[0].by).toBe("item.LINE");
  });
});
