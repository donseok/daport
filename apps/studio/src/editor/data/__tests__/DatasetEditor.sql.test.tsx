import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { DatasetEditor } from "../DatasetEditor";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const fetchMock = (list: unknown) => { const f = vi.fn(async () => new Response(JSON.stringify(list), { status: 200 })); vi.stubGlobal("fetch", f); return f; };

describe("DatasetEditor sql", () => {
  it("lists connections, edits connection and query, shows binds and warns about params missing from the report", async () => {
    fetchMock([{ name: "mes", via: "direct" }, { name: "factory", via: "agent" }]);
    const onChange = vi.fn();
    render(<DatasetEditor dataset={{ name: "lines", type: "sql", connection: "", query: "" }} params={[{ name: "orderNo", type: "string" }]} onChange={onChange} onRemove={() => {}} />);
    const select = await screen.findByLabelText("연결") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["", "mes", "factory"]);
    fireEvent.change(select, { target: { value: "mes" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ connection: "mes" }));
    fireEvent.change(screen.getByLabelText("쿼리"), { target: { value: "SELECT * FROM T WHERE NO = :orderNo AND LOT = :lot" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ query: "SELECT * FROM T WHERE NO = :orderNo AND LOT = :lot" }));
    cleanup();
    render(<DatasetEditor dataset={{ name: "lines", type: "sql", connection: "mes", query: "SELECT * FROM T WHERE NO = :orderNo AND LOT = :lot" }} params={[{ name: "orderNo", type: "string" }]} onChange={onChange} onRemove={() => {}} />);
    expect(screen.getByTestId("binds").textContent).toContain(":orderNo");
    expect(screen.getByTestId("binds").textContent).toContain(":lot");
    expect(screen.getByTestId("binds").textContent).toContain("파라미터에 없음: lot");
  });
  it("쿼리 확인 runs the guard client-side and shows the verdict; empty connection list links to settings", async () => {
    fetchMock([]);
    render(<DatasetEditor dataset={{ name: "l", type: "sql", connection: "", query: "DELETE FROM T" }} params={[]} onChange={() => {}} onRemove={() => {}} />);
    await waitFor(() => expect(screen.getByText(/연결을 먼저 등록하세요/)).toBeTruthy());
    expect((screen.getByText(/연결을 먼저 등록하세요/).closest("a") ?? screen.getByRole("link")).getAttribute("href")).toBe("/settings/connections");
    fireEvent.click(screen.getByRole("button", { name: "쿼리 확인" }));
    expect(screen.getByTestId("guard-result").textContent).toMatch(/SELECT 또는 WITH/);
  });
});
