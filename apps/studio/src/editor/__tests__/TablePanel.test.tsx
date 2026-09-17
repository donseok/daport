import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { parseReport, type TableElement } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { PropertyPanel } from "../panels/PropertyPanel";

afterEach(cleanup);

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "t", type: "table", x: 5, y: 20, w: 60, h: 30, source: "items", columns: [{ header: "A", value: "{{ row.A }}", w: 30 }, { header: "B", value: "{{ row.B }}", w: 30 }] },
]});

function setup() {
  const store = createEditorStore(report);
  store.getState().select(["t"]);
  const utils = render(<EditorContext.Provider value={store}><PropertyPanel /></EditorContext.Provider>);
  const table = () => store.getState().findElement("t") as TableElement;
  return { store, table, ...utils };
}

describe("TablePanel", () => {
  it("edits source, heights, repeatHeader and border", () => {
    const { getByLabelText, table } = setup();
    fireEvent.change(getByLabelText("소스"), { target: { value: "record.items" } });
    expect(table().source).toBe("record.items");
    fireEvent.change(getByLabelText("행 높이"), { target: { value: "8" } });
    fireEvent.change(getByLabelText("머리 높이"), { target: { value: "9" } });
    expect(table()).toMatchObject({ rowHeight: 8, headerHeight: 9 });
    fireEvent.click(getByLabelText("머리 반복"));
    expect(table().repeatHeader).toBe(false);
    fireEvent.change(getByLabelText("테두리"), { target: { value: "rows" } });
    expect(table().border).toBe("rows");
  });
  it("adds, edits, reorders and removes columns", () => {
    const { getByRole, getAllByRole, getAllByLabelText, table } = setup();
    fireEvent.click(getByRole("button", { name: "+ 열" }));
    expect(table().columns).toHaveLength(3);
    expect(table().columns[2]).toMatchObject({ header: "열 3", value: "", w: 30 });
    fireEvent.change(getAllByLabelText("머리글")[2], { target: { value: "C" } });
    fireEvent.change(getAllByLabelText("값")[2], { target: { value: "{{ row.C }}" } });
    fireEvent.change(getAllByLabelText("너비")[2], { target: { value: "20" } });
    fireEvent.change(getAllByLabelText("정렬")[2], { target: { value: "right" } });
    expect(table().columns[2]).toMatchObject({ header: "C", value: "{{ row.C }}", w: 20, align: "right" });
    fireEvent.click(getAllByRole("button", { name: "▲" })[2]);
    expect(table().columns.map((c) => c.header)).toEqual(["A", "C", "B"]);
    fireEvent.click(getAllByRole("button", { name: "▼" })[0]);
    expect(table().columns.map((c) => c.header)).toEqual(["C", "A", "B"]);
    fireEvent.click(getAllByRole("button", { name: "✕" })[0]);
    expect(table().columns.map((c) => c.header)).toEqual(["A", "B"]);
  });
  it("adds a group with header/footer cells, a page footer and a table footer", () => {
    const { getByRole, getAllByLabelText, getByLabelText, table } = setup();
    fireEvent.click(getByRole("button", { name: "+ 그룹" }));
    expect(table().groups).toEqual([{ by: "row.", header: [{ value: "{{ group.key }}", span: "all" }], footer: [], keepHeaderWithRows: true }]);
    fireEvent.change(getByLabelText("그룹 기준"), { target: { value: "row.CAT" } });
    expect(table().groups[0].by).toBe("row.CAT");
    fireEvent.click(getByRole("button", { name: "+ 소계 셀" }));
    expect(table().groups[0].footer).toEqual([{ value: "", span: 1 }]);
    fireEvent.change(getAllByLabelText("셀 값")[1], { target: { value: "소계 {{ sum(group.rows, 'Q') }}" } });
    fireEvent.change(getAllByLabelText("span")[1], { target: { value: "all" } });
    expect(table().groups[0].footer[0]).toEqual({ value: "소계 {{ sum(group.rows, 'Q') }}", span: "all" });
    fireEvent.click(getByRole("button", { name: "+ 페이지 소계 셀" }));
    fireEvent.click(getByRole("button", { name: "+ 합계 셀" }));
    expect(table().pageFooter).toHaveLength(1);
    expect(table().footer).toHaveLength(1);
    fireEvent.click(getByRole("button", { name: "그룹 삭제" }));
    expect(table().groups).toEqual([]);
  });
  it("does not commit an empty source or group key (schema requires min 1)", () => {
    const { getByLabelText, getByRole, table } = setup();
    fireEvent.change(getByLabelText("소스"), { target: { value: "" } });
    expect(table().source).toBe("items");
    fireEvent.change(getByLabelText("소스"), { target: { value: "record.items" } });
    expect(table().source).toBe("record.items");
    fireEvent.click(getByRole("button", { name: "+ 그룹" }));
    fireEvent.change(getByLabelText("그룹 기준"), { target: { value: "   " } });
    expect(table().groups[0].by).toBe("row.");
  });
});
