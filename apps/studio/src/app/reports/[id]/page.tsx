import { notFound } from "next/navigation";
import { getStore } from "@/lib/report-store";
import { Editor } from "@/editor/Editor";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const report = await getStore().get((await params).id);
  if (!report) notFound();
  return <Editor initial={report} />;
}
