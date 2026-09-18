"use client";
import { useContext, useEffect, useMemo, useState } from "react";
import { requestBody } from "@/lib/data";
import { EditorContext, useEditor } from "./store";
import { PageSelector } from "./PageSelector";
import { MakeComponentDialog, makeComponentCheck } from "./library/MakeComponentDialog";
import { editReportToComponent, samplePropsContext } from "@/lib/component-edit";
import { saveComponent, fetchUsage, applyLatest } from "./library/api";
import type { Usage } from "@/lib/component-usage";
import { PublishControls } from "./PublishControls";
import { failureMessage } from "./failure-message";

/**
 * 레포트 저장 응답의 경고 헤더 (스펙 6.3). 값은 문자열의 JSON 배열이다.
 * 이 이름은 서버의 lib/report-guard.ts WARNINGS_HEADER와 같다. 그 모듈은 DB 저장소를 import하므로 클라이언트에서 가져오지 않는다
 */
const WARNINGS_HEADER = "X-Daport-Warnings";
function saveWarnings(r: Response): string[] {
  const raw = r.headers.get(WARNINGS_HEADER);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((w): w is string => typeof w === "string") : [];
  } catch {
    return [];   // 헤더가 깨져도 저장 성공은 그대로 둔다
  }
}

/** reportId는 열린 레포트의 id다. 편집 모델의 id가 아니라 이 값으로 요청 경로를 정해 다른 레포트를 덮어쓰지 않는다 */
export function Toolbar({ reportId, zoom, setZoom }: { reportId: string; zoom: number; setZoom: (z: number) => void }) {
  const store = useContext(EditorContext)!;
  const report = useEditor((s) => s.report);
  const dirty = useEditor((s) => s.dirty);
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const markSaved = useEditor((s) => s.markSaved);
  const pruneUnusedComponents = useEditor((s) => s.pruneUnusedComponents);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const liveData = useEditor((s) => s.liveData);
  const setLiveData = useEditor((s) => s.setLiveData);
  const bitmapPreview = useEditor((s) => s.bitmapPreview);
  const setBitmapPreview = useEditor((s) => s.setBitmapPreview);
  const selection = useEditor((s) => s.selection);
  const componentMode = useEditor((s) => s.componentMode);
  // 컴포넌트 편집 화면에서는 라벨·PDF 동작을 두지 않는다 (편집용 레포트의 출력 설정은 저장되지 않는다)
  const isLabel = report.output.kind === "label" && !componentMode;
  const sampleProps = componentMode ? samplePropsContext(componentMode) : undefined;
  // 스펙 7.3: 조건이 안 맞으면 비활성, 사유는 툴팁. 트리 전체를 훑으므로 관련 상태가 바뀔 때만 다시 검사한다
  const makeCheck = useMemo(() => makeComponentCheck(report, selection, !!componentMode), [report, selection, componentMode]);
  const [making, setMaking] = useState(false);
  /** 컴포넌트 저장 결과("v6 저장됨"·"변경 없음")와 저장 뒤 사용처 (스펙 7.5) */
  const [componentStatus, setComponentStatus] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage[] | null>(null);
  const [applying, setApplying] = useState(false);
  const [printers, setPrinters] = useState<string[]>([]);
  const [printer, setPrinter] = useState("");
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    // PDF 레포트에서는 인쇄 UI가 없으니 불필요한 요청을 만들지 않는다. 허용 목록이 비어 있으면 전송 UI를 두지 않는다 (스펙 7.3)
    if (!isLabel) return;
    fetch("/api/printers", { method: "GET" }).then((r) => (r.ok ? r.json() : [])).then((list: unknown) => {
      const names = Array.isArray(list) ? (list as { name: string }[]).map((p) => p.name) : [];
      setPrinters(names); setPrinter(names[0] ?? "");
    }).catch(() => setPrinters([]));
  }, [isLabel]);

  // PDF 렌더는 몇 초 걸릴 수 있으므로 저장과 따로 막는다
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  // 마지막 레포트 저장이 남긴 경고. 다음 저장을 시작하면 지운다
  const [warnings, setWarnings] = useState<string[]>([]);

  const save = async () => {
    // 스펙 7.2: 저장 전에 쓰이지 않는 컴포넌트 항목을 지운다(되돌리기 1단위). 서버도 같은 정리를 하므로, 여기서 안 지우면 클라이언트 모델만 달라진다
    pruneUnusedComponents();
    // 보낸 모델을 기억해 두고, 요청이 끝났을 때 그 사이 편집이 있으면 저장 안 됨(*)으로 남긴다
    const saved = store.getState().report;
    setSaving(true);
    setWarnings([]);
    try {
      const r = await fetch(`/api/reports/${encodeURIComponent(reportId)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(saved) });
      if (r.ok) { markSaved(saved); setWarnings(saveWarnings(r)); return; }
      alert(await failureMessage(r, "저장"));
    } catch (e) {
      alert(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };
  /** 컴포넌트 모드 저장: PUT /api/components/:id. 같은 내용이면 서버가 버전을 올리지 않는다(created: false) */
  const saveComponentVersion = async () => {
    const mode = store.getState().componentMode;
    if (!mode) return;
    const saved = store.getState().report;
    setSaving(true);
    setComponentStatus(null);
    try {
      const res = await saveComponent(mode.componentId, editReportToComponent(saved, mode.props));
      markSaved(saved);
      const now = store.getState().componentMode;
      if (now) {
        // 요청 중에 입력값 선언을 고쳤으면 그 변경은 저장되지 않았다. markSaved는 report만 비교하므로 여기서 dirty로 남긴다
        store.setState({ componentMode: { ...now, version: res.version }, ...(now.props !== mode.props ? { dirty: true } : {}) });
      }
      setComponentStatus(res.created ? `v${res.version} 저장됨` : "변경 없음");
      setUsage(await fetchUsage(mode.componentId).catch(() => null));
    } catch (e) {
      alert(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };
  const applyAll = async () => {
    const mode = store.getState().componentMode;
    if (!mode || !usage) return;
    if (!confirm(`${usage.length}개 레포트의 인스턴스를 v${mode.version}(최신)으로 올립니다. 계속할까요?`)) return;
    setApplying(true);
    try {
      const res = await applyLatest(mode.componentId);
      alert([`${res.updated.length}개 레포트에 적용했습니다`, ...res.skipped.map((s) => `건너뜀 ${s.reportId}: ${s.error}`)].join("\n"));
      setUsage(await fetchUsage(mode.componentId).catch(() => usage));
    } catch (e) {
      alert(`적용 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setApplying(false);
    }
  };
  /** 응답을 파일로 내려받는다 (PDF·라벨 공용). 파일 이름은 content-disposition, 없으면 fallback */
  const download = async (r: Response, fallback: string) => {
    const cd = r.headers.get("content-disposition") ?? "";
    const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallback;
    const url = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);   // 클릭 직후 바로 해제하면 일부 브라우저에서 다운로드가 시작되기 전에 URL이 사라진다
  };
  const pdf = async () => {
    setExporting(true);
    try {
      const r = await fetch(`/api/reports/${encodeURIComponent(reportId)}/pdf`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody(report, liveData, sampleProps)) });
      if (!r.ok) { alert(await failureMessage(r, "PDF")); return; }
      await download(r, `${report.name || report.id}.pdf`);
    } catch (e) {
      alert(`PDF 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };
  const label = async () => {
    setExporting(true);
    try {
      const r = await fetch(`/api/reports/${encodeURIComponent(reportId)}/label`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestBody(report, liveData, sampleProps)) });
      if (!r.ok) { alert(await failureMessage(r, "라벨")); return; }
      await download(r, `${report.id}.zpl`);
    } catch (e) { alert(`라벨 실패: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setExporting(false); }
  };
  const print = async () => {
    setPrinting(true);
    try {
      const r = await fetch("/api/print", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ printer, ...requestBody(report, liveData, sampleProps) }) });
      if (!r.ok) { alert(await failureMessage(r, "인쇄")); return; }
      const res = (await r.json()) as { printer: string; bytes: number; pages: number };
      alert(`${res.printer}로 ${res.pages}장(${res.bytes} bytes) 보냈습니다`);
    } catch (e) { alert(`인쇄 실패: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setPrinting(false); }
  };
  const btn = "text-xs border rounded px-2 py-1 bg-white hover:bg-neutral-100 disabled:opacity-50";
  return (
    <div className="relative flex items-center gap-2 px-3 py-2 border-b bg-white">
      <span className="font-semibold text-sm">{report.name || report.id}{dirty ? " *" : ""}</span>
      {componentMode && <span data-testid="component-version" className="text-xs text-neutral-500">{`v${componentMode.version} (저장하면 v${componentMode.version + 1})`}</span>}
      <button className={btn} onClick={undo}>되돌리기</button>
      <button className={btn} onClick={redo}>다시하기</button>
      <button className={btn} onClick={() => setMode(mode === "design" ? "preview" : "design")}>{mode === "design" ? "미리보기" : "디자인"}</button>
      <label className="text-xs ml-2">배율 <input type="range" min={0.25} max={3} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /> {Math.round(zoom * 100)}%</label>
      <PageSelector />
      <label className="text-xs flex items-center gap-1 ml-2"><input type="checkbox" aria-label="실데이터" checked={liveData} onChange={(e) => setLiveData(e.target.checked)} />실데이터</label>
      <button className={btn} disabled={!makeCheck.ok} title={makeCheck.ok ? undefined : makeCheck.reason} onClick={() => setMaking(true)}>컴포넌트로 만들기</button>
      {making && <MakeComponentDialog onClose={() => setMaking(false)} />}
      <div className="flex-1" />
      {isLabel && <>
        <label className="text-xs flex items-center gap-1"><input type="checkbox" aria-label="비트맵" checked={bitmapPreview} onChange={(e) => setBitmapPreview(e.target.checked)} />비트맵</label>
        {printers.length > 0 && <>
          <select aria-label="프린터" className="text-xs border rounded px-1 py-1" value={printer} onChange={(e) => setPrinter(e.target.value)}>{printers.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          <button className={btn} disabled={printing || !printer} onClick={print}>프린터로 보내기</button>
        </>}
        <button className={btn} disabled={exporting} onClick={label} data-testid="label-download">라벨 다운로드</button>
      </>}
      {!componentMode && <button className={btn} disabled={exporting} onClick={pdf}>PDF</button>}
      {!componentMode && <PublishControls reportId={reportId} />}
      {componentMode && componentStatus && <span data-testid="component-status" className="text-xs text-neutral-600">{componentStatus}</span>}
      {componentMode && usage && <>
        <span data-testid="component-usage" className="text-xs text-neutral-600">사용하는 레포트 {usage.length}개</span>
        <button className={btn} disabled={applying || usage.length === 0} onClick={applyAll}>모든 레포트에 최신 적용</button>
      </>}
      {warnings.length > 0 && (
        <span role="status" data-testid="save-warnings" className="text-xs text-amber-700 max-w-md truncate" title={warnings.join("\n")}>
          저장했지만 경고가 있습니다: {warnings.join(", ")}
        </span>
      )}
      <button className={btn} disabled={saving || !dirty} onClick={componentMode ? saveComponentVersion : save} data-testid="save">저장</button>
    </div>
  );
}
