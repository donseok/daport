import Link from "next/link";
import { getApiKeyStore } from "@/lib/api-key-store";

export const dynamic = "force-dynamic";

/** API 키 읽기 전용 목록 (4단계 스펙 7.2). 발급·회수는 CLI로만 한다 */
export default async function KeysPage() {
  const keys = await getApiKeyStore().list();
  return (
    <main className="max-w-2xl mx-auto p-8">
      <Link className="text-sm text-blue-700 hover:underline" href="/">← 레포트</Link>
      <h1 className="text-xl font-bold my-4">API 키</h1>
      {!process.env.DATABASE_URL && process.env.DAPORT_DEV_API_KEY && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-4">
          DAPORT_DEV_API_KEY가 설정돼 있어, 아래 목록에 없는 전체 허용 dev 키가 모든 레포트에 대해 활성 상태입니다.
        </p>
      )}
      <pre className="text-xs bg-neutral-50 border rounded p-2 mb-4">{`발급: pnpm --filter studio keys create --name <이름> [--reports a,b]\n회수: pnpm --filter studio keys revoke <kid>`}</pre>
      <table className="w-full text-sm bg-white border rounded">
        <thead><tr className="text-left border-b"><th className="p-2">이름</th><th className="p-2">kid</th><th className="p-2">허용 레포트</th><th className="p-2">발급</th><th className="p-2">회수</th></tr></thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.kid} className={`border-b ${k.revokedAt ? "text-neutral-400" : ""}`}>
              <td className="p-2">{k.name}</td><td className="p-2 font-mono">{k.kid}</td>
              <td className="p-2">{k.allowedReportIds ? k.allowedReportIds.join(", ") : "전체"}</td>
              <td className="p-2">{new Date(k.createdAt).toLocaleString("ko-KR")}</td>
              <td className="p-2">{k.revokedAt ? new Date(k.revokedAt).toLocaleString("ko-KR") : ""}</td>
            </tr>
          ))}
          {keys.length === 0 && <tr><td className="p-2 text-neutral-500" colSpan={5}>키가 없습니다</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
