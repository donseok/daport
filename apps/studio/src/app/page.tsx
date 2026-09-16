import Link from "next/link";
import { getStore } from "@/lib/report-store";
import { NewReportForm } from "./NewReportForm";

export const dynamic = "force-dynamic";

export default async function Home() {
  const list = await getStore().list();
  return (
    <main className="max-w-2xl mx-auto p-8">
      <h1 className="text-xl font-bold mb-4">레포트</h1>
      <ul className="divide-y bg-white border rounded mb-6">
        {list.map((r) => <li key={r.id} className="p-3"><Link className="text-blue-700 hover:underline" href={`/reports/${r.id}`}>{r.name || r.id}</Link></li>)}
        {list.length === 0 && <li className="p-3 text-neutral-500 text-sm">레포트가 없습니다</li>}
      </ul>
      <NewReportForm />
    </main>
  );
}
