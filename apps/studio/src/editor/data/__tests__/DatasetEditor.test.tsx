import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { DatasetEditor } from "../DatasetEditor";

afterEach(cleanup);

describe("DatasetEditor", () => {
  it("static: commits valid JSON object arrays and shows an error otherwise", () => {
    const onChange = vi.fn();
    const { getByLabelText, getByText, queryByText } = render(<DatasetEditor dataset={{ name: "s", type: "static", rows: [{ A: 1 }] }} onChange={onChange} onRemove={() => {}} />);
    const ta = getByLabelText("행(JSON)") as HTMLTextAreaElement;
    expect(ta.value).toContain('"A": 1');
    fireEvent.change(ta, { target: { value: "[{\"A\": 2}]" } });
    expect(onChange).toHaveBeenLastCalledWith({ name: "s", type: "static", rows: [{ A: 2 }] });
    fireEvent.change(ta, { target: { value: "[1]" } });
    expect(getByText(/객체 배열/)).toBeTruthy();
    fireEvent.change(ta, { target: { value: "{" } });
    // 라벨 '행(JSON)'과 겹치지 않게 오류 문구로 찾는다
    expect(getByText(/구문 오류/)).toBeTruthy();
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.change(getByLabelText("이름"), { target: { value: "s2" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: "s2" }));
    expect(queryByText("커넥터 미설정")).toBeNull();
  });
  it("http: edits method, url, headers (Key: value lines), body only for POST, rowsPath", () => {
    const onChange = vi.fn();
    const ds = { name: "o", type: "http" as const, method: "GET" as const, url: "https://x", headers: { A: "1" } };
    const { getByLabelText, queryByLabelText, rerender } = render(<DatasetEditor dataset={ds} onChange={onChange} onRemove={() => {}} />);
    expect((getByLabelText("헤더") as HTMLTextAreaElement).value).toBe("A: 1");
    expect(queryByLabelText("본문")).toBeNull();
    fireEvent.change(getByLabelText("method"), { target: { value: "POST" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...ds, method: "POST" });
    rerender(<DatasetEditor dataset={{ ...ds, method: "POST" }} onChange={onChange} onRemove={() => {}} />);
    fireEvent.change(getByLabelText("본문"), { target: { value: "{}" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...ds, method: "POST", body: "{}" });
    fireEvent.change(getByLabelText("헤더"), { target: { value: "Authorization: Bearer {{ secrets.T }}\nX: y" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ headers: { Authorization: "Bearer {{ secrets.T }}", X: "y" } }));
    fireEvent.change(getByLabelText("rowsPath"), { target: { value: "data.items" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ rowsPath: "data.items" }));
  });
  it("sql: read-only notice, remove button calls onRemove", () => {
    const onRemove = vi.fn();
    const { getByText, getByRole } = render(<DatasetEditor dataset={{ name: "q", type: "sql", connection: "mes", query: "SELECT 1" }} onChange={() => {}} onRemove={onRemove} />);
    expect(getByText(/커넥터 미설정/)).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "삭제" }));
    expect(onRemove).toHaveBeenCalled();
  });
});
