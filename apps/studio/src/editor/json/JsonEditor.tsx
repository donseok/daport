"use client";
import { useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useEditor } from "../store";
import { decideSync, parseEditorText, toEditorText } from "./sync";

type CodeEditor = Parameters<OnMount>[0];

export function JsonEditor() {
  const report = useEditor((s) => s.report);
  const replaceReport = useEditor((s) => s.replaceReport);
  const problems = useEditor((s) => s.problems);
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const editorRef = useRef<CodeEditor | null>(null);
  /** 편집기 → 스토어 디바운스. 대기 중인 입력이 있을 때만 값이 있다 */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 스토어 텍스트를 편집기에 넣는 중이면 true. 그때 오는 onChange는 사용자 입력이 아니다 */
  const applyingStoreText = useRef(false);
  // @monaco-editor/react는 첫 렌더의 onMount만 기억해 Monaco 로드 후 호출한다. 그 클로저의 report는 첫 렌더 값이라,
  // 로드 중에 한 캔버스 편집이 편집기에 빠진 채 다음 JSON 편집으로 되돌려진다. 마운트 시점의 최신 report를 ref로 읽는다
  const reportRef = useRef(report);
  reportRef.current = report;

  const commitEditorText = (text: string) => {
    const r = parseEditorText(text);
    if (!r.ok) { setSyntaxError(r.message); return; }
    setSyntaxError(null);
    replaceReport(r.value);
  };
  const cancelPending = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

  /** setValue는 커서를 1:1로 옮기고 undo 기록을 지우므로, 전체 범위 편집으로 바꾸고 뷰 상태(커서·스크롤)를 되돌린다 */
  const pushToEditor = (ed: CodeEditor, text: string) => {
    const model = ed.getModel(); if (!model) return;
    const view = ed.saveViewState();
    applyingStoreText.current = true;
    try {
      model.pushStackElement();
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
      model.pushStackElement();
    } finally {
      applyingStoreText.current = false;
    }
    ed.restoreViewState(view);
  };

  // 스토어 → 편집기
  useEffect(() => {
    const ed = editorRef.current; if (!ed) return;
    const text = ed.getValue();
    const action = decideSync({ pendingEdit: timer.current !== null, editorText: text, report });
    // flush가 스토어를 바꾸면 이 효과가 다시 돌아 그때 동기화한다. 구문·검증 오류면 입력 중인 텍스트를 그대로 둔다
    if (action === "flush") { cancelPending(); commitEditorText(text); }
    else if (action === "push") pushToEditor(ed, toEditorText(report));
  }, [report]);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    if (process.env.NODE_ENV !== "production") (window as any).monaco = monaco;   // E2E가 편집기 모델을 직접 읽고 쓴다 (Monaco는 보이는 줄만 DOM에 그린다)
    applyingStoreText.current = true;
    try { editor.setValue(toEditorText(reportRef.current)); } finally { applyingStoreText.current = false; }   // 초기 내용은 undo 대상이 아니다
    fetch("/api/schema").then((r) => r.json()).then((schema) => {
      monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: true, schemas: [{ uri: "daport://report", fileMatch: ["*"], schema }] });
    });
  };

  // 편집기 → 스토어 (디바운스)
  const onChange = (value?: string) => {
    if (applyingStoreText.current) return;
    cancelPending();
    timer.current = setTimeout(() => { timer.current = null; commitEditorText(value ?? ""); }, 400);
  };

  return (
    <div className="flex flex-col h-full">
      <Editor height="100%" defaultLanguage="json" path="report.json" onMount={onMount} onChange={onChange}
        options={{ minimap: { enabled: false }, fontSize: 12, tabSize: 2, automaticLayout: true }} />
      {(syntaxError || problems.length > 0) && (
        <div className="max-h-24 overflow-auto border-t bg-red-50 text-red-700 text-xs p-2">
          {syntaxError && <div>{syntaxError}</div>}
          {problems.map((p, i) => <div key={i}>{p.path}: {p.message}</div>)}
        </div>
      )}
    </div>
  );
}
