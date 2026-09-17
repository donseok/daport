import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../../store";
import { Canvas } from "../Canvas";
import { PageSelector } from "../../PageSelector";

const report = parseReport({ id: "component-hdr", version: 1, page: { width: 100, height: 20, margin: [0, 0, 0, 0] },
  elements: [{ id: "t", type: "text", x: 0, y: 0, w: 60, h: 8, value: "제목: {{ props.title }}" }] });
const props = [{ name: "title", type: "string" as const, default: "기본" }];

afterEach(cleanup);

describe("Canvas in component mode", () => {
  it("draws with the sample props and redraws when they change", () => {
    const store = createEditorStore(report, { componentMode: { componentId: "hdr", version: 1, props, sampleProps: { title: "샘플" } } });
    const { getByTestId } = render(<EditorContext.Provider value={store}><Canvas zoom={1} /><PageSelector /></EditorContext.Provider>);
    expect(getByTestId("canvas").textContent).toContain("제목: 샘플");
    act(() => store.getState().setSampleProps({}));
    expect(getByTestId("canvas").textContent).toContain("제목: 기본");               // 샘플이 없으면 기본값
    act(() => store.getState().setComponentProps([{ name: "title", type: "string", default: "새 기본" }]));
    expect(getByTestId("canvas").textContent).toContain("제목: 새 기본");
    expect(getByTestId("page-indicator").textContent).toBe("1 / 1");
  });
});
