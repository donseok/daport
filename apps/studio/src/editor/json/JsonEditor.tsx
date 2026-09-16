"use client";
import { useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useEditor } from "../store";
import { shouldPushToEditor, parseEditorText, toEditorText } from "./sync";

export function JsonEditor() {
  const report = useEditor((s) => s.report);
  const replaceReport = useEditor((s) => s.replaceReport);
  const problems = useEditor((s) => s.problems);
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 스토어 → 편집기
  useEffect(() => {
    const ed = editorRef.current; if (!ed) return;
    const text = ed.getValue();
    if (shouldPushToEditor(text, report)) ed.setValue(toEditorText(report));
  }, [report]);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.setValue(toEditorText(report));
    fetch("/api/schema").then((r) => r.json()).then((schema) => {
      monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: true, schemas: [{ uri: "daport://report", fileMatch: ["*"], schema }] });
    });
  };

  // 편집기 → 스토어 (디바운스)
  const onChange = (value?: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = parseEditorText(value ?? "");
      if (!r.ok) { setSyntaxError(r.message); return; }
      setSyntaxError(null);
      replaceReport(r.value);
    }, 400);
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
