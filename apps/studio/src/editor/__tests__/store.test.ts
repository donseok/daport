import { describe, it, expect, beforeEach } from "vitest";
import { parseReport, ElementSchema, extractComponent, parseComponentBody, type Element, type ComponentBody } from "@daport/core";
import { createEditorStore } from "../store";

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
  { id: "g", type: "group", x: 50, y: 50, w: 20, h: 20, children: [{ id: "b", type: "rect", x: 1, y: 1, w: 5, h: 5 }] },
]});

describe("editor store", () => {
  let store: ReturnType<typeof createEditorStore>;
  beforeEach(() => { store = createEditorStore(report); });

  it("selects and moves elements with undo", () => {
    store.getState().select(["a"]);
    store.getState().moveSelected(5, -2);
    expect(store.getState().findElement("a")).toMatchObject({ x: 15, y: 8 });
    store.getState().undo();
    expect(store.getState().findElement("a")).toMatchObject({ x: 10, y: 10 });
  });
  it("updates a nested element by id", () => {
    store.getState().updateElement("b", { w: 9 });
    expect(store.getState().findElement("b")).toMatchObject({ w: 9 });
  });
  it("adds, duplicates and deletes", () => {
    store.getState().addElement(ElementSchema.parse({ id: "n", type: "rect", x: 0, y: 0, w: 1, h: 1 }));
    expect(store.getState().findElement("n")).toBeTruthy();
    store.getState().select(["n"]);
    store.getState().duplicateSelected();
    expect(store.getState().report.elements).toHaveLength(4);
    expect(store.getState().selection).toHaveLength(1);
    expect(store.getState().selection[0]).not.toBe("n");
    store.getState().deleteSelected();
    expect(store.getState().report.elements).toHaveLength(3);
  });
  it("duplicates a group child inside its group, right after the original, offset in group coordinates", () => {
    store.getState().select(["b"]);
    store.getState().duplicateSelected();
    const g = store.getState().findElement("g") as Extract<Element, { type: "group" }>;
    expect(g.children.map((c) => c.id)).toEqual(["b", "b-1"]);
    expect(g.children[1]).toMatchObject({ type: "rect", x: 6, y: 6, w: 5, h: 5 });
    expect(store.getState().report.elements.map((e) => e.id)).toEqual(["a", "g"]);
    expect(store.getState().selection).toEqual(["b-1"]);
    store.getState().undo();
    expect(g.children).toHaveLength(2);                                             // 이전 스냅샷은 그대로
    expect((store.getState().findElement("g") as typeof g).children.map((c) => c.id)).toEqual(["b"]);
  });
  it("gives a duplicated group's children fresh ids and moves a line's end point with it", () => {
    const s = createEditorStore(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
      { id: "g", type: "group", x: 50, y: 50, w: 20, h: 20, children: [{ id: "b", type: "rect", x: 1, y: 1, w: 5, h: 5 }] },
      { id: "l", type: "line", x: 10, y: 40, w: 30, h: 0, x2: 40, y2: 40 },
    ]}));
    s.getState().select(["g", "l"]);
    s.getState().duplicateSelected();
    expect(s.getState().report.elements.map((e) => e.id)).toEqual(["g", "g-1", "l", "l-1"]);
    expect((s.getState().findElement("g-1") as Extract<Element, { type: "group" }>).children.map((c) => c.id)).toEqual(["b-1"]);
    expect(s.getState().findElement("l-1")).toMatchObject({ x: 15, y: 45, x2: 45, y2: 45 });
    expect(s.getState().selection).toEqual(["g-1", "l-1"]);
    expect(s.getState().replaceReport(JSON.parse(JSON.stringify(s.getState().report)))).toBe(true);   // 중복 id 없음
  });
  it("rejects a JSON edit that changes the report id", () => {
    expect(store.getState().replaceReport({ ...report, id: "quality-cert" })).toBe(false);
    expect(store.getState().problems).toEqual([{ path: "id", message: "id는 바꿀 수 없습니다" }]);
    expect(store.getState().report.id).toBe("r");
    expect(store.getState().history.past).toHaveLength(0);
  });
  it("clearing an optional field leaves no dead undo step when the JSON editor echoes the model back", () => {
    store.getState().updateElement("a", { visible: "{{ true }}" });
    store.getState().updateElement("a", { visible: undefined });
    const past = store.getState().history.past.length;
    expect(store.getState().replaceReport(JSON.parse(JSON.stringify(store.getState().report)))).toBe(true);
    expect(store.getState().history.past).toHaveLength(past);
  });
  it("undo/redo with nothing to do keep the report clean", () => {
    store.getState().undo();
    store.getState().redo();
    expect(store.getState().dirty).toBe(false);
  });
  it("undo drops selected ids that no longer exist", () => {
    store.getState().addElement(ElementSchema.parse({ id: "n", type: "rect", x: 0, y: 0, w: 1, h: 1 }));
    expect(store.getState().selection).toEqual(["n"]);
    store.getState().undo();
    expect(store.getState().selection).toEqual([]);
  });
  it("replaces whole report from JSON text and reports validation errors", () => {
    const ok = store.getState().replaceReport({ ...report, name: "new" });
    expect(ok).toBe(true);
    expect(store.getState().report.name).toBe("new");
    const bad = store.getState().replaceReport({ ...report, elements: [{ id: "z", type: "nope" }] } as any);
    expect(bad).toBe(false);
    expect(store.getState().problems.length).toBeGreaterThan(0);
    expect(store.getState().report.name).toBe("new");   // 마지막 유효 모델 유지
  });
  it("clears problems when valid JSON identical to the current report replaces invalid input", () => {
    // 편집기에서 잘못 고친 값을 원래대로 되돌리면 모델은 그대로지만 오류 배너는 사라져야 한다
    const same = JSON.parse(JSON.stringify(store.getState().report));
    const invalid = JSON.parse(JSON.stringify(same)); invalid.elements[0].w = -5;
    expect(store.getState().replaceReport(invalid)).toBe(false);
    expect(store.getState().problems.length).toBeGreaterThan(0);
    const history = store.getState().history;
    expect(store.getState().replaceReport(same)).toBe(true);
    expect(store.getState().problems).toEqual([]);
    expect(store.getState().history).toBe(history);   // 같은 내용이면 히스토리는 그대로
    // id를 바꿨다가 되돌린 경우도 같다
    expect(store.getState().replaceReport({ ...same, id: "other" })).toBe(false);
    expect(store.getState().problems).toEqual([{ path: "id", message: "id는 바꿀 수 없습니다" }]);
    expect(store.getState().replaceReport(same)).toBe(true);
    expect(store.getState().problems).toEqual([]);
  });
  it("clears problems on undo and redo, which replace the editor text with store text", () => {
    store.getState().updatePage({ width: 50 });
    expect(store.getState().replaceReport({ ...report, elements: [{ id: "z", type: "nope" }] })).toBe(false);
    expect(store.getState().problems.length).toBeGreaterThan(0);
    store.getState().undo();
    expect(store.getState().problems).toEqual([]);
    expect(store.getState().replaceReport({ ...report, elements: [{ id: "z", type: "nope" }] })).toBe(false);
    store.getState().redo();
    expect(store.getState().report.page.width).toBe(50);
    expect(store.getState().problems).toEqual([]);
  });
  it("updates page size", () => {
    store.getState().updatePage({ width: 297, height: 210 });
    expect(store.getState().report.page).toMatchObject({ width: 297, height: 210 });
  });
  it("marks dirty after change and clean after markSaved", () => {
    expect(store.getState().dirty).toBe(false);
    store.getState().updatePage({ width: 50 });
    expect(store.getState().dirty).toBe(true);
    store.getState().markSaved(store.getState().report);
    expect(store.getState().dirty).toBe(false);
  });
  it("stays dirty when the model changed after the saved snapshot was taken", () => {
    store.getState().updatePage({ width: 50 });
    const saved = store.getState().report;           // 저장 요청에 실린 모델
    store.getState().updatePage({ width: 60 });      // 요청이 끝나기 전의 편집
    store.getState().markSaved(saved);
    expect(store.getState().dirty).toBe(true);
  });
});

