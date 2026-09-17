import type { FlowInput, FlowPage, FlowPlacement, Region } from "./types";
import { RegionTooSmallError } from "../layout/errors";

const EPS = 1e-6;

/**
 * 조각을 영역에 차례로 나눠 담는다 (스펙 5.2).
 * 1. header는 첫 페이지 맨 위, repeatHeader면 모든 페이지 맨 위.
 * 2. pageFooter가 있으면 페이지 하단에 그 높이를 예약하고 마지막에 놓는다.
 * 3. 남은 높이보다 큰 조각은 다음 페이지로.
 * 4. keepWithNext 조각은 바로 뒤 조각(연쇄 포함)과 함께 옮긴다. 묶음이 빈 페이지에도 안 들어가면 푼다.
 * 5. 조각 하나가 빈 페이지보다 크면 단독 배치하고 overflow를 표시한다(무한 페이지 방지).
 * 6. clip이면 첫 영역에 들어가는 조각까지만 두고 truncated를 표시한다.
 * 7. footer는 본문 마지막 조각으로 취급한다(자리가 없으면 새 페이지).
 * 8. 이어지는 페이지가 필요한데 남은 조각 중 가장 작은 것도 빈 이어지는 페이지에 안 들어가면 RegionTooSmallError(조각마다 페이지가 생기는 폭증 방지).
 */
export function paginate(input: FlowInput, opts: { first: Region; next: Region; repeatHeader: boolean; clip: boolean }): FlowPage[] {
  const { header, pageFooter } = input;
  const body = input.footer ? [...input.body, input.footer] : input.body;
  const footerH = pageFooter?.height ?? 0;
  // 빈 이어지는 페이지에 본문 조각을 놓을 수 있는 높이. 묶음·조각이 여기에도 안 들어가면 규칙 4의 풀기·규칙 5의 잘림이 된다
  const freshAvail = opts.next.h - footerH - (opts.repeatHeader && header ? header.height : 0);
  // suffixMin[k] = body[k..] 중 가장 작은 조각 높이 (규칙 8 검사용)
  const suffixMin = new Array<number>(body.length + 1).fill(Infinity);
  for (let k = body.length - 1; k >= 0; k--) suffixMin[k] = Math.min(body[k].height, suffixMin[k + 1]);
  const pages: FlowPage[] = [];
  let i = 0;
  while (i < body.length || pages.length === 0) {
    if (pages.length > 0 && freshAvail + EPS < suffixMin[i]) throw new RegionTooSmallError(Math.max(0, freshAvail), suffixMin[i]);
    const region = pages.length === 0 ? opts.first : opts.next;
    const placements: FlowPlacement[] = [];
    let y = 0;
    if (header && (pages.length === 0 || opts.repeatHeader)) { placements.push({ block: header, y: 0, overflow: false }); y = header.height; }
    const headerCount = placements.length;
    const avail = region.h - footerH;
    let pageOverflow = false;
    while (i < body.length) {
      const b = body[i];
      // keepWithNext 연쇄: b부터 keepWithNext가 아닌 첫 조각까지 한 묶음
      let j = i, need = b.height;
      while (body[j].keepWithNext && j + 1 < body.length) { j++; need += body[j].height; }
      const room = avail - y;
      if (need <= room + EPS) {
        for (let k = i; k <= j; k++) { placements.push({ block: body[k], y, overflow: false }); y += body[k].height; }
        i = j + 1;
        continue;
      }
      if (j > i && need <= freshAvail + EPS) break;                       // 규칙 4: 묶음째 다음 페이지로
      // 묶음이 빈 페이지에도 안 들어가면 풀고 b 하나만 본다
      const empty = placements.length === headerCount;
      if (b.height <= room + EPS) { placements.push({ block: b, y, overflow: false }); y += b.height; i++; continue; }
      if (!empty) break;                                                   // 규칙 3: 다음 페이지로
      if (pages.length === 0 && b.height <= freshAvail + EPS) break;       // 첫 영역만 작은 것이면 다음 페이지로 (첫 페이지는 비어 있어도 된다)
      placements.push({ block: b, y, overflow: true });                    // 규칙 5: 빈 페이지보다 큰 조각은 단독 배치
      y += b.height; pageOverflow = true; i++;
    }
    const pageRows = placements.flatMap((p) => p.block.rows);
    if (pageFooter) placements.push({ block: pageFooter, y: region.h - footerH, overflow: false });
    const truncated = opts.clip && i < body.length;
    pages.push({ placements, pageRows, overflow: pageOverflow, truncated });
    if (truncated) break;
  }
  return pages;
}
