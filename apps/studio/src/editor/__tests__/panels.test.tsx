import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { parseReport, ElementSchema, type Element } from "@daport/core";
import { createEditorStore, EditorContext, type EditorStore } from "../store";
import { ElementPalette } from "../panels/ElementPalette";
import { PagePanel } from "../panels/PagePanel";

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
]});

function mount(store: EditorStore, ui: React.ReactNode) {
  return render(<EditorContext.Provider value={store}>{ui}</EditorContext.Provider>);
}

afterEach(cleanup);

describe("ElementPalette", () => {
  it("allocates sequential ids per type and selects the new element", () => {
    const store = createEditorStore(report);
    mount(store, <ElementPalette />);
    fireEvent.click(screen.getByText("+ 텍스트"));
    fireEvent.click(screen.getByText("+ 텍스트"));
    fireEvent.click(screen.getByText("+ 페이지번호"));
    const ids = store.getState().report.elements.map((e) => e.id);
    expect(ids).toEqual(["a", "text-1", "text-2", "pn-1"]);
    expect(store.getState().selection).toEqual(["pn-1"]);
    expect(store.getState().findElement("pn-1")).toMatchObject({ type: "pageNumber", flow: "every" });
  });

  it("skips ids that already exist, including inside groups", () => {
    const store = createEditorStore(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
      { id: "rect-1", type: "rect", x: 0, y: 0, w: 1, h: 1 },
      { id: "g", type: "group", x: 0, y: 0, w: 1, h: 1, children: [{ id: "rect-2", type: "rect", x: 0, y: 0, w: 1, h: 1 }] },
    ]}));
    mount(store, <ElementPalette />);
    fireEvent.click(screen.getByText("+ 사각형"));
    expect(store.getState().selection).toEqual(["rect-3"]);
  });

  it("creates elements that already satisfy the core schema defaults", () => {
    const store = createEditorStore(report);
    mount(store, <ElementPalette />);
    for (const label of ["+ 텍스트", "+ 이미지", "+ 선", "+ 사각형", "+ 페이지번호"]) fireEvent.click(screen.getByText(label));
    for (const el of store.getState().report.elements) expect(ElementSchema.parse(el)).toEqual(el);
    expect(store.getState().findElement("line-1")).toMatchObject({ x2: 60, y2: 10, style: { stroke: "#000" } });
  });
});