describe("editor store: line bounding box", () => {
  type Line = Extract<Element, { type: "line" }>;
  const lines = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
    { id: "l", type: "line", x: 10, y: 20, w: 50, h: 0, x2: 60, y2: 20 },
    { id: "g", type: "group", x: 50, y: 50, w: 20, h: 20, children: [{ id: "gl", type: "line", x: 0, y: 0, w: 10, h: 0, x2: 10, y2: 0 }] },
  ]});
  const line = (s: ReturnType<typeof createEditorStore>, id: string) => s.getState().findElement(id) as Line;

  it("recomputes w/h from the end points when X2 or Y2 is edited", () => {
    const s = createEditorStore(lines);
    s.getState().updateElement("l", { x2: 30.123 });
    expect(line(s, "l")).toMatchObject({ x: 10, x2: 30.123, w: 20.12, h: 0 });
    s.getState().updateElement("l", { y2: 5 });
    expect(line(s, "l")).toMatchObject({ y: 20, y2: 5, w: 20.12, h: 15 });
    s.getState().updateElement("gl", { x2: -4, y2: 6 });                         // 그룹 안의 선
    expect(line(s, "gl")).toMatchObject({ w: 4, h: 6 });
  });

  it("recomputes w/h for lines added, moved or replaced from JSON", () => {
    const s = createEditorStore(lines);
    s.getState().addElement(ElementSchema.parse({ id: "n", type: "line", x: 0, y: 0, w: 99, h: 99, x2: 10, y2: 5 }));
    expect(line(s, "n")).toMatchObject({ w: 10, h: 5 });
    s.getState().moveSelected(2.5, 1);
    expect(line(s, "n")).toMatchObject({ x: 2.5, y: 1, x2: 12.5, y2: 6, w: 10, h: 5 });
    const json = JSON.parse(JSON.stringify(s.getState().report));
    json.elements[0].x2 = 0;                                                      // JSON 편집기에서 끝점만 고친다
    expect(s.getState().replaceReport(json)).toBe(true);
    expect(line(s, "l")).toMatchObject({ x: 10, x2: 0, w: 10, h: 0 });
  });

  it("resizes a right-to-left, bottom-to-top line by mapping both end points onto the new box", () => {
    const s = createEditorStore(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
      { id: "rl", type: "line", x: 60, y: 40, w: 50, h: 20, x2: 10, y2: 20 },    // 상자 (10, 20, 50×20)
    ]}));
    s.getState().resizeElement("rl", { x: 10, y: 20, w: 80, h: 20 });            // e 핸들: 오른쪽 변만 +30
    expect(line(s, "rl")).toMatchObject({ x: 90, y: 40, x2: 10, y2: 20, w: 80, h: 20 });
    s.getState().resizeElement("rl", { x: 5, y: 10, w: 85, h: 30 });             // nw 핸들: 왼쪽·위 변을 옮긴다
    expect(line(s, "rl")).toMatchObject({ x: 90, y: 40, x2: 5, y2: 10, w: 85, h: 30 });
    const l = line(s, "rl");
    expect(l.x).toBeGreaterThan(l.x2);
    expect(l.y).toBeGreaterThan(l.y2);
  });

  it("keeps a flat line flat and in place when its box gains the missing dimension", () => {
    const s = createEditorStore(lines);
    s.getState().resizeElement("l", { x: 10, y: 20, w: 50, h: 3 });              // 가로선의 s 핸들을 아래로
    s.getState().resizeElement("l", { x: 10, y: 17, w: 50, h: 3 });              // n 핸들을 위로
    expect(line(s, "l")).toMatchObject({ x: 10, y: 20, x2: 60, y2: 20, w: 50, h: 0 });
    expect(s.getState().history.past).toHaveLength(0);
  });
});

