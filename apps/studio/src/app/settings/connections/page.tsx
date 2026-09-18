import Link from "next/link";
import { ConnectionsManager } from "./ConnectionsManager";
export const dynamic = "force-dynamic";
export default function ConnectionsPage() {
  return (
    <main className="max-w-3xl mx-auto p-8">
      <Link className="text-sm text-blue-700 hover:underline" href="/">← 레포트</Link>
      <h1 className="text-xl font-bold my-4">연결</h1>
      <p className="text-xs text-neutral-600 mb-3">비밀번호·에이전트 토큰은 저장하지 않습니다. 서버 환경변수 <code>DAPORT_SECRET_&lt;비밀값 이름&gt;</code>에 넣으세요. 운영 DB 계정은 SELECT 권한만 부여하세요.</p>
      <ConnectionsManager />
    </main>
  );
}