describe("PagePanel presets", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))); });
  afterEach(() => vi.unstubAllGlobals());

  it("shows custom for an unknown size, applies a builtin preset (page + output) and returns to custom", async () => {
    const store = createEditorStore(report);
    mount(store, <PagePanel />);
    const select = () => screen.getByLabelText("프리셋") as HTMLSelectElement;
    expect(select().value).toBe("custom");
    fireEvent.change(select(), { target: { value: "coil-tag-100x150" } });
    expect(store.getState().report.page).toMatchObject({ width: 100, height: 150 });
    expect(store.getState().report.output.kind).toBe("label");
    expect(select().value).toBe("coil-tag-100x150");
    fireEvent.change(screen.getByLabelText("너비(mm)"), { target: { value: "99" } });
    expect(select().value).toBe("custom");
  });
  it("lists user presets from the API, saves the current settings as a preset and deletes it", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let list = [{ id: "my-tag", name: "내 Tag", page: { width: 80, height: 50, margin: [1, 1, 1, 1], unit: "mm" }, output: { kind: "pdf" }, builtin: false }];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "POST") { list = [...list, { ...JSON.parse(String(init.body)), builtin: false, output: { kind: "pdf" } }]; return new Response(JSON.stringify(list.at(-1)), { status: 201 }); }
      if (init?.method === "DELETE") { list = list.filter((p) => !url.endsWith(p.id)); return new Response(null, { status: 204 }); }
      return new Response(JSON.stringify(list), { status: 200 });
    }));
    const store = createEditorStore(report);
    mount(store, <PagePanel />);
    await waitFor(() => expect(screen.getByRole("option", { name: "내 Tag" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("프리셋"), { target: { value: "my-tag" } });
    expect(store.getState().report.page).toMatchObject({ width: 80, height: 50, margin: [1, 1, 1, 1] });
    fireEvent.click(screen.getByRole("button", { name: "프리셋 삭제" }));
    await waitFor(() => expect(screen.queryByRole("option", { name: "내 Tag" })).toBeNull());
    fireEvent.change(screen.getByLabelText("새 프리셋 id"), { target: { value: "saved-one" } });
    fireEvent.change(screen.getByLabelText("새 프리셋 이름"), { target: { value: "저장한 것" } });
    fireEvent.click(screen.getByRole("button", { name: "프리셋으로 저장" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "저장한 것" })).toBeTruthy());
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(JSON.parse(String(post.init!.body))).toMatchObject({ id: "saved-one", name: "저장한 것", page: { width: 80, height: 50 } });
  });
  it("groups builtin and user presets under separate optgroups", async () => {
    const preset = { id: "my-tag", name: "내 Tag", page: { width: 80, height: 50, margin: [1, 1, 1, 1], unit: "mm" }, output: { kind: "pdf" }, builtin: false };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([preset]), { status: 200 })));
    const store = createEditorStore(report);
    mount(store, <PagePanel />);
    await waitFor(() => expect(screen.getByRole("option", { name: "내 Tag" })).toBeTruthy());
    const select = screen.getByLabelText("프리셋") as HTMLSelectElement;
    const groups = Array.from(select.querySelectorAll("optgroup"));
    expect(groups.map((g) => g.label)).toEqual(["내장", "사용자 정의"]);
    expect(within(groups[0]).getByRole("option", { name: "A4 세로" })).toBeTruthy();
    expect(within(groups[1]).getByRole("option", { name: "내 Tag" })).toBeTruthy();
  });
  it("detects the current preset even when darkness/speed appear in a different key order after patch merging", async () => {
    const preset = {
      id: "tag-label", name: "라벨 태그",
      page: { width: 100, height: 100, margin: [10, 10, 10, 10], unit: "mm" },
      output: { kind: "label", label: { language: "zpl", dpi: 203, threshold: 128, darkness: 10, speed: 4, copies: 1 } },
      builtin: false,
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([preset]), { status: 200 })));
    const store = createEditorStore(report);
    mount(store, <PagePanel />);
    await waitFor(() => expect(screen.getByRole("option", { name: "라벨 태그" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("프리셋"), { target: { value: "tag-label" } });
    expect((screen.getByLabelText("프리셋") as HTMLSelectElement).value).toBe("tag-label");
    // OutputPanel의 { ...(label ?? DEFAULT_LABEL), ...patch } 병합처럼 필드 순서가 달라져도
    // (darkness/speed 값 자체는 그대로) 여전히 같은 프리셋으로 인식돼야 한다
    store.getState().setOutput({ kind: "label", label: { language: "zpl", dpi: 203, threshold: 128, copies: 1, speed: 4, darkness: 10 } });
    expect((screen.getByLabelText("프리셋") as HTMLSelectElement).value).toBe("tag-label");
  });
  it("shows an error when the initial preset list fails to load, but keeps builtin presets usable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    const store = createEditorStore(report);
    mount(store, <PagePanel />);
    await waitFor(() => expect(screen.getByText("프리셋 목록을 불러오지 못했습니다")).toBeTruthy());
    expect(screen.getByRole("option", { name: "A4 세로" })).toBeTruthy();
  });
});