describe("editor store (phase 2)", () => {
  const rep = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, datasets: [{ name: "lots", type: "static", rows: [{ NAME: "L1" }] }], elements: [
    { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
    { id: "cards", type: "repeater", x: 0, y: 20, w: 100, h: 80, source: "lots", item: { w: 50, h: 20, children: [{ id: "nm", type: "text", x: 1, y: 1, w: 20, h: 5, value: "{{ item.NAME }}" }] },
      groups: [{ by: "item.LINE", header: { h: 5, children: [{ id: "gh", type: "rect", x: 0, y: 0, w: 5, h: 5 }] } }] },
  ]});
  let store: ReturnType<typeof createEditorStore>;
  beforeEach(() => { store = createEditorStore(rep); });

  it("finds and updates template children, and reports their parent repeater", () => {
    expect(store.getState().findElement("nm")).toMatchObject({ type: "text" });
    store.getState().updateElement("nm", { w: 30 });
    expect(store.getState().findElement("nm")).toMatchObject({ w: 30 });
    expect(store.getState().findParentRepeater("nm")).toBe("cards");
    expect(store.getState().findParentRepeater("gh")).toBe("cards");
    expect(store.getState().findParentRepeater("a")).toBeUndefined();
    expect(store.getState().allocateId("nm")).toBe("nm-1");
  });
  it("adds into a repeater band, deletes and duplicates template children with fresh ids", () => {
    const el = ElementSchema.parse({ id: "n2", type: "rect", x: 0, y: 0, w: 1, h: 1 });
    store.getState().addElement(el, { into: { repeaterId: "cards", band: "item" } });
    const cards = () => store.getState().findElement("cards") as Extract<Element, { type: "repeater" }>;
    expect(cards().item.children.map((c) => c.id)).toEqual(["nm", "n2"]);
    store.getState().addElement(ElementSchema.parse({ id: "n3", type: "rect", x: 0, y: 0, w: 1, h: 1 }), { into: { repeaterId: "cards", band: "groupHeader", groupIndex: 0 } });
    expect(cards().groups[0].header?.children.map((c) => c.id)).toEqual(["gh", "n3"]);
    store.getState().select(["nm"]);
    store.getState().duplicateSelected();
    expect(cards().item.children.map((c) => c.id)).toEqual(["nm", "nm-1", "n2"]);
    store.getState().select(["nm-1", "n3"]);
    store.getState().deleteSelected();
    expect(cards().item.children.map((c) => c.id)).toEqual(["nm", "n2"]);
    expect(cards().groups[0].header?.children.map((c) => c.id)).toEqual(["gh"]);
    store.getState().select(["cards"]);
    store.getState().duplicateSelected();
    const copy = store.getState().findElement("cards-1") as Extract<Element, { type: "repeater" }>;
    expect(copy.item.children.map((c) => c.id)).toEqual(["nm-1", "n2-1"]);
    expect(store.getState().replaceReport(JSON.parse(JSON.stringify(store.getState().report)))).toBe(true);
  });
  it("sets sample, datasets, params and repeat as undoable edits", () => {
    store.getState().setSample({ params: { no: "A" }, data: { lots: [{ NAME: "S" }] }, capturedAt: "2026-09-17T00:00:00.000Z" });
    expect(store.getState().report.sample?.data).toEqual({ lots: [{ NAME: "S" }] });
    expect(store.getState().dirty).toBe(true);
    store.getState().setRepeat({ source: "lots", as: "record" });
    expect(store.getState().report.repeat).toEqual({ source: "lots", as: "record" });
    store.getState().setRepeat(undefined);
    expect(store.getState().report.repeat).toBeUndefined();
    store.getState().setDatasets([...store.getState().report.datasets, { name: "o", type: "http", url: "https://x", method: "GET", headers: {} }]);
    expect(store.getState().report.datasets).toHaveLength(2);
    store.getState().setParams([{ name: "no", type: "string", required: true }]);
    expect(store.getState().report.params[0].name).toBe("no");
    store.getState().undo(); store.getState().undo(); store.getState().undo(); store.getState().undo();
    expect(store.getState().report.sample?.params).toEqual({ no: "A" });
    store.getState().undo();
    expect(store.getState().report.sample).toBeUndefined();
  });
  it("keeps view and liveData outside history", () => {
    expect(store.getState().view).toEqual({ copyIndex: 0, pageInCopy: 0 });
    store.getState().setView({ pageInCopy: 2 });
    expect(store.getState().view).toEqual({ copyIndex: 0, pageInCopy: 2 });
    store.getState().setLiveData(true);
    expect(store.getState().liveData).toBe(true);
    expect(store.getState().dirty).toBe(false);
    store.getState().undo();
    expect(store.getState().view.pageInCopy).toBe(2);
  });
});

