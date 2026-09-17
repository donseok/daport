import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { createContext, useContext } from "react";
import {
  safeParseReport, walkElements, childArrays, collectIds, ElementSchema, componentKey, upgradeRefs, sameParent, groupElements, ungroupElement,
  type Report, type Element, type Page, type Preset, type ComponentBody, type ComponentProp, type Box,
} from "@daport/core";
import { createHistory, commit, undo, redo, type History } from "./history";

export type Problem = { path: string; message: string };
export type View = { copyIndex: number; pageInCopy: number };
export type BandTarget = { repeaterId: string; band: "item" | "groupHeader" | "groupFooter"; groupIndex?: number };
/** 컴포넌트 편집 화면의 상태. 편집 대상 레포트는 componentToEditReport로 감싼 것이고, 입력값 선언은 레포트 밖에 둔다 */
export type ComponentMode = { componentId: string; version: number; props: ComponentProp[]; sampleProps: Record<string, unknown> };
export type ActionResult = { ok: true } | { ok: false; error: string };

export type EditorState = {
  history: History<Report>;
  report: Report;
  selection: string[];
  problems: Problem[];
  dirty: boolean;
  mode: "design" | "preview";
  /** 캔버스가 보이는 부·페이지. 히스토리 밖 */
  view: View;
  /** 미리보기·PDF에 sample.data를 보내지 않고 서버 데이터셋을 실행한다. 히스토리 밖 */
  liveData: boolean;
  // queries
  findElement(id: string): Element | undefined;
  allocateId(base: string): string;   // 트리 전체에서 비어 있는 `${base}-n`
  findParentRepeater(id: string): string | undefined;   // id가 어떤 repeater 템플릿(항목·그룹 밴드) 안에 있으면 그 repeater id
  // mutations
  select(ids: string[]): void;
  toggleSelect(id: string): void;
  updateElement(id: string, patch: Partial<Element>): void;
  moveSelected(dx: number, dy: number): void;
  resizeElement(id: string, box: { x: number; y: number; w: number; h: number }): void;
  addElement(el: Element, opts?: { into?: BandTarget }): void;
  duplicateSelected(): void;
  deleteSelected(): void;
  updatePage(patch: Partial<Page>): void;
  replaceReport(candidate: unknown): boolean;
  undo(): void;
  redo(): void;
  setMode(m: "design" | "preview"): void;
  /** saved는 저장 요청에 실어 보낸 모델이다. 요청 중에 편집이 있었으면(참조가 다르면) dirty로 남긴다 */
  markSaved(saved: Report): void;
  setView(v: Partial<View>): void;
  setLiveData(v: boolean): void;
  setSample(sample: Report["sample"]): void;
  setDatasets(datasets: Report["datasets"]): void;
  setParams(params: Report["params"]): void;
  setRepeat(repeat: Report["repeat"] | undefined): void;
  bitmapPreview: boolean;                     // 라벨 미리보기에서 이진화 PNG를 보인다. 히스토리 밖
  setBitmapPreview(v: boolean): void;
  setOutput(output: Report["output"]): void;
  applyPreset(preset: Preset): void;          // page + output을 한 커밋으로
  /** 컴포넌트 편집 화면이면 편집 중인 컴포넌트 정보, 레포트 편집이면 null. 히스토리 밖 */
  componentMode: ComponentMode | null;
  setComponentProps(props: ComponentProp[]): void;            // 입력값 선언. 저장 대상이므로 dirty
  setSampleProps(values: Record<string, unknown>): void;      // 미리보기용 샘플 값. 저장하지 않으므로 dirty가 아니다
  /** components에 내용을 넣고 (x, y)에 ref를 추가해 선택한다. 컴포넌트 모드에서는 중첩 금지라 아무것도 하지 않는다 */
  insertComponent(id: string, version: number, body: ComponentBody, x: number, y: number): void;
  /** 이 레포트의 인스턴스를 모두 version으로 올린다(core upgradeRefs, 스펙 7.2) */
  updateInstances(id: string, version: number, body: ComponentBody): void;
  /** 선택 요소들을 부모 배열에서 지우고 첫 선택 자리에 ref(box 위치)를 넣는다(스펙 7.3의 4). 조건이 안 맞으면 아무것도 하지 않는다 */
  replaceWithComponent(ids: string[], id: string, version: number, body: ComponentBody, box: Box): void;
  groupSelected(): ActionResult;
  ungroupSelected(): ActionResult;
};

