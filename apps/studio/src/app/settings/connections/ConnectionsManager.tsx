"use client";
import { useCallback, useEffect, useState } from "react";

type Row = { name: string; via: "direct" | "agent"; host?: string; port?: number; service?: string; user?: string; url?: string; secretRef: string; secretConfigured: boolean; usedBy: string[] };
type Form = { name: string; via: "direct" | "agent"; host: string; port: string; service: string; user: string; url: string; secretRef: string };
const empty: Form = { name: "", via: "direct", host: "", port: "1521", service: "", user: "", url: "", secretRef: "" };
const target = (r: Row) => (r.via === "direct" ? `${r.host}:${r.port}/${r.service}` : r.url ?? "");

async function failureMessage(r: Response, label: string): Promise<string> {
  const body = (await r.json().catch(() => null)) as { error?: string; code?: string; reports?: string[] } | null;
  if (body?.code === "CONNECTION_IN_USE") return `사용 중인 레포트가 있어 삭제할 수 없습니다: ${(body.reports ?? []).join(", ")}`;
  return typeof body?.error === "string" ? body.error : `${label} 실패 (HTTP ${r.status})`;
}

/** 연결 관리 (4b 스펙 7.1): 목록·테스트·삭제·추가/수정 */
export function ConnectionsManager() {
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState<Form>(empty);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});
  const refresh = useCallback(async () => {
    const r = await fetch("/api/connections", { method: "GET" });
    if (r.ok) setRows((await r.json()) as Row[]);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const note = (name: string, text: string) => setResults((s) => ({ ...s, [name]: text }));

  const save = async () => {
    const body = form.via === "direct"
      ? { name: form.name, via: "direct", host: form.host, port: Number(form.port), service: form.service, user: form.user, secretRef: form.secretRef }
      : { name: form.name, via: "agent", url: form.url, secretRef: form.secretRef };
    setBusy(true);
    try {
      const r = await fetch(`/api/connections/${encodeURIComponent(form.name)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { alert(await failureMessage(r, "저장")); return; }
      setForm(empty); await refresh();
    } finally { setBusy(false); }
  };
  const test = async (name: string) => {
    note(name, "테스트 중…");
    const r = await fetch(`/api/connections/${encodeURIComponent(name)}/test`, { method: "POST" });
    const body = (await r.json().catch(() => null)) as { ok?: boolean; elapsedMs?: number; error?: { message?: string } | string; code?: string } | null;
    if (r.ok && body?.ok) note(name, `OK (${body.elapsedMs}ms)`);
    else note(name, `실패: ${typeof body?.error === "string" ? body.error : body?.error?.message ?? `HTTP ${r.status}`}`);
  };
  const remove = async (name: string) => {
    if (!window.confirm(`연결 "${name}"을(를) 삭제할까요?`)) return;
    const r = await fetch(`/api/connections/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (r.status === 204) { await refresh(); return; }
    note(name, await failureMessage(r, "삭제"));
  };
  const edit = (r: Row) => setForm({ name: r.name, via: r.via, host: r.host ?? "", port: String(r.port ?? 1521), service: r.service ?? "", user: r.user ?? "", url: r.url ?? "", secretRef: r.secretRef });
  const btn = "text-xs border rounded px-2 py-1 bg-white hover:bg-neutral-100 disabled:opacity-50";
  const field = (label: string, key: keyof Form, type = "text") => (
    <label className="text-xs flex flex-col">{label}<input aria-label={label} type={type} className="border rounded px-2 py-1" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>
  );
  return (
    <div className="flex flex-col gap-4">
      <table className="w-full text-sm bg-white border rounded">
        <thead><tr className="text-left border-b"><th className="p-2">이름</th><th className="p-2">방식</th><th className="p-2">대상</th><th className="p-2">비밀값</th><th className="p-2">사용처</th><th className="p-2"></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} data-testid={`conn-${r.name}`} className="border-b align-top">
              <td className="p-2 font-mono">{r.name}</td><td className="p-2">{r.via}</td><td className="p-2">{target(r)}</td>
              <td className="p-2">{r.secretRef} {r.secretConfigured ? <span className="text-green-700">설정됨</span> : <span className="text-amber-700">미설정</span>}</td>
              <td className="p-2">{r.usedBy.length}</td>
              <td className="p-2 flex gap-1">
                <button name="test" className={btn} onClick={() => test(r.name)}>테스트</button>
                <button name="edit" className={btn} onClick={() => edit(r)}>수정</button>
                <button name="delete" className={btn} onClick={() => remove(r.name)}>삭제</button>
                {results[r.name] && <span data-testid={`test-${r.name}`} className="text-xs">{results[r.name]}</span>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="p-2 text-neutral-500" colSpan={6}>연결이 없습니다</td></tr>}
        </tbody>
      </table>
      <div className="border rounded p-3 bg-white flex flex-col gap-2">
        <div className="text-sm font-semibold">연결 추가 / 수정</div>
        <div className="grid grid-cols-2 gap-2">
          {field("이름", "name")}
          <label className="text-xs flex flex-col">방식<select aria-label="방식" className="border rounded px-2 py-1" value={form.via} onChange={(e) => setForm({ ...form, via: e.target.value as Form["via"] })}><option value="direct">direct (oracledb)</option><option value="agent">agent (중계)</option></select></label>
          {form.via === "direct" ? <>{field("호스트", "host")}{field("포트", "port", "number")}{field("서비스", "service")}{field("사용자", "user")}</> : field("URL", "url")}
          {field("비밀값 이름", "secretRef")}
        </div>
        <div className="text-xs text-neutral-500">서버 환경변수 <code>DAPORT_SECRET_{form.secretRef || "<이름>"}</code>에 {form.via === "direct" ? "비밀번호" : "에이전트 토큰"}을 넣으세요.</div>
        <div><button className={btn} disabled={busy || !form.name} onClick={save}>연결 저장</button></div>
      </div>
    </div>
  );
}
