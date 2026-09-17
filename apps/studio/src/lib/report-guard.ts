import { COMPONENT_KEY_RE, componentHash, pruneComponents, type Report } from "@daport/core";
import { getComponentStore } from "./component-store";

/** 라이브러리에 없는 버전을 품은 레포트를 저장했을 때 경고를 담는 응답 헤더 (스펙 6.3). 값은 ASCII 문자열의 JSON 배열 */
export const WARNINGS_HEADER = "X-Daport-Warnings";

export type GuardResult =
  | { ok: true; report: Report; warnings: string[] }
  | { ok: false; status: 409; body: { error: string; code: "COMPONENT_MISMATCH" } };

/**
 * 레포트 저장 전 검사 (스펙 6.3).
 * 1) 쓰이지 않는 components 항목을 먼저 지운다 — 클라이언트 정리가 빠져도 파일이 부풀지 않고, 안 쓰는 옛 내용이 저장을 막지 않는다
 * 2) 남은 "id@v"마다 라이브러리의 그 버전을 찾는다. 있고 해시가 다르면 409, 없으면 경고만 남기고 저장한다
 * 경고 문구는 HTTP 헤더에 들어가므로 ASCII만 쓴다 (컴포넌트 id는 [a-z0-9-]라 ASCII다)
 */
export async function checkReportComponents(report: Report): Promise<GuardResult> {
  const pruned = pruneComponents(report);
  const store = getComponentStore();
  const warnings: string[] = [];
  for (const key of Object.keys(pruned.components).sort()) {
    const m = COMPONENT_KEY_RE.exec(key);
    if (!m) continue;   // ReportSchema가 키 형식을 이미 검증했다
    const stored = await store.getVersion(m[1], Number(m[2]));
    if (!stored) { warnings.push(`component ${key} is not in the library`); continue; }
    if (componentHash(pruned.components[key]) !== stored.hash) {
      return { ok: false, status: 409, body: { error: `component ${key} differs from the library`, code: "COMPONENT_MISMATCH" } };
    }
  }
  return { ok: true, report: pruned, warnings };
}