describe("editor store (phase 3)", () => {
  const rep = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 } });
  it("setOutput is undoable and applyPreset changes page and output in one step", () => {
    const store = createEditorStore(rep);
    store.getState().setOutput({ kind: "label", label: { language: "tspl", dpi: 300, threshold: 100, copies: 2 } });
    expect(store.getState().report.output).toMatchObject({ kind: "label", label: { language: "tspl", dpi: 300 } });
    store.getState().applyPreset({ id: "p", name: "P", builtin: false, page: { width: 60, height: 40, margin: [2, 2, 2, 2], unit: "mm" }, output: { kind: "label", label: { language: "zpl", dpi: 203, threshold: 128, copies: 1 } } });
    expect(store.getState().report.page).toMatchObject({ width: 60, height: 40, margin: [2, 2, 2, 2] });
    expect(store.getState().report.output).toMatchObject({ kind: "label", label: { language: "zpl" } });
    store.getState().undo();
    expect(store.getState().report.page.width).toBe(100);
    expect(store.getState().report.output).toMatchObject({ kind: "label", label: { language: "tspl" } });
    store.getState().undo();
    expect(store.getState().report.output).toEqual({ kind: "pdf" });
  });
  it("keeps bitmapPreview outside history", () => {
    const store = createEditorStore(rep);
    store.getState().setBitmapPreview(true);
    expect(store.getState().bitmapPreview).toBe(true);
    expect(store.getState().dirty).toBe(false);
  });
});

