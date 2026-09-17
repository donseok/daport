import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { parseReport, parseComponentBody, type ComponentBody, type Element } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { PropertyPanel } from "../panels/PropertyPanel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

type Ref = Extract<Element, { type: "ref" }>;
const body = (w: number, h: number): ComponentBody => parseComponentBody({ name: "회사 헤더", w, h,
  props: [
    { name: "title", type: "string", default: "제목", label: "제목" },
    { name: "qty", type: "number", default: 1 },
    { name: "showLogo", type: "boolean", default: true },
    { name: "logo", type: "image", default: "" },
  ],
  elements: [{ id: "t", type: "text", x: 0, y: 0, w, h, value: "{{ props.title }}" }] });
const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, components: { "hdr@3": body(40, 10) }, elements: [
  { id: "hdr-1", type: "ref", ref: "hdr", version: 3, x: 10, y: 10, w: 40, h: 10, props: { title: "{{ record.NO }}" } },
  { id: "hdr-2", type: "ref", ref: "hdr", version: 3, x: 10, y: 40, w: 40, h: 10, props: {} },
]});
const detail = (b: ComponentBody, latestVersion: number) => ({ summary: { id: "hdr", name: "회사 헤더", latestVersion, w: b.w, h: b.h, updatedAt: "2026-09-17T00:00:00.000Z" }, versions: [], latest: b });
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });

/** GET /api/components/hdr 응답을 차례로 준다(마지막 응답은 계속 반복) */
function stubLibrary(...responses: (() => Response)[]) {
  let n = 0;
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => responses[Math.min(n++, responses.length - 1)]());
  vi.stubGlobal("fetch", fn);
  return fn;
}

function setup(...responses: (() => Response)[]) {
  const fetchMock = stubLibrary(...(responses.length ? responses : [() => json(detail(body(40, 10), 3))]));
  const store = createEditorStore(report);
  store.getState().select(["hdr-1"]);
  const utils = render(<EditorContext.Provider value={store}><PropertyPanel /></EditorContext.Provider>);
  const ref = (id = "hdr-1") => store.getState().findElement(id) as Ref;
  return { store, fetchMock, ref, ...utils };
}

