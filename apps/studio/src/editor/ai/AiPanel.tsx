"use client";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "../store";
import { postAi } from "./api";
import { proposalFromEdit, proposalFromGenerate, type Proposal } from "./proposal";

type EditResponse = Parameters<typeof proposalFromEdit>[1];
type GenerateResponse = Parameters<typeof proposalFromGenerate>[1];

// "cancelled"는 사용자가 요청을 취소했을 때만 붙는 조용한 턴이다. history에는 user·assistant만 실어 보내므로
// 취소 턴은 다음 요청의 history에 절대 섞이지 않는다
type Turn = { role: "user" | "assistant" | "error" | "cancelled"; text: string; warnings?: string[] };

const HISTORY_LIMIT = 6;

/** 대화 턴 하나. 오류는 빨간 글씨로, 경고는 턴 안에 목록으로 덧붙인다. 취소 턴은 접두어 없이 옅은 글씨로만 표시한다 */
function TurnView({ turn }: { turn: Turn }) {
  if (turn.role === "cancelled") return <div data-testid="ai-turn" className="text-xs text-neutral-400 italic">{turn.text}</div>;
  return (
    <div data-testid="ai-turn" className={`text-xs whitespace-pre-wrap ${turn.role === "user" ? "text-neutral-900" : turn.role === "error" ? "text-red-600" : "text-neutral-700"}`}>
      <span className="font-semibold">{turn.role === "user" ? "나" : turn.role === "error" ? "오류" : "AI"}: </span>
      {turn.text}
      {turn.warnings && turn.warnings.length > 0 && (
        <ul className="list-disc pl-4 text-amber-600">{turn.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}
    </div>
  );
}

/** 하단 AI 탭 (스펙 6.2). 지시·선택 요소·대화 히스토리를 서버로 보내 제안을 만든다. 제안 자체의 적용·거절은 캔버스 오버레이가 맡는다 */
export function AiPanel({ reportId }: { reportId: string }) {
  const report = useEditor((s) => s.report);
  const selection = useEditor((s) => s.selection);
  const setProposal = useEditor((s) => s.setProposal);
  const isEmpty = report.elements.length === 0;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [generateMode, setGenerateMode] = useState(() => isEmpty);
  const controllerRef = useRef<AbortController | null>(null);
  // 언마운트로 인한 abort는 조용한 취소 턴도 남기지 않는다 — catch·finally에서 상태를 건드리기 전에 이 값을 먼저 확인한다
  const mountedRef = useRef(true);

  // 요소가 생기면(제안 적용 등) 생성 모드는 더 이상 의미가 없으므로 끄고, 토글도 숨긴다
  useEffect(() => { if (!isEmpty && generateMode) setGenerateMode(false); }, [isEmpty, generateMode]);

  // 패널이 사라지면 진행 중인 요청은 취소한다. mountedRef를 먼저 내려서, 이후 도착하는 abort 거부가
  // 사라진 컴포넌트에 setState를 걸지 않게 한다(사용자가 누른 취소와 달리 조용한 턴도 남기지 않는다)
  // 개발 모드 StrictMode는 마운트 → 클린업 → 재마운트를 같은 인스턴스에서 한 번 더 돌리므로,
  // 본문에서 매번 true로 되돌리지 않으면 그 첫 클린업이 내린 false가 실제로는 계속 마운트된 상태에서도 영영 남는다
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; controllerRef.current?.abort(); };
  }, []);

  const send = async () => {
    const instruction = input.trim();
    if (!instruction || busy) return;
    const kind = isEmpty && generateMode ? "generate" : "edit";
    const history = turns.filter((t) => t.role === "user" || t.role === "assistant").slice(-HISTORY_LIMIT).map((t) => ({ role: t.role, text: t.text }));
    setTurns((prev) => [...prev, { role: "user", text: instruction }]);
    setInput("");
    setNotConfigured(false);
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    try {
      if (kind === "edit") {
        const res = await postAi<EditResponse>(reportId, "edit", { instruction, selection, history, report }, controller.signal);
        handleResult(res, (data) => proposalFromEdit(report, data));
      } else {
        const res = await postAi<GenerateResponse>(reportId, "generate", { brief: instruction, report }, controller.signal);
        handleResult(res, (data) => proposalFromGenerate(report, data));
      }
    } catch (e) {
      if (!mountedRef.current) return;   // 언마운트가 일으킨 abort — 사라진 패널에 턴을 남기지 않는다
      if (e instanceof Error && e.name === "AbortError") setTurns((prev) => [...prev, { role: "cancelled", text: "취소됨" }]);
      else setTurns((prev) => [...prev, { role: "error", text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      controllerRef.current = null;
      if (mountedRef.current) setBusy(false);
    }
  };

  function handleResult<T extends { explanation: string; warnings: string[] }>(res: Awaited<ReturnType<typeof postAi<T>>>, toProposal: (data: T) => Proposal) {
    if (!mountedRef.current) return;   // 응답이 오는 동안 패널이 사라졌으면 아무 상태도 건드리지 않는다
    if (res.ok) {
      try {
        const proposal = toProposal(res.data);
        // 요청이 오가는 동안 다른 편집이 있었으면(base가 지금 report와 다르면) 스토어가 저장을 거절한다
        if (!setProposal(proposal)) {
          setTurns((prev) => [...prev, { role: "error", text: "편집 중 레포트가 바뀌어 제안을 버렸습니다. 다시 요청하세요." }]);
          return;
        }
        setTurns((prev) => [...prev, { role: "assistant", text: res.data.explanation, warnings: res.data.warnings }]);
      } catch (e) {
        setTurns((prev) => [...prev, { role: "error", text: e instanceof Error ? e.message : String(e) }]);
      }
      return;
    }
    if (res.code === "AI_NOT_CONFIGURED") { setNotConfigured(true); return; }
    setTurns((prev) => [...prev, { role: "error", text: res.message }]);
  }

  const cancel = () => controllerRef.current?.abort();

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || busy) return;
    e.preventDefault();
    void send();
  };

  return (
    <div className="h-full flex flex-col text-xs">
      <div className="flex-1 overflow-auto p-2 flex flex-col gap-1" aria-live="polite">
        {turns.map((t, i) => <TurnView key={i} turn={t} />)}
      </div>
      {notConfigured && (
        <div data-testid="ai-not-configured" className="mx-2 mb-1 rounded bg-amber-50 border border-amber-300 px-2 py-1 text-amber-800">
          서버에 GEMINI_API_KEY를 설정하세요
        </div>
      )}
      <div className="border-t p-2 flex flex-col gap-1">
        {selection.length > 0 && (
          <div data-testid="ai-selection" className="text-neutral-500">선택: {selection.join(", ")}</div>
        )}
        {isEmpty && (
          <label className="flex items-center gap-1 text-neutral-500">
            <input type="checkbox" data-testid="ai-generate-mode" checked={generateMode} disabled={busy} onChange={(e) => setGenerateMode(e.target.checked)} />
            생성 모드 (빈 레포트)
          </label>
        )}
        <textarea aria-label="AI 지시" className="w-full border rounded px-1 py-0.5 resize-none" rows={2}
          value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} disabled={busy} />
        <div className="flex justify-end">
          {busy
            ? <button type="button" className="px-2 py-0.5 rounded border hover:bg-neutral-100" onClick={cancel}>취소</button>
            : <button type="button" data-testid="ai-send" className="px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50" disabled={!input.trim()} onClick={() => void send()}>보내기</button>}
        </div>
      </div>
    </div>
  );
}