describe("editor store (phase 3b: components)", () => {
  const hdr: ComponentBody = { name: "헤더", w: 60, h: 20, props: [{ name: "title", type: "string", default: "제목" }, { name: "sub", type: "string", default: "" }],
    elements: [ElementSchema.parse({ id: "t", type: "text", x: 0, y: 0, w: 60, h: 10, value: "{{ props.title }}" })] };
  const hdrV2: ComponentBody = { ...hdr, h: 25, props: [{ name: "title", type: "string", default: "제목" }] };
  const rep = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
    { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
    { id: "l", type: "line", x: 50, y: 30, w: 20, h: 0, x2: 30, y2: 30 },   // w/h를 끝점과 맞춰 둔다(apply가 다시 계산하므로 원래 레포트와 비교가 깨지지 않게)
    { id: "g", type: "group", x: 50, y: 50, w: 20, h: 20, children: [{ id: "b", type: "rect", x: 1, y: 1, w: 5, h: 5 }] },
  ]});
  const refOf = (s: ReturnType<typeof createEditorStore>, id: string) => s.getState().findElement(id) as Extract<Element, { type: "ref" }>;

  it("componentMode is null by default and set from options; props are dirty edits outside history, sample props are not dirty", () => {
    const plain = createEditorStore(rep);
    expect(plain.getState().componentMode).toBeNull();
    plain.getState().setComponentProps([{ name: "x", type: "number", default: 1 }]);
    plain.getState().setSampleProps({ x: 2 });
    expect(plain.getState().componentMode).toBeNull();
    expect(plain.getState().dirty).toBe(false);

    const s = createEditorStore(rep, { componentMode: { componentId: "hdr", version: 3, props: hdr.props, sampleProps: {} } });
    s.getState().setSampleProps({ title: "샘플" });
    expect(s.getState().componentMode).toMatchObject({ componentId: "hdr", version: 3, sampleProps: { title: "샘플" } });
    expect(s.getState().dirty).toBe(false);
    s.getState().setComponentProps([{ name: "title", type: "string", default: "새 제목" }]);
    expect(s.getState().componentMode?.props).toEqual([{ name: "title", type: "string", default: "새 제목" }]);
    expect(s.getState().dirty).toBe(true);
    expect(s.getState().history.past).toHaveLength(0);
  });

  it("insertComponent embeds the body and adds a selected ref at the drop point, as one undo step", () => {
    const s = createEditorStore(rep);
    s.getState().insertComponent("hdr", 3, hdr, 12.345, 40);
    const ref = refOf(s, "hdr-1");
    expect(ref).toMatchObject({ type: "ref", ref: "hdr", version: 3, x: 12.35, y: 40, w: 60, h: 20, flow: "once", props: {} });
    expect(s.getState().report.elements.at(-1)?.id).toBe("hdr-1");
    expect(s.getState().report.components["hdr@3"]).toEqual(hdr);
    expect(s.getState().selection).toEqual(["hdr-1"]);
    s.getState().insertComponent("hdr", 3, hdr, 0, 0);
    expect(s.getState().findElement("hdr-2")).toBeTruthy();
    expect(Object.keys(s.getState().report.components)).toEqual(["hdr@3"]);
    expect(s.getState().replaceReport(JSON.parse(JSON.stringify(s.getState().report)))).toBe(true);   // 스키마를 통과한다
    s.getState().undo(); s.getState().undo();
    expect(s.getState().findElement("hdr-1")).toBeUndefined();
    expect(s.getState().report.components).toEqual({});
  });

  it("insertComponent does nothing in component mode (no nesting)", () => {
    const s = createEditorStore(rep, { componentMode: { componentId: "other", version: 1, props: [], sampleProps: {} } });
    s.getState().insertComponent("hdr", 3, hdr, 0, 0);
    expect(s.getState().findElement("hdr-1")).toBeUndefined();
    expect(s.getState().history.past).toHaveLength(0);
  });

  it("updateInstances upgrades every instance, drops undeclared values and old versions, as one undo step", () => {
    const s = createEditorStore(rep);
    s.getState().insertComponent("hdr", 1, hdr, 0, 0);
    s.getState().updateElement("hdr-1", { props: { title: "{{ params.t }}", sub: "부제" } } as Partial<Element>);
    s.getState().select(["a"]);
    const past = s.getState().history.past.length;
    s.getState().updateInstances("hdr", 2, hdrV2);
    expect(refOf(s, "hdr-1")).toMatchObject({ version: 2, w: 60, h: 25, props: { title: "{{ params.t }}" } });
    expect(refOf(s, "hdr-1").props).not.toHaveProperty("sub");
    expect(Object.keys(s.getState().report.components)).toEqual(["hdr@2"]);
    expect(s.getState().selection).toEqual(["a"]);
    expect(s.getState().history.past).toHaveLength(past + 1);
    s.getState().undo();
    expect(refOf(s, "hdr-1")).toMatchObject({ version: 1, h: 20, props: { sub: "부제" } });
    expect(Object.keys(s.getState().report.components)).toEqual(["hdr@1"]);
  });

  it("replaceWithComponent swaps the selection for a ref at the first selected position and selects it, as one undo step", () => {
    const s = createEditorStore(rep);
    const { body, box } = extractComponent(s.getState().report.elements, ["l", "a"], "머리");
    s.getState().select(["a", "l"]);
    s.getState().replaceWithComponent(["l", "a"], "head", 1, body, box);
    expect(s.getState().report.elements.map((e) => e.id)).toEqual(["head-1", "g"]);
    expect(refOf(s, "head-1")).toMatchObject({ ref: "head", version: 1, x: 10, y: 10, w: 40, h: 20, flow: "once", props: {} });
    expect(s.getState().report.components["head@1"]).toEqual(body);
    expect(s.getState().selection).toEqual(["head-1"]);
    expect(s.getState().replaceReport(JSON.parse(JSON.stringify(s.getState().report)))).toBe(true);
    s.getState().undo();
    expect(s.getState().report.elements.map((e) => e.id)).toEqual(["a", "l", "g"]);
    expect(s.getState().report.components).toEqual({});
  });

  it("replaceWithComponent reports success or the reason it did nothing", () => {
    const s = createEditorStore(rep);
    const { body, box } = extractComponent(s.getState().report.elements, ["l", "a"], "머리");
    const bad = s.getState().replaceWithComponent(["a", "b"], "x", 1, body, box);   // 부모가 다르다
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.length).toBeGreaterThan(0);
    expect(s.getState().history.past).toHaveLength(0);
    expect(s.getState().replaceWithComponent(["l", "a"], "head", 1, body, box)).toEqual({ ok: true });
  });

  it("replaceWithComponent replaces group children inside their group and ignores selections that break the rules", () => {
    const s = createEditorStore(rep);
    const { body, box } = extractComponent((s.getState().findElement("g") as Extract<Element, { type: "group" }>).children, ["b"], "상자");
    s.getState().replaceWithComponent(["b"], "box", 1, body, box);
    expect((s.getState().findElement("g") as Extract<Element, { type: "group" }>).children.map((c) => c.id)).toEqual(["box-1"]);
    expect(refOf(s, "box-1")).toMatchObject({ x: 1, y: 1, w: 5, h: 5 });

    const t = createEditorStore(rep);
    t.getState().select(["a"]);
    t.getState().replaceWithComponent(["a", "b"], "x", 1, body, box);   // 부모가 다르다
    expect(t.getState().history.past).toHaveLength(0);
    expect(t.getState().selection).toEqual(["a"]);
  });

  it("resizeElement leaves a ref's box unchanged", () => {
    const s = createEditorStore(rep);
    s.getState().insertComponent("hdr", 1, hdr, 5, 5);
    const past = s.getState().history.past.length;
    s.getState().resizeElement("hdr-1", { x: 0, y: 0, w: 90, h: 40 });
    expect(refOf(s, "hdr-1")).toMatchObject({ x: 5, y: 5, w: 60, h: 20 });
    expect(s.getState().history.past).toHaveLength(past);
  });
});