function newId(base: string, report: Report): string {
  const ids = collectIds(report.elements);
  let n = 1; let id = `${base}-${n}`;
  while (ids.has(id)) { n++; id = `${base}-${n}`; }
  return id;
}

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * 선의 경계 상자. 선의 x/y는 시작점이고 x2/y2는 끝점이라, 오른쪽→왼쪽·아래→위로 그린 선은 x/y가 상자의 왼쪽·위가 아니다.
 * 요소(그룹 상대좌표)와 layout 결과(절대좌표) 모두에 쓴다
 */
export function lineBox(l: { x: number; y: number; x2: number; y2: number }): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(l.x, l.x2), y: Math.min(l.y, l.y2), w: Math.abs(l.x2 - l.x), h: Math.abs(l.y2 - l.y) };
}

/**
 * 한 축의 끝점 좌표 p를 옛 구간 [from, from+size]에서 새 구간 [to, to+nsize]로 비례해 옮긴다. 선의 끝점은 늘 구간 끝에 있으므로
 * 왼쪽(위) 끝점은 새 왼쪽(위) 끝에 남아 방향이 유지된다. 길이 0인 축(가로선의 높이 등)은 비율이 없으므로 끝점을 제자리에 두되
 * 새 구간 안으로만 당긴다. 그래야 가로선의 n/s 핸들이 선을 기울이거나 한쪽 핸들만 선을 옮기지 않는다
 */
function mapAxis(p: number, from: number, size: number, to: number, nsize: number): number {
  return size === 0 ? Math.min(Math.max(p, to), to + nsize) : to + ((p - from) / size) * nsize;
}

/** repeater 밴드의 자식 배열. 없으면 최상위 elements (잘못된 대상이면 조용히 최상위에 넣는다) */
function bandOf(r: Report, into: BandTarget): Element[] {
  let found: Element[] | undefined;
  walkElements(r.elements, (el) => {
    if (el.id !== into.repeaterId || el.type !== "repeater") return;
    const g = el.groups[into.groupIndex ?? 0];
    found = into.band === "item" ? el.item.children : into.band === "groupHeader" ? g?.header?.children : g?.footer?.children;
    return true;
  });
  return found ?? r.elements;
}

