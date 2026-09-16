"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** 이 문서에서 홈이 이미 한 번 마운트됐는가. 새로고침(문서 로드)마다 초기화된다 */
let mountedBefore = false;

/**
 * 브라우저 뒤로가기는 클라이언트 라우터 캐시의 홈을 다시 쓰므로, 그 사이 만든 레포트가 목록에 없다.
 * 같은 문서에서 홈이 다시 마운트되면 서버 목록을 새로 받는다. 첫 마운트는 서버가 방금 그린 목록이라 건너뛴다
 */
export function RefreshOnReturn() {
  const router = useRouter();
  const ran = useRef(false);   // StrictMode의 이중 효과 실행을 한 번으로 센다
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (mountedBefore) router.refresh();
    mountedBefore = true;
  }, [router]);
  return null;
}
