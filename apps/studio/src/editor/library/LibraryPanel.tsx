"use client";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { refsTo } from "@daport/core";
import type { ComponentSummary } from "@/lib/component-store";
import type { Usage } from "@/lib/component-usage";
import { useEditor } from "../store";
import { COMPONENT_MIME, fetchComponents, fetchComponent, fetchUsage, applyLatest, deleteComponent } from "./api";
import { sizeChangeNotice } from "./sizeNotice";

const btn = "text-xs border rounded px-2 py-1 bg-white hover:bg-neutral-100 disabled:opacity-50";
const item = "text-left text-xs px-2 py-1 hover:bg-neutral-100 disabled:opacity-40 disabled:hover:bg-transparent";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 컴포넌트 라이브러리: 목록, 캔버스로 끌어다 놓기, 항목 메뉴 (스펙 7.1) */
export function LibraryPanel() {
  const report = useEditor((s) => s.report);
  const updateInstances = useEditor((s) => s.updateInstances);
  const [items, setItems] = useState<ComponentSummary[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [reloadNotice, setReloadNotice] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage[] | null>(null);
  const openRef = useRef<string | null>(null);   // 늦게 도착한 사용처 응답이 다른 항목의 메뉴를 덮지 않게

  const load = useCallback(async () => {
    try { setItems(await fetchComponents()); setFailure(null); } catch (e) { setFailure(message(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const closeMenu = () => { openRef.current = null; setOpenId(null); };
  const toggleMenu = async (id: string) => {
    if (openRef.current === id) { closeMenu(); return; }
    openRef.current = id; setOpenId(id); setUsage(null);
    try {
      const u = await fetchUsage(id);
      if (openRef.current === id) setUsage(u);
    } catch (e) { if (openRef.current === id) setStatus(message(e)); }
  };

  const onDragStart = (e: DragEvent<HTMLElement>, id: string) => {
    e.dataTransfer.setData(COMPONENT_MIME, id);
    e.dataTransfer.effectAllowed = "copy";
  };

  const edit = (c: ComponentSummary) => {
    closeMenu();
    window.open(`/components/${encodeURIComponent(c.id)}`, "_blank", "noopener");
  };

  /** 이 레포트 안 인스턴스를 라이브러리 최신 버전으로 (스토어 updateInstances = core upgradeRefs, 되돌리기 1단위) */
  const updateHere = async (c: ComponentSummary) => {
    closeMenu(); setStatus(null);
    const refs = refsTo(report, c.id);
    if (refs.length === 0) { setStatus("이 레포트에 이 컴포넌트의 인스턴스가 없습니다"); return; }
    try {
      const detail = await fetchComponent(c.id);
      const version = detail.summary.latestVersion;
      if (refs.every((r) => r.version === version)) { setStatus(`이미 최신 버전(v${version})입니다`); return; }
      const notice = sizeChangeNotice(refs, detail.latest);
      if (notice && !window.confirm(notice)) return;
      updateInstances(c.id, version, detail.latest);
      setStatus(`인스턴스 ${refs.length}개를 v${version}(으)로 올렸습니다`);
    } catch (e) { setStatus(message(e)); }
  };

  /** 저장된 모든 레포트에 최신 적용. 열린 레포트가 바뀌었으면 새로 불러오라고 알린다 */
  const applyAll = async (c: ComponentSummary) => {
    closeMenu(); setStatus(null); setReloadNotice(false);
    try {
      const users = await fetchUsage(c.id);
      if (!window.confirm(`이 컴포넌트를 쓰는 레포트 ${users.length}개에 최신 버전(v${c.latestVersion})을 적용할까요? 저장된 레포트가 바뀝니다.`)) return;
      const res = await applyLatest(c.id);
      setStatus([`적용 ${res.updated.length}개, 건너뜀 ${res.skipped.length}개`, ...res.skipped.map((s) => `${s.reportId}: ${s.error}`)].join("\n"));
      if (res.updated.includes(report.id)) setReloadNotice(true);
    } catch (e) { setStatus(message(e)); }
  };

  const remove = async (c: ComponentSummary) => {
    closeMenu(); setStatus(null);
    if (!window.confirm(`컴포넌트 "${c.name}"(${c.id})을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      await deleteComponent(c.id);
      await load();
    } catch (e) { setStatus(message(e)); }
  };

  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold">컴포넌트</div>
        <button className={btn} onClick={() => void load()}>새로고침</button>
      </div>
      {failure && <div className="text-xs text-red-700">목록을 불러오지 못했습니다: {failure}</div>}
      {items && items.length === 0 && <div className="text-xs text-neutral-400">등록된 컴포넌트가 없습니다</div>}
      {reloadNotice && <div role="alert" className="text-xs bg-amber-100 border border-amber-400 rounded px-2 py-1">저장된 레포트가 바뀌었습니다. 새로 불러오세요</div>}
      {status && <div role="status" className="text-xs text-neutral-700 whitespace-pre-line">{status}</div>}
      <ul className="flex flex-col gap-1">
        {items?.map((c) => {
          const inUse = usage !== null && usage.length > 0;
          return (
            <li key={c.id} data-testid={`component-${c.id}`} draggable onDragStart={(e) => onDragStart(e, c.id)}
              className="border rounded px-2 py-1 text-xs cursor-grab hover:bg-neutral-50">
              <div className="flex items-center gap-1">
                <span className="flex-1 truncate font-medium">{c.name}</span>
                <span className="text-neutral-500">v{c.latestVersion}</span>
                <button aria-label={`${c.name} 메뉴`} className="px-1 rounded hover:bg-neutral-200" onClick={() => void toggleMenu(c.id)}>⋯</button>
              </div>
              <div className="text-neutral-400">{`${c.id} · ${c.w}×${c.h}mm`}</div>
              {openId === c.id && (
                <div role="menu" className="mt-1 flex flex-col border rounded bg-white">
                  <button role="menuitem" className={item} onClick={() => edit(c)}>편집</button>
                  <button role="menuitem" className={item} onClick={() => void updateHere(c)}>이 레포트의 인스턴스 모두 최신으로</button>
                  <button role="menuitem" className={item} onClick={() => void applyAll(c)}>모든 레포트에 최신 적용</button>
                  {/* 사용처를 받기 전에는 막아 둔다. 사용 중이면 툴팁에 레포트 id (스펙 7.1) */}
                  <button role="menuitem" className={item} disabled={usage === null || inUse}
                    title={inUse ? `사용 중: ${usage!.map((u) => u.reportId).join(", ")}` : undefined} onClick={() => void remove(c)}>삭제</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