export function createEditorStore(initial: Report, opts?: { componentMode?: ComponentMode | null }) {
  return createStore<EditorState>((set, get) => {
    const apply = (mutate: (r: Report) => void) => {
      // 선의 w/h는 끝점에서 정해진다. X2·Y2 편집(패널·JSON)이나 추가·교체 뒤에도 선택 상자와 그린 선이 어긋나지 않게 모든 편집 뒤에 맞춘다
      const h = commit(get().history, (r) => {
        mutate(r);
        walkElements(r.elements, (el) => { if (el.type === "line") { const b = lineBox(el); el.w = round(b.w); el.h = round(b.h); } });
      });
      if (h !== get().history) set({ history: h, report: h.present, dirty: true, problems: [] });
    };
    const pruneSelection = () => set({ selection: get().selection.filter((id) => !!get().findElement(id)) });
    const travel = (step: (h: History<Report>) => History<Report>) => {
      const h = step(get().history);
      if (h === get().history) return;   // 되돌릴 것이 없으면 dirty를 바꾸지 않는다
      // 편집기 텍스트가 스토어 텍스트로 바뀌므로 이전 텍스트의 검증 오류는 더 이상 맞지 않는다
      set({ history: h, report: h.present, dirty: true, problems: [] });
      pruneSelection();
    };
    return {
      history: createHistory(initial), report: initial, selection: [], problems: [], dirty: false, mode: "design",
      view: { copyIndex: 0, pageInCopy: 0 }, liveData: false, bitmapPreview: false,
      componentMode: opts?.componentMode ?? null,
      findElement: (id) => { let found: Element | undefined; walkElements(get().report.elements, (el) => { if (el.id === id) { found = el; return true; } }); return found; },
      allocateId: (base) => newId(base, get().report),
      findParentRepeater: (id) => {
        let found: string | undefined;
        walkElements(get().report.elements, (el, _p, _i, ancestors) => { if (el.id === id) { found = ancestors.find((a) => a.type === "repeater")?.id; return true; } });
        return found;
      },
      select: (ids) => set({ selection: ids }),
      toggleSelect: (id) => set((s) => ({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] })),
      updateElement: (id, patch) => apply((r) => { walkElements(r.elements, (el) => { if (el.id === id) { Object.assign(el, patch); return true; } }); }),
      moveSelected: (dx, dy) => apply((r) => { const sel = new Set(get().selection); walkElements(r.elements, (el) => {
        if (sel.has(el.id)) { el.x = round(el.x + dx); el.y = round(el.y + dy); if (el.type === "line") { el.x2 = round(el.x2 + dx); el.y2 = round(el.y2 + dy); } } }); }),
      // box는 새 경계 상자다. 선은 두 끝점을 옛 상자에서 새 상자로 옮기고 w/h는 apply가 끝점에서 다시 계산한다.
      // 컴포넌트 인스턴스(ref)의 크기는 내용 크기와 같아야 하므로(스키마) 크기 조절을 받지 않는다
      resizeElement: (id, box) => apply((r) => { walkElements(r.elements, (el) => { if (el.id !== id) return;
        if (el.type === "ref") return true;
        if (el.type === "line") {
          const old = lineBox(el);
          el.x = round(mapAxis(el.x, old.x, old.w, box.x, box.w)); el.x2 = round(mapAxis(el.x2, old.x, old.w, box.x, box.w));
          el.y = round(mapAxis(el.y, old.y, old.h, box.y, box.h)); el.y2 = round(mapAxis(el.y2, old.y, old.h, box.y, box.h));
          return true;
        }
        el.x = round(box.x); el.y = round(box.y); el.w = round(box.w); el.h = round(box.h); return true; }); }),
      addElement: (el, opts) => { apply((r) => { (opts?.into ? bandOf(r, opts.into) : r.elements).push(el); }); set({ selection: [el.id] }); },
      duplicateSelected: () => {
        const ids: string[] = [];
        apply((r) => {
          const sel = new Set(get().selection);
          const used = collectIds(r.elements);
          const alloc = (base: string) => { let n = 1; while (used.has(`${base}-${n}`)) n++; used.add(`${base}-${n}`); return `${base}-${n}`; };
          // 복사본은 원본과 같은 부모 배열(그룹 자식·반복 영역 템플릿 포함)의 바로 뒤에 넣는다. 자식의 x/y는 부모 기준이라 최상위로 옮기면 위치가 틀어진다
          const inserts: { parent: Element[]; idx: number; copy: Element }[] = [];
          walkElements(r.elements, (el, parent, idx) => {
            if (!sel.has(el.id)) return;
            const c = structuredClone(el) as Element;
            c.id = alloc(el.id); c.x = round(c.x + 5); c.y = round(c.y + 5);
            if (c.type === "line") { c.x2 = round(c.x2 + 5); c.y2 = round(c.y2 + 5); }
            for (const arr of childArrays(c)) walkElements(arr, (d) => { d.id = alloc(d.id); });   // 복사한 자손도 새 id (중복 id는 검증 실패)
            ids.push(c.id); inserts.push({ parent, idx, copy: c });
          });
          // 같은 부모 안에서는 뒤쪽 인덱스부터 넣어야 앞쪽 인덱스가 밀리지 않는다 (walk는 부모마다 인덱스 오름차순으로 방문)
          for (const { parent, idx, copy } of inserts.reverse()) parent.splice(idx + 1, 0, copy);
        });
        set({ selection: ids });
      },
      deleteSelected: () => {
        apply((r) => {
          const sel = new Set(get().selection);
          const prune = (els: Element[]) => { for (let i = els.length - 1; i >= 0; i--) { if (sel.has(els[i].id)) els.splice(i, 1); else for (const arr of childArrays(els[i])) prune(arr); } };
          prune(r.elements);
        });
        set({ selection: [] });
      },
      updatePage: (patch) => apply((r) => { Object.assign(r.page, patch); }),
      replaceReport: (candidate) => {
        const res = safeParseReport(candidate);
        if (!res.success) { set({ problems: res.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }); return false; }
        // 저장 URL이 id로 정해지므로 id를 바꾸면 다른 레포트를 덮어쓴다
        if (res.data.id !== initial.id) { set({ problems: [{ path: "id", message: "id는 바꿀 수 없습니다" }] }); return false; }
        // 모델이 그대로여도(잘못 고친 값을 원래대로 되돌린 경우) 텍스트는 이제 올바르므로 오류를 지운다. apply는 바뀔 때만 지운다
        set({ problems: [] });
        apply((r) => { Object.assign(r, res.data); for (const k of Object.keys(r)) if (!(k in res.data)) delete (r as any)[k]; });
        pruneSelection();
        return true;
      },
      undo: () => travel(undo),
      redo: () => travel(redo),
      setMode: (mode) => set({ mode }),
      markSaved: (saved) => set({ dirty: get().report !== saved }),   // 커밋·undo·redo는 늘 새 객체를 만든다
      setView: (v) => set((s) => ({ view: { ...s.view, ...v } })),
      setLiveData: (liveData) => set({ liveData }),
      setSample: (sample) => apply((r) => { if (sample) r.sample = sample; else delete r.sample; }),
      setDatasets: (datasets) => apply((r) => { r.datasets = datasets; }),
      setParams: (params) => apply((r) => { r.params = params; }),
      setRepeat: (repeat) => apply((r) => { if (repeat) r.repeat = repeat; else delete r.repeat; }),
      setBitmapPreview: (bitmapPreview) => set({ bitmapPreview }),
      setOutput: (output) => apply((r) => { r.output = output; }),
      applyPreset: (preset) => apply((r) => { r.page = { ...preset.page }; r.output = structuredClone(preset.output); }),
      setComponentProps: (props) => { const cm = get().componentMode; if (cm) set({ componentMode: { ...cm, props }, dirty: true }); },
      setSampleProps: (sampleProps) => { const cm = get().componentMode; if (cm) set({ componentMode: { ...cm, sampleProps } }); },
      insertComponent: (id, version, body, x, y) => {
        if (get().componentMode) return;   // 중첩 컴포넌트 금지 (스펙 7.5)
        const ref = ElementSchema.parse({ id: get().allocateId(id), type: "ref", ref: id, version, x: round(x), y: round(y), w: body.w, h: body.h, flow: "once", props: {} });
        apply((r) => { r.components[componentKey(id, version)] = structuredClone(body); r.elements.push(ref); });
        set({ selection: [ref.id] });
      },
      updateInstances: (id, version, body) => apply((r) => {
        const next = upgradeRefs(r, id, version, body);
        r.elements = next.elements; r.components = next.components;
      }),
      replaceWithComponent: (ids, id, version, body, box) => {
        const refId = get().allocateId(id);
        let replaced = false;
        apply((r) => {
          const info = sameParent(r.elements, ids, { allowInTemplate: false, allowRefs: false });
          if ("error" in info) return;
          const ref = ElementSchema.parse({ id: refId, type: "ref", ref: id, version, x: box.x, y: box.y, w: body.w, h: body.h, flow: "once", props: {} });
          for (const i of [...info.indices].reverse()) info.parent.splice(i, 1);
          info.parent.splice(info.indices[0], 0, ref);
          r.components[componentKey(id, version)] = structuredClone(body);
          replaced = true;
        });
        if (replaced) set({ selection: [refId] });
      },
      groupSelected: () => {
        const { report, selection } = get();
        const opts = { allowInTemplate: true, allowRefs: true };
        const check = sameParent(report.elements, selection, opts);
        if ("error" in check) return { ok: false, error: check.error };
        const groupId = get().allocateId("group");
        apply((r) => {
          const info = sameParent(r.elements, selection, opts);
          if ("error" in info) return;
          info.parent.splice(0, info.parent.length, ...groupElements(info.parent, selection, groupId));
        });
        set({ selection: [groupId] });
        return { ok: true };
      },
      ungroupSelected: () => {
        // 문서 순서(바깥 그룹 먼저)로 푼다. 안쪽 그룹을 함께 골랐으면 바깥을 푼 뒤 그 자리에서 다시 찾는다
        const sel = new Set(get().selection);
        const groups: Extract<Element, { type: "group" }>[] = [];
        walkElements(get().report.elements, (el) => { if (sel.has(el.id) && el.type === "group") groups.push(el); });
        if (groups.length === 0) return { ok: false, error: "해제할 그룹을 선택하세요" };
        const conditional = groups.find((g) => g.visible !== undefined);
        if (conditional) return { ok: false, error: `표시 조건(visible)이 있는 그룹은 해제할 수 없습니다: ${conditional.id}` };
        const ids: string[] = [];
        apply((r) => {
          for (const g of groups) {
            walkElements(r.elements, (el, parent) => {
              if (el.id !== g.id || el.type !== "group") return;
              const childIds = el.children.map((c) => c.id);
              parent.splice(0, parent.length, ...ungroupElement(parent, g.id));
              // 앞에서 푼 그룹의 자식이었으면 그 자리를 이 그룹의 자식으로 바꾼다
              const at = ids.indexOf(g.id);
              if (at >= 0) ids.splice(at, 1, ...childIds); else ids.push(...childIds);
              return true;   // parent를 바꿨으므로 더 돌지 않는다
            });
          }
        });
        set({ selection: ids });
        return { ok: true };
      },
    };
  });
}

export type EditorStore = ReturnType<typeof createEditorStore>;
export const EditorContext = createContext<EditorStore | null>(null);
export function useEditor<T>(selector: (s: EditorState) => T): T {
  const store = useContext(EditorContext);
  if (!store) throw new Error("EditorContext missing");
  return useStore(store, selector);
}