describe("RefPanel (PropertyPanel의 ref 위임)", () => {
  it("shows the component name and version, keeps X/Y/visible/flow and hides W/H and style", async () => {
    const { getByText, findByText, getByLabelText, queryByLabelText, queryByRole, fetchMock, ref } = setup();
    expect(getByText("회사 헤더")).toBeTruthy();
    expect(getByText("v3")).toBeTruthy();
    expect(queryByLabelText("W")).toBeNull();
    expect(queryByLabelText("H")).toBeNull();
    expect(queryByLabelText("선색")).toBeNull();
    fireEvent.change(getByLabelText("X"), { target: { value: "15" } });
    fireEvent.change(getByLabelText("Y"), { target: { value: "12" } });
    fireEvent.change(getByLabelText("visible"), { target: { value: "{{ params.show }}" } });
    fireEvent.change(getByLabelText("flow"), { target: { value: "every" } });
    expect(ref()).toMatchObject({ x: 15, y: 12, w: 40, h: 10, visible: "{{ params.show }}", flow: "every" });
    expect(await findByText("라이브러리 최신")).toBeTruthy();                 // 라이브러리 최신 = v3
    expect(fetchMock.mock.calls[0][0]).toBe("/api/components/hdr");
    expect(queryByRole("button", { name: /업데이트/ })).toBeNull();
  });
  it("offers v3 → v5 update, confirms a size change and updates every instance as one undo step", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { findByRole, queryByRole, store, ref } = setup(() => json(detail(body(40, 12), 5)));
    fireEvent.click(await findByRole("button", { name: "v3 → v5 업데이트" }));
    await waitFor(() => expect(ref().version).toBe(5));
    expect(confirm).toHaveBeenCalledWith("40×10 → 40×12, 아래 요소와 겹칠 수 있습니다");
    expect(ref()).toMatchObject({ w: 40, h: 12, props: { title: "{{ record.NO }}" } });
    expect(ref("hdr-2")).toMatchObject({ version: 5, h: 12 });
    expect(Object.keys(store.getState().report.components)).toEqual(["hdr@5"]);
    expect(store.getState().history.past).toHaveLength(1);
    await waitFor(() => expect(queryByRole("button", { name: /업데이트/ })).toBeNull());
  });
  it("keeps the version when the size confirm is cancelled, and updates without a confirm when the size is unchanged", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { findByRole, store, ref } = setup(() => json(detail(body(40, 12), 5)), () => json(detail(body(40, 12), 5)), () => json(detail(body(40, 10), 6)));
    fireEvent.click(await findByRole("button", { name: "v3 → v5 업데이트" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(ref().version).toBe(3);
    expect(store.getState().history.past).toHaveLength(0);
    fireEvent.click(await findByRole("button", { name: "v3 → v5 업데이트" }));
    await waitFor(() => expect(ref().version).toBe(6));                      // 누르는 시점의 최신(v6)을 받는다
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it("tells when the component is missing from the library or the update request fails", async () => {
    const missing = setup(() => json({ error: "component not found: hdr" }, 404));
    expect(await missing.findByText("라이브러리에서 찾지 못했습니다: component not found: hdr")).toBeTruthy();
    expect(missing.queryByRole("button", { name: /업데이트/ })).toBeNull();
    cleanup();
    const failing = setup(() => json(detail(body(40, 10), 4)), () => json({ error: "db down" }, 500));
    fireEvent.click(await failing.findByRole("button", { name: "v3 → v4 업데이트" }));
    expect(await failing.findByText("업데이트하지 못했습니다: db down")).toBeTruthy();
    expect(failing.ref().version).toBe(3);
  });
  it("edits string and number props as templates; clearing a field removes the value so the default applies", () => {
    const { getByLabelText, getByText, ref, store } = setup();
    const title = getByLabelText("입력값 title") as HTMLInputElement;
    expect(getByText("제목 (title)")).toBeTruthy();                            // 라벨이 있으면 라벨 (이름)
    expect(title.value).toBe("{{ record.NO }}");
    expect(title.placeholder).toBe("제목");
    fireEvent.change(title, { target: { value: "품질보증서" } });
    expect(ref().props).toEqual({ title: "품질보증서" });
    fireEvent.change(title, { target: { value: "" } });
    expect(ref().props).toEqual({});
    const qty = getByLabelText("입력값 qty") as HTMLInputElement;
    expect(qty.placeholder).toBe("1");
    fireEvent.change(qty, { target: { value: "12" } });
    expect(ref().props).toEqual({ qty: 12 });                                   // 숫자 리터럴은 number로
    fireEvent.change(qty, { target: { value: "{{ row.QTY }}" } });
    expect(ref().props).toEqual({ qty: "{{ row.QTY }}" });                      // 그 밖은 템플릿 문자열
    expect(qty.value).toBe("{{ row.QTY }}");
    expect(store.getState().history.past).toHaveLength(4);                     // 입력 한 번 = 커밋 한 번
    expect(ref("hdr-2").props).toEqual({});                                     // 다른 인스턴스는 그대로
  });
  it("edits a boolean prop with a checkbox, switches to a template input and back, and resets to the default", () => {
    const { getByLabelText, getByRole, queryByRole, ref } = setup();
    const check = () => getByLabelText("입력값 showLogo") as HTMLInputElement;
    expect(check().type).toBe("checkbox");
    expect(check().checked).toBe(true);                                         // 기본값 true
    expect(queryByRole("button", { name: "입력값 showLogo 기본값" })).toBeNull();
    fireEvent.click(check());
    expect(ref().props).toMatchObject({ showLogo: false });
    fireEvent.click(getByRole("button", { name: "입력값 showLogo 기본값" }));
    expect(ref().props).not.toHaveProperty("showLogo");
    expect(check().checked).toBe(true);

    fireEvent.click(getByRole("button", { name: "입력값 showLogo 템플릿 전환" }));
    expect(check().type).toBe("text");
    fireEvent.change(check(), { target: { value: "{{ params.logo }}" } });
    expect(ref().props).toMatchObject({ showLogo: "{{ params.logo }}" });
    fireEvent.click(getByRole("button", { name: "입력값 showLogo 템플릿 전환" }));
    expect(check().type).toBe("checkbox");                                      // 체크박스로 돌아가면 템플릿 값은 지운다
    expect(ref().props).not.toHaveProperty("showLogo");
  });
  it("shows a template value of a boolean prop as a text input from the start", () => {
    const store = createEditorStore(report);
    stubLibrary(() => json(detail(body(40, 10), 3)));
    act(() => { store.getState().updateElement("hdr-1", { props: { showLogo: "{{ record.LOGO }}" } } as Partial<Element>); store.getState().select(["hdr-1"]); });
    const { getByLabelText } = render(<EditorContext.Provider value={store}><PropertyPanel /></EditorContext.Provider>);
    expect((getByLabelText("입력값 showLogo") as HTMLInputElement).value).toBe("{{ record.LOGO }}");
  });
  it("edits an image prop as asset://id or URL text", () => {
    const { getByLabelText, ref } = setup();
    const logo = getByLabelText("입력값 logo") as HTMLInputElement;
    expect(logo.placeholder).toBe("asset://id 또는 URL");
    fireEvent.change(logo, { target: { value: "asset://stamp" } });
    expect(ref().props).toMatchObject({ logo: "asset://stamp" });
    fireEvent.change(logo, { target: { value: "" } });
    expect(ref().props).not.toHaveProperty("logo");
  });
  it("says when the report does not carry the referenced version", () => {
    const { getByText, store } = setup();
    act(() => { store.getState().updateElement("hdr-1", { version: 9 } as Partial<Element>); });
    expect(getByText("컴포넌트 내용이 없습니다: hdr@9")).toBeTruthy();
  });
});
