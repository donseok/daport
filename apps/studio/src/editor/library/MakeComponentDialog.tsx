"use client";
import { useContext, useState } from "react";
import { COMPONENT_ID_RE, sameParent, extractComponent, type Report } from "@daport/core";
import { EditorContext, useEditor } from "../store";
import { createComponent } from "./api";

export const EMPTY_SELECTION_REASON = "컴포넌트로 만들 요소를 선택하세요";
export const COMPONENT_MODE_REASON = "컴포넌트 편집 화면에서는 컴포넌트를 만들 수 없습니다";
const NAME_REQUIRED = "이름을 입력하세요";
const ID_INVALID = "id는 영문 소문자·숫자로 시작하고 영문 소문자·숫자·-만 쓸 수 있습니다";
/** 스펙 7.3 조건: 같은 부모 배열, ref 없음, 반복 영역 템플릿·밴드 밖 */
const MAKE_OPTS = { allowInTemplate: false, allowRefs: false } as const;

/** 이름에서 컴포넌트 id를 제안한다. 악센트는 떼고, 영문 소문자·숫자가 아닌 연속 구간은 -, 앞뒤 -는 버린다. 남는 것이 없으면 "component" */
export function suggestComponentId(name: string): string {
  const slug = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug && COMPONENT_ID_RE.test(slug) ? slug : "component";
}

/** 툴바 버튼·우클릭 메뉴의 활성 여부와 비활성 사유(툴팁) */
export function makeComponentCheck(report: Report, selection: string[], componentMode: boolean): { ok: true } | { ok: false; reason: string } {
  if (componentMode) return { ok: false, reason: COMPONENT_MODE_REASON };
  if (selection.length === 0) return { ok: false, reason: EMPTY_SELECTION_REASON };
  const info = sameParent(report.elements, selection, MAKE_OPTS);
  return "error" in info ? { ok: false, reason: info.error } : { ok: true };
}

/**
 * 선택 영역 → 컴포넌트 (스펙 7.3). 라이브러리에 버전 1을 만든 뒤에만 캔버스를 바꾼다.
 * 등록 실패 시 스토어는 건드리지 않고 서버 오류를 대화상자에 보인다. 라이브러리 등록은 되돌리기 대상이 아니다
 */
export function MakeComponentDialog({ onClose }: { onClose: () => void }) {
  const store = useContext(EditorContext)!;
  const [name, setName] = useState("");
  const [id, setId] = useState(suggestComponentId(""));
  const [idEdited, setIdEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 대화상자가 열린 동안에도 선택이 바뀔 수 있어 구독한다(제출 시 다시 검사)
  useEditor((s) => s.selection);

  const nameError = name.trim() === "" ? NAME_REQUIRED : null;
  const idError = COMPONENT_ID_RE.test(id) ? null : ID_INVALID;

  const onName = (v: string) => { setName(v); if (!idEdited) setId(suggestComponentId(v)); };
  const onId = (v: string) => { setId(v); setIdEdited(true); };

  const submit = async () => {
    if (nameError || idError || busy) return;
    // 등록은 되돌릴 수 없으므로, 조건이 안 맞으면(그 사이 선택이 바뀌었을 수도 있다) 서버를 부르기 전에 멈춘다
    const { report, selection, componentMode } = store.getState();
    const check = makeComponentCheck(report, selection, !!componentMode);
    if (!check.ok) { setError(check.reason); return; }
    const info = sameParent(report.elements, selection, MAKE_OPTS);
    if ("error" in info) { setError(info.error); return; }
    const ids = [...selection];
    const { body, box } = extractComponent(info.parent, ids, name.trim());
    setBusy(true); setError(null);
    try {
      const created = await createComponent(id, body);
      store.getState().replaceWithComponent(ids, id, created.version, body, box);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const btn = "text-xs border rounded px-3 py-1 bg-white hover:bg-neutral-100 disabled:opacity-50";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div role="dialog" aria-modal="true" aria-label="컴포넌트 만들기" className="bg-white rounded shadow-lg p-4 w-80 flex flex-col gap-2 text-xs">
        <div className="font-semibold text-sm">컴포넌트 만들기</div>
        <label className="flex flex-col gap-1">이름
          <input aria-label="이름" autoFocus className="border rounded px-1 py-0.5" value={name} onChange={(e) => onName(e.target.value)} />
        </label>
        {nameError && <div className="text-red-700">{nameError}</div>}
        <label className="flex flex-col gap-1">id
          <input aria-label="id" className="border rounded px-1 py-0.5 font-mono" value={id} onChange={(e) => onId(e.target.value)} />
        </label>
        {idError && <div className="text-red-700">{idError}</div>}
        {error && <div role="alert" className="text-red-700 whitespace-pre-wrap">{error}</div>}
        <div className="flex justify-end gap-2 mt-2">
          <button className={btn} onClick={onClose} disabled={busy}>취소</button>
          <button className={btn} onClick={submit} disabled={busy || !!nameError || !!idError}>만들기</button>
        </div>
      </div>
    </div>
  );
}