describe("PagePanel size guards", () => {
  it("ignores empty or non-positive size input instead of committing it", () => {
    const store = createEditorStore(report);
    mount(store, <PagePanel />);
    const before = store.getState().history.past.length;
    fireEvent.change(screen.getByLabelText("너비(mm)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("너비(mm)"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("높이(mm)"), { target: { value: "-5" } });
    expect(store.getState().report.page).toMatchObject({ width: 100, height: 100 });
    expect(store.getState().history.past.length).toBe(before);
  });
});

describe("palette (phase 2)", () => {
  it("adds a table and a repeater with a default template child", () => {
    const store = createEditorStore(report);
    const { getByRole } = render(<EditorContext.Provider value={store}><ElementPalette /></EditorContext.Provider>);
    fireEvent.click(getByRole("button", { name: "+ 표" }));
    // 스키마(min 1)를 만족하는 기본 소스 — 데이터셋이 없으면 "items"
    expect(store.getState().findElement("table-1")).toMatchObject({ type: "table", source: "items", columns: [{ header: "열 1" }] });
    fireEvent.click(getByRole("button", { name: "+ 반복 영역" }));
    const rep = store.getState().findElement("repeater-1") as Extract<Element, { type: "repeater" }>;
    expect(rep).toMatchObject({ type: "repeater", source: "items", layout: "list", item: { w: 60, h: 20 } });
    expect(rep.item.children[0]).toMatchObject({ type: "text", value: "항목 {{ index + 1 }}" });
    expect(store.getState().selection).toEqual(["repeater-1"]);
  });
  it("uses the first dataset's name as the default source when one exists", () => {
    const withDataset = parseReport({ id: "r2", version: 1, page: { width: 100, height: 100 },
      datasets: [{ name: "lots", type: "static", rows: [{ NAME: "L1" }] }], elements: [] });
    const store = createEditorStore(withDataset);
    const { getByRole } = render(<EditorContext.Provider value={store}><ElementPalette /></EditorContext.Provider>);
    fireEvent.click(getByRole("button", { name: "+ 반복 영역" }));
    expect(store.getState().findElement("repeater-1")).toMatchObject({ type: "repeater", source: "lots" });
  });
  it("adds into the selected repeater's template", () => {
    const store = createEditorStore(report);
    const { getByRole } = render(<EditorContext.Provider value={store}><ElementPalette /></EditorContext.Provider>);
    fireEvent.click(getByRole("button", { name: "+ 반복 영역" }));
    fireEvent.click(getByRole("button", { name: "+ 사각형" }));
    const rep = store.getState().findElement("repeater-1") as Extract<Element, { type: "repeater" }>;
    expect(rep.item.children.map((c) => c.id)).toEqual(["text-1", "rect-1"]);
    store.getState().select(["rect-1"]);                                       // 템플릿 자식이 선택돼도 같은 템플릿에
    fireEvent.click(getByRole("button", { name: "+ 텍스트" }));
    expect((store.getState().findElement("repeater-1") as Extract<Element, { type: "repeater" }>).item.children.map((c) => c.id)).toEqual(["text-1", "rect-1", "text-2"]);
  });
});

describe("palette (phase 3)", () => {
  it("adds a code128 barcode with a sample value", () => {
    const store = createEditorStore(report);
    render(<EditorContext.Provider value={store}><ElementPalette /></EditorContext.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "+ 바코드" }));
    expect(store.getState().findElement("barcode-1")).toMatchObject({ type: "barcode", format: "code128", value: "123456", showText: true, w: 40, h: 15 });
  });
});

describe("page panel repeat switch", () => {
  it("toggles repeat with a source expression", () => {
    const store = createEditorStore(report);
    const { getByLabelText } = render(<EditorContext.Provider value={store}><PagePanel /></EditorContext.Provider>);
    fireEvent.click(getByLabelText("레코드마다 한 부씩"));
    // 스키마(min 1)를 만족하는 기본 소스 — 데이터셋이 없으면 "items"
    expect(store.getState().report.repeat).toEqual({ source: "items", as: "record" });
    fireEvent.change(getByLabelText("반복 소스"), { target: { value: "shipments" } });
    expect(store.getState().report.repeat).toEqual({ source: "shipments", as: "record" });
    fireEvent.click(getByLabelText("레코드마다 한 부씩"));
    expect(store.getState().report.repeat).toBeUndefined();
  });

  it("ignores an empty or blank source instead of committing it (RepeatSchema.source는 min 1)", () => {
    const store = createEditorStore(report);
    const { getByLabelText } = render(<EditorContext.Provider value={store}><PagePanel /></EditorContext.Provider>);
    fireEvent.click(getByLabelText("레코드마다 한 부씩"));
    expect(store.getState().report.repeat).toEqual({ source: "items", as: "record" });
    fireEvent.change(getByLabelText("반복 소스"), { target: { value: "" } });
    expect(store.getState().report.repeat).toEqual({ source: "items", as: "record" });
    fireEvent.change(getByLabelText("반복 소스"), { target: { value: "  " } });
    expect(store.getState().report.repeat).toEqual({ source: "items", as: "record" });
    fireEvent.change(getByLabelText("반복 소스"), { target: { value: "shipments" } });
    expect(store.getState().report.repeat).toEqual({ source: "shipments", as: "record" });
  });
});
