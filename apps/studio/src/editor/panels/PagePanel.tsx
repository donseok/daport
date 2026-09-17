"use client";
import { useEffect, useState } from "react";
import type { Preset } from "@daport/core";
import { OutputSchema } from "@daport/core";
import { useEditor } from "../store";
import { NumberField, TextField, CheckField, Field } from "./Field";
import { defaultSource } from "./ElementPalette";
import { OutputPanel } from "./OutputPanel";
import { BUILTIN_PRESETS } from "@/lib/presets";

const samePage = (a: Preset["page"], b: Preset["page"]) => a.width === b.width && a.height === b.height && a.margin.every((m, i) => m === b.margin[i]);

/** 페이지 크기·프리셋·반복·출력 설정 (스펙 4.3, 7.1, 7.2). 프리셋 목록 = 내장(동기) + 사용자 정의(API) */
export function PagePanel() {
  const report = useEditor((s) => s.report);
  const page = report.page;
  const updatePage = useEditor((s) => s.updatePage);
  const applyPreset = useEditor((s) => s.applyPreset);
  const repeat = useEditor((s) => s.report.repeat);
  const setRepeat = useEditor((s) => s.setRepeat);
  const [userPresets, setUserPresets] = useState<Preset[]>([]);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const componentMode = useEditor((s) => s.componentMode);

  const refresh = async () => {
    try {
      const r = await fetch("/api/presets");
      if (!r.ok) { setError("프리셋 목록을 불러오지 못했습니다"); return; }
      const list = (await r.json()) as Preset[];
      setUserPresets(list.filter((p) => !p.builtin));
      setError(null);
    } catch { setError("프리셋 목록을 불러오지 못했습니다"); }   // 목록을 못 받아도 내장 프리셋은 쓸 수 있다
  };
  // 컴포넌트 편집 화면에는 프리셋 UI가 없으므로 목록을 요청하지 않는다
  const inComponentMode = !!componentMode;   // 입력값을 고칠 때마다 componentMode 객체가 바뀌므로 모드 여부만 의존한다
  useEffect(() => { if (!inComponentMode) void refresh(); }, [inComponentMode]);

  const presets = [...BUILTIN_PRESETS, ...userPresets];
  // 크기·여백·출력이 모두 같은 프리셋만 "선택됨"으로 본다.
  // output은 필드 순서가 달라도(예: patch 병합 순서) 같은 값이면 같은 프리셋으로 인식하도록
  // 비교 전에 OutputSchema로 정규화해 JSON.stringify의 키 순서 의존성을 없앤다.
  const normalizeOutput = (o: Preset["output"]) => JSON.stringify(OutputSchema.parse(o));
  const current = presets.find((p) => samePage(p.page, page) && normalizeOutput(p.output) === normalizeOutput(report.output))?.id ?? "custom";
  const labelOf = (id: string) => (id === "custom" ? "사용자 정의" : presets.find((p) => p.id === id)!.name);

  const save = async () => {
    setError(null);
    const r = await fetch("/api/presets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: newId, name: newName, page, output: report.output }) });
    if (!r.ok) { setError(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `저장 실패 (HTTP ${r.status})`); return; }
    setNewId(""); setNewName("");
    await refresh();
  };
  const remove = async () => {
    const r = await fetch(`/api/presets/${encodeURIComponent(current)}`, { method: "DELETE" });
    if (!r.ok) { setError(`삭제 실패 (HTTP ${r.status})`); return; }
    await refresh();
  };
  const btn = "text-xs border rounded px-2 py-1 bg-white hover:bg-neutral-100 disabled:opacity-50";

  // 스펙 7.5: 페이지 너비·높이가 곧 컴포넌트 w·h다. 여백·프리셋·출력·반복은 컴포넌트 내용에 저장되지 않으므로 보이지 않는다
  if (componentMode) {
    return (
      <div className="p-3 flex flex-col gap-2">
        <div className="text-xs font-semibold">컴포넌트 크기</div>
        <NumberField label="너비(mm)" value={page.width} onChange={(width) => { if (width > 0) updatePage({ width }); }} />
        <NumberField label="높이(mm)" value={page.height} onChange={(height) => { if (height > 0) updatePage({ height }); }} />
      </div>
    );
  }

  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="text-xs font-semibold">페이지</div>
      <Field label="프리셋">
        <select aria-label="프리셋" value={current} className="w-full border rounded px-1 py-0.5"
          onChange={(e) => { const p = presets.find((x) => x.id === e.target.value); if (p) applyPreset(p); }}>
          <option value="custom">{labelOf("custom")}</option>
          <optgroup label="내장">
            {BUILTIN_PRESETS.map((p) => <option key={p.id} value={p.id}>{labelOf(p.id)}</option>)}
          </optgroup>
          <optgroup label="사용자 정의">
            {userPresets.map((p) => <option key={p.id} value={p.id}>{labelOf(p.id)}</option>)}
          </optgroup>
        </select>
      </Field>
      {userPresets.some((p) => p.id === current) && <button className={btn + " self-start"} onClick={remove}>프리셋 삭제</button>}
      <NumberField label="너비(mm)" value={page.width} onChange={(width) => { if (width > 0) updatePage({ width }); }} />
      <NumberField label="높이(mm)" value={page.height} onChange={(height) => { if (height > 0) updatePage({ height }); }} />
      <details className="text-xs">
        <summary className="cursor-pointer text-neutral-600">현재 설정을 프리셋으로 저장</summary>
        <div className="flex flex-col gap-1 mt-1">
          <TextField label="새 프리셋 id" value={newId} onChange={setNewId} />
          <TextField label="새 프리셋 이름" value={newName} onChange={setNewName} />
          <button className={btn + " self-start"} disabled={!newId || !newName} onClick={save}>프리셋으로 저장</button>
          {error && <div className="text-red-700">{error}</div>}
        </div>
      </details>

      <OutputPanel />

      <div className="text-xs font-semibold mt-2">반복</div>
      <CheckField label="레코드마다 한 부씩" value={!!repeat} onChange={(on) => setRepeat(on ? { source: defaultSource(report), as: "record" } : undefined)} />
      {/* RepeatSchema.source는 min(1) — TablePanel·RepeaterPanel의 소스 필드와 같은 규칙으로 빈 값은 커밋하지 않는다 */}
      {repeat && <TextField label="반복 소스" value={repeat.source} onChange={(v) => { if (v.trim() !== "") setRepeat({ ...repeat, source: v }); }} />}
    </div>
  );
}
