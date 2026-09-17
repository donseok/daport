import { getStore, ready } from "@/lib/report-store";
import { NewReportForm } from "./NewReportForm";
import { RefreshOnReturn } from "./RefreshOnReturn";
import { ReportList } from "./ReportList";

export const dynamic = "force-dynamic";

export default async function Home() {
  await ready();
  const list = await getStore().list();
  return (
    <main className="max-w-2xl mx-auto p-8">
      <RefreshOnReturn />
      <h1 className="text-xl font-bold mb-4">레포트</h1>
      <ReportList reports={list} />
      <NewReportForm />
    </main>
  );
}
