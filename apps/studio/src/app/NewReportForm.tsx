"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewReportForm() {
  const router = useRouter();
  const [id, setId] = useState(""); const [name, setName] = useState("");
  const [size, setSize] = useState("210x297");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const [width, height] = size.split("x").map(Number);
    const r = await fetch("/api/reports", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, name, version: 1, page: { width, height }, datasets: [], params: [], elements: [] }) });
    if (r.ok) router.push(`/reports/${id}`); else alert((await r.json()).error);
  };
  return (
    <form onSubmit={submit} className="flex gap-2 items-end">
      <label className="text-xs">ID<input required pattern="[a-z0-9\-]+" value={id} onChange={(e) => setId(e.target.value)} className="block border rounded px-2 py-1" /></label>
      <label className="text-xs">이름<input value={name} onChange={(e) => setName(e.target.value)} className="block border rounded px-2 py-1" /></label>
      <label className="text-xs">크기<select value={size} onChange={(e) => setSize(e.target.value)} className="block border rounded px-2 py-1">
        <option value="210x297">A4 세로</option><option value="297x210">A4 가로</option><option value="60x40">Tag 60×40</option></select></label>
      <button className="text-sm border rounded px-3 py-1 bg-white">새 레포트</button>
    </form>
  );
}
