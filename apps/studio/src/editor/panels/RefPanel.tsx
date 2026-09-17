"use client";
import { useEffect, useState, type ReactNode } from "react";
import { componentKey, refsTo, type ComponentProp, type Element } from "@daport/core";
import { useEditor } from "../store";
import { fetchComponent } from "../library/api";
import { sizeChangeNotice } from "../library/sizeNotice";

type RefElement = Extract<Element, { type: "ref" }>;
type PropValue = string | number | boolean;

const btn = "text-xs border rounded px-1 bg-white hover:bg-neutral-100";
const input = "w-full border rounded px-1 py-0.5";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const NUMBER_LITERAL = /^-?\d+(\.\d+)?$/;

/** 입력값 한 칸. string·number·image는 템플릿 입력, boolean은 체크박스(토글로 템플릿 입력) (스펙 7.2) */
function PropField({ decl, value, onChange }: { decl: ComponentProp; value: PropValue | undefined; onChange: (v: PropValue | undefined) => void }) {
  const [forceTemplate, setForceTemplate] = useState(false);
  const aria = `입력값 ${decl.name}`;
  const label = decl.label ? `${decl.label} (${decl.name})` : decl.name;
  const text = typeof value === "string" ? value : value === undefined ? "" : String(value);
  // 빈 문자열은 값 삭제(기본값 사용)
  const onText = (v: string) => {
    if (v === "") onChange(undefined);
    else if (decl.type === "number" && NUMBER_LITERAL.test(v.trim())) onChange(Number(v));
    else onChange(v);
  };
  const textInput = (placeholder: string) =>
    <input aria-label={aria} type="text" value={text} placeholder={placeholder} className={input} onChange={(e) => onText(e.target.value)} />;

  let control: ReactNode;
  if (decl.type === "boolean") {
    const templated = forceTemplate || typeof value === "string";
    control = <>
      {templated
        ? textInput(String(value ?? decl.default))
        : <input aria-label={aria} type="checkbox" checked={typeof value === "boolean" ? value : decl.default} onChange={(e) => onChange(e.target.checked)} />}
      <button aria-label={`${aria} 템플릿 전환`} title={templated ? "체크박스로" : "템플릿으로"} className={btn}
        onClick={() => {
          // 체크박스로 돌아갈 때 템플릿 문자열은 체크박스로 나타낼 수 없으므로 지운다
          if (templated && typeof value === "string") onChange(undefined);
          setForceTemplate(!templated);
        }}>{"{ }"}</button>
      {typeof value === "boolean" && <button aria-label={`${aria} 기본값`} className={btn} onClick={() => onChange(undefined)}>기본값</button>}
    </>;
  } else if (decl.type === "image") {
    control = textInput("asset://id 또는 URL");
  } else {
    control = textInput(String(decl.default));
  }
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-neutral-500 truncate" title={label}>{label}</span>
      {control}
    </div>
  );
}

/** 컴포넌트 인스턴스 속성: 이름·버전, 라이브러리 최신으로 업데이트, 입력값 (스펙 7.2). X·Y·visible·flow는 PropertyPanel이 그린다 */
export function RefPanel({ el }: { el: RefElement }) {
  const report = useEditor((s) => s.report);
  const updateElement = useEditor((s) => s.updateElement);
  const updateInstances = useEditor((s) => s.updateInstances);
  const key = componentKey(el.ref, el.version);
  const body = report.components[key];
  const [latest, setLatest] = useState<number | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // 라이브러리 최신 버전. 다른 컴포넌트의 인스턴스로 선택이 바뀌면 다시 묻는다
  useEffect(() => {
    let alive = true;
    setLatest(null); setLibraryError(null); setStatus(null);
    fetchComponent(el.ref).then(
      (d) => { if (alive) setLatest(d.summary.latestVersion); },
      (e) => { if (alive) setLibraryError(message(e)); },
    );
    return () => { alive = false; };
  }, [el.ref]);

  /** 누르는 시점의 최신 내용을 받아 이 레포트의 모든 인스턴스를 올린다(스토어 updateInstances, 되돌리기 1단위) */
  const update = async () => {
    setStatus(null);
    try {
      const d = await fetchComponent(el.ref);
      const version = d.summary.latestVersion;
      setLatest(version);
      if (version <= el.version) return;
      const notice = sizeChangeNotice(refsTo(report, el.ref), d.latest);
      if (notice && !window.confirm(notice)) return;
      updateInstances(el.ref, version, d.latest);
    } catch (e) {
      setStatus(`업데이트하지 못했습니다: ${message(e)}`);
    }
  };

  const setValue = (name: string, v: PropValue | undefined) => {
    const next = { ...el.props };
    if (v === undefined) delete next[name]; else next[name] = v;
    updateElement(el.id, { props: next } as Partial<Element>);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold mt-2">컴포넌트</div>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">{body?.name ?? el.ref}</span>
        <span className="text-neutral-500">{`v${el.version}`}</span>
      </div>
      {latest !== null && latest > el.version && (
        <button className={btn + " self-start"} onClick={() => void update()}>{`v${el.version} → v${latest} 업데이트`}</button>
      )}
      {latest !== null && latest <= el.version && <div className="text-xs text-neutral-400">라이브러리 최신</div>}
      {libraryError && <div className="text-xs text-amber-700">{`라이브러리에서 찾지 못했습니다: ${libraryError}`}</div>}
      {status && <div role="status" className="text-xs text-red-700">{status}</div>}
      <div className="text-xs text-neutral-400">더블클릭하면 컴포넌트 편집 화면이 새 탭으로 열립니다</div>
      {!body
        ? <div className="text-xs text-red-700">{`컴포넌트 내용이 없습니다: ${key}`}</div>
        : <>
          <div className="text-xs font-semibold mt-2">입력값</div>
          {body.props.length === 0 && <div className="text-xs text-neutral-400">선언된 입력값이 없습니다</div>}
          {body.props.map((decl) => (
            <PropField key={`${el.id}:${decl.name}`} decl={decl} value={el.props[decl.name]} onChange={(v) => setValue(decl.name, v)} />
          ))}
        </>}
    </div>
  );
}
