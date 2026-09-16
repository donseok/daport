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
  // blur 구독은 onMount에서 한 번만 걸려 첫 렌더의 클로저를 잡는다. 렌더마다 최신 커밋 함수를 ref에 담아 그것을 부른다
  const commitRef = useRef(commitEditorText);
  commitRef.current = commitEditorText;
  const cancelPending = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

  /**
   * setValue는 커서를 1:1로 옮기고 undo 기록을 지우므로, 전체 범위 편집으로 바꾸고 뷰 상태(커서·스크롤)를 되돌린다.
   * undo 기록에 편집 전·후 선택을 남겨 편집기 안에서 Ctrl+Z로 되돌려도 커서가 제자리에 온다
   */
  const pushToEditor = (ed: CodeEditor, text: string) => {
    const model = ed.getModel(); if (!model) return;
    const view = ed.saveViewState();
    const selections = ed.getSelections() ?? [];
    applyingStoreText.current = true;
    try {
      model.pushStackElement();
      model.pushEditOperations(selections, [{ range: model.getFullModelRange(), text }], () => selections);
      model.pushStackElement();
    } finally {
      applyingStoreText.current = false;
    }
    ed.restoreViewState(view);
    setSyntaxError(null);   // 깨진 텍스트가 스토어 텍스트(늘 올바른 JSON)로 바뀌었으니 그 텍스트의 구문 오류도 지운다
  };

  // 스토어 → 편집기
  useEffect(() => {
    const ed = editorRef.current; if (!ed) return;
    const text = ed.getValue();
    const action = decideSync({ pendingEdit: timer.current !== null, editorText: text, report });
    // flush가 스토어를 바꾸면 이 효과가 다시 돌아 그때 동기화한다. 구문·검증 오류면 입력 중인 텍스트를 그대로 둔다.
    // 그때 방금 온 스토어 변경은 편집기에 보이지 않고, 나중에 고친 텍스트가 커밋되면 그 변경은 덮인다(되돌리기로 되찾는다).
    // 이 효과는 스토어 변경이 커밋된 뒤에 돌므로 flush한 입력이 그 변경을 덮는다(되돌리기로 되찾는다). 편집기 밖을 누르면
    // 아래 blur 구독이 먼저 커밋하므로, 여기까지 오는 것은 편집기가 포커스를 가진 채 스토어가 바뀐 드문 경우다
    if (action === "flush") { cancelPending(); commitEditorText(text); }
    else if (action === "push") pushToEditor(ed, toEditorText(report));
  }, [report]);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    if (process.env.NODE_ENV !== "production") (window as any).monaco = monaco;   // E2E가 편집기 모델을 직접 읽고 쓴다 (Monaco는 보이는 줄만 DOM에 그린다)
    // onChange가 이미 구독돼 있더라도 초기 내용 채우기를 사용자 입력으로 세지 않게 한다
    applyingStoreText.current = true;
    try { editor.setValue(toEditorText(reportRef.current)); } finally { applyingStoreText.current = false; }
    // 캔버스·팔레트·툴바·패널을 누르면 그 변경보다 mousedown의 포커스 이동이 먼저 온다. 대기 중인 입력을 그때 커밋해야
    // 뒤이은 변경이 입력 위에 쌓이고, 입력이 그 변경을 덮지 않는다
    editor.onDidBlurEditorText(() => { if (timer.current) { cancelPending(); commitRef.current(editor.getValue()); } });
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
