import { notFound } from "next/navigation";
import { getComponentStore } from "@/lib/component-store";
import { componentToEditReport, defaultSampleProps } from "@/lib/component-edit";
import { Editor } from "@/editor/Editor";

export const dynamic = "force-dynamic";

/** 컴포넌트 편집 화면 (스펙 7.5). 최신 버전 내용을 편집용 레포트로 감싸 기존 에디터를 컴포넌트 모드로 연다 */
export default async function ComponentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getComponentStore().get(id);
  if (!detail) notFound();
  const body = detail.latest;
  return (
    <Editor initial={componentToEditReport(id, body)}
      componentMode={{ componentId: id, version: detail.summary.latestVersion, props: body.props, sampleProps: defaultSampleProps(body.props) }} />
  );
}
