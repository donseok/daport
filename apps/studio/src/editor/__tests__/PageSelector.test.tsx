import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { PageSelector } from "../PageSelector";

afterEach(cleanup);
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ N: i }));
const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100, margin: [5, 5, 5, 5] }, repeat: { source: "ships" },
  datasets: [{ name: "ships", type: "static", rows: [{ items: rows(20) }, { items: rows(1) }] }], elements: [
  { id: "t", type: "table", x: 5, y: 20, w: 60, h: 30, source: "record.items", columns: [{ header: "N", value: "{{ row.N }}", w: 30 }] },
]});

describe("PageSelector", () => {
  it("shows page/copy indicators and moves within limits", () => {
    const store = createEditorStore(report);
    const { getByTestId, getByRole } = render(<EditorContext.Provider value={store}><PageSelector /></EditorContext.Provider>);
    expect(getByTestId("page-indicator").textContent).toBe("1 / 3");
    expect(getByTestId("copy-indicator").textContent).toBe("1 / 2");
    expect((getByRole("button", { name: "이전 페이지" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(getByRole("button", { name: "다음 페이지" }));
    fireEvent.click(getByRole("button", { name: "다음 페이지" }));
    expect(store.getState().view).toEqual({ copyIndex: 0, pageInCopy: 2 });
    expect((getByRole("button", { name: "다음 페이지" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(getByRole("button", { name: "다음 부" }));
    expect(store.getState().view).toEqual({ copyIndex: 1, pageInCopy: 0 });
    expect(getByTestId("page-indicator").textContent).toBe("1 / 1");
    expect((getByRole("button", { name: "다음 부" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => store.getState().setRepeat(undefined));
    expect(getByTestId("page-indicator").textContent).toBe("1 / 1");                    // record가 없으면 record.items는 빈 배열 → 1장
  });
});