describe("editor store (phase 3b: group and ungroup)", () => {
  const rep = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
    { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
    { id: "l", type: "line", x: 50, y: 30, w: 20, h: 0, x2: 30, y2: 30 },   // w/h를 끝점과 맞춰 둔다(apply가 다시 계산하므로 원래 레포트와 비교가 깨지지 않게)
    { id: "g", type: "group", x: 50, y: 50, w: 20, h: 20, children: [{ id: "b", type: "rect", x: 1, y: 1, w: 5, h: 5 }, { id: "c", type: "rect", x: 10, y: 10, w: 5, h: 5 }] },
    { id: "cond", type: "group", x: 0, y: 80, w: 10, h: 10, visible: "{{ params.show }}", children: [{ id: "d", type: "rect", x: 0, y: 0, w: 5, h: 5 }] },
    { id: "cards", type: "repeater", x: 0, y: 90, w: 100, h: 10, source: "rows", item: { w: 50, h: 10, children: [
      { id: "c1", type: "text", x: 1, y: 1, w: 10, h: 5 }, { id: "c2", type: "text", x: 20, y: 1, w: 10, h: 5 },
    ]}},
  ]});
  type Group = Extract<Element, { type: "group" }>;
  let store: ReturnType<typeof createEditorStore>;
  beforeEach(() => { store = createEditorStore(rep); });

  it("groups same-parent siblings into a new selected group at the first position, as one undo step", () => {
    store.getState().select(["l", "a"]);
    expect(store.getState().groupSelected()).toEqual({ ok: true });
    expect(store.getState().report.elements.map((e) => e.id)).toEqual(["group-1", "g", "cond", "cards"]);
    const g = store.getState().findElement("group-1") as Group;
    expect(g).toMatchObject({ x: 10, y: 10, w: 40, h: 20 });
    expect(g.children.map((c) => c.id)).toEqual(["a", "l"]);
    expect(g.children[1]).toMatchObject({ x: 40, y: 20, x2: 20, y2: 20 });
    expect(store.getState().selection).toEqual(["group-1"]);
    expect(store.getState().history.past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().report).toEqual(rep);
  });

  it("groups inside a group and inside a repeater band", () => {
    store.getState().select(["b", "c"]);
    expect(store.getState().groupSelected()).toEqual({ ok: true });
    expect((store.getState().findElement("g") as Group).children.map((e) => e.id)).toEqual(["group-1"]);
    store.getState().select(["c1", "c2"]);
    expect(store.getState().groupSelected()).toEqual({ ok: true });
    expect(store.getState().findParentRepeater("group-2")).toBe("cards");
    expect(store.getState().selection).toEqual(["group-2"]);
  });

  it("returns the reason and changes nothing when the selection is not in one parent", () => {
    store.getState().select(["a", "b"]);
    expect(store.getState().groupSelected()).toEqual({ ok: false, error: "같은 부모(최상위 또는 같은 그룹) 안의 요소만 함께 선택할 수 있습니다" });
    store.getState().select([]);
    expect(store.getState().groupSelected()).toEqual({ ok: false, error: "선택한 요소가 없습니다" });
    expect(store.getState().history.past).toHaveLength(0);
    expect(store.getState().dirty).toBe(false);
  });

  it("ungroups selected groups back into their parent, selects the children, as one undo step", () => {
    store.getState().select(["g"]);
    expect(store.getState().ungroupSelected()).toEqual({ ok: true });
    expect(store.getState().report.elements.map((e) => e.id)).toEqual(["a", "l", "b", "c", "cond", "cards"]);
    expect(store.getState().findElement("b")).toMatchObject({ x: 51, y: 51 });
    expect(store.getState().findElement("c")).toMatchObject({ x: 60, y: 60 });
    expect(store.getState().selection).toEqual(["b", "c"]);
    expect(store.getState().history.past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().report).toEqual(rep);
  });

  it("group then ungroup gives back the original report", () => {
    store.getState().select(["a", "l"]);
    store.getState().groupSelected();
    store.getState().ungroupSelected();
    expect(store.getState().report).toEqual(rep);
    expect(store.getState().selection).toEqual(["a", "l"]);
  });

  it("ungroups an outer and an inner group selected together", () => {
    store.getState().select(["b", "c"]);
    store.getState().groupSelected();                         // g > group-1 > b, c
    store.getState().select(["group-1", "g"]);
    expect(store.getState().ungroupSelected()).toEqual({ ok: true });
    expect(store.getState().report.elements.map((e) => e.id)).toEqual(["a", "l", "b", "c", "cond", "cards"]);
    expect(store.getState().findElement("c")).toMatchObject({ x: 60, y: 60 });
    expect(store.getState().selection).toEqual(["b", "c"]);
    expect(store.getState().history.past).toHaveLength(2);    // 그룹화 1 + 해제 1
  });

  it("refuses to ungroup a group with a visible condition, or when no group is selected", () => {
    store.getState().select(["g", "cond"]);
    expect(store.getState().ungroupSelected()).toEqual({ ok: false, error: "표시 조건(visible)이 있는 그룹은 해제할 수 없습니다: cond" });
    expect(store.getState().findElement("g")).toBeTruthy();   // 함께 고른 다른 그룹도 풀지 않는다
    store.getState().select(["a"]);
    expect(store.getState().ungroupSelected()).toEqual({ ok: false, error: "해제할 그룹을 선택하세요" });
    expect(store.getState().history.past).toHaveLength(0);
    expect(store.getState().selection).toEqual(["a"]);
  });
});

describe("component mode guards (중첩 금지, 스펙 4.1·7.5)", () => {
  const body = parseComponentBody({ name: "H", w: 10, h: 5, elements: [{ id: "x", type: "rect", x: 0, y: 0, w: 10, h: 5 }] });
  const mode = { componentId: "self", version: 1, props: [], sampleProps: {} };
  it("ignores insertComponent and replaceWithComponent while editing a component", () => {
    const s = createEditorStore(report, { componentMode: mode });
    s.getState().insertComponent("hdr", 1, body, 10, 10);
    const res = s.getState().replaceWithComponent(["a"], "hdr", 1, body, { x: 10, y: 10, w: 20, h: 5 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("컴포넌트");
    expect(s.getState().report).toBe(report);
    expect(s.getState().history.past).toHaveLength(0);
  });
  it("still inserts components in a normal report", () => {
    const s = createEditorStore(report);
    s.getState().insertComponent("hdr", 1, body, 10, 10);
    expect(s.getState().report.components["hdr@1"]).toBeDefined();
  });
});
