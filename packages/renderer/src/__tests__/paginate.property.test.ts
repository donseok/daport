import { describe, it, expect } from "vitest";
import { paginate } from "../flow/paginate";
import type { Block, FlowInput } from "../flow/types";

/** 시드 고정 PRNG (mulberry32). 실패한 반복의 seed를 메시지에 남겨 재현한다 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const EPS = 1e-6;

type Gen = { input: FlowInput; first: { x: number; y: number; w: number; h: number }; next: { x: number; y: number; w: number; h: number }; repeatHeader: boolean };

function generate(seed: number): Gen {
  const r = rng(seed);
  const body: Block[] = [];
  const n = int(r, 0, 60);
  let rowNo = 0;
  for (let i = 0; i < n; i++) {
    const kind = r() < 0.2 ? "groupHeader" : r() < 0.1 ? "groupFooter" : "row";
    const height = int(r, 1, 30);
    body.push({ kind, height, keepWithNext: kind === "groupHeader" && r() < 0.8, rows: kind === "row" ? [{ no: rowNo++ }] : [], paint: () => [] });
  }
  const header = r() < 0.6 ? { kind: "header" as const, height: int(r, 3, 12), keepWithNext: false, rows: [], paint: () => [] } : undefined;
  const pageFooter = r() < 0.4 ? { kind: "pageFooter" as const, height: int(r, 3, 10), keepWithNext: false, rows: [], paint: () => [] } : undefined;
  const footer = r() < 0.4 ? { kind: "footer" as const, height: int(r, 3, 15), keepWithNext: false, rows: [], paint: () => [] } : undefined;
  return {
    input: { header, pageFooter, body, footer },
    first: { x: 0, y: 0, w: 100, h: int(r, 15, 120) },
    next: { x: 0, y: 0, w: 100, h: int(r, 40, 120) },
    repeatHeader: r() < 0.5,
  };
}

describe("paginate invariants", () => {
  it("hold for 300 seeded random inputs", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const g = generate(seed);
      const pages = paginate(g.input, { first: g.first, next: g.next, repeatHeader: g.repeatHeader, clip: false });
      const msg = `seed ${seed}`;
      const footerH = g.input.pageFooter?.height ?? 0;
      const freshAvail = g.next.h - footerH - (g.repeatHeader && g.input.header ? g.input.header.height : 0);

      // 1. 모든 본문 조각이 정확히 한 번, 원래 순서대로
      const placedBody = pages.flatMap((p) => p.placements.map((x) => x.block)).filter((b) => b.kind !== "header" && b.kind !== "pageFooter");
      const expected = g.input.footer ? [...g.input.body, g.input.footer] : g.input.body;
      expect(placedBody, msg).toEqual(expected);

      pages.forEach((p, pi) => {
        const region = pi === 0 ? g.first : g.next;
        // 2. 조각이 영역 하단(페이지 소계 예약분 제외)을 넘지 않는다. overflow 표시된 조각만 예외
        for (const pl of p.placements) {
          if (pl.block.kind === "pageFooter") { expect(pl.y, msg).toBeCloseTo(region.h - footerH); continue; }
          if (!pl.overflow) expect(pl.y + pl.block.height, msg).toBeLessThanOrEqual(region.h - footerH + EPS);
          else expect(pl.block.height, msg).toBeGreaterThan(freshAvail - EPS);   // overflow는 빈 페이지에도 안 들어갈 때만
        }
        // 3. 머리행은 첫 페이지 맨 위, repeatHeader면 모든 페이지 맨 위
        if (g.input.header && (pi === 0 || g.repeatHeader)) expect(p.placements[0]?.block, msg).toBe(g.input.header);
        if (g.input.header && !g.repeatHeader && pi > 0) expect(p.placements.some((x) => x.block === g.input.header), msg).toBe(false);
        // 4. keepWithNext 조각이 페이지의 마지막 본문 조각이 아니다 (묶음이 빈 페이지에도 안 들어가는 경우만 예외)
        const bodyPl = p.placements.filter((x) => x.block.kind !== "header" && x.block.kind !== "pageFooter");
        const last = bodyPl.at(-1);
        if (last?.block.keepWithNext && last.block !== expected.at(-1)) {
          const i = expected.indexOf(last.block);
          let j = i, need = 0;
          while (j < expected.length && expected[j].keepWithNext) { need += expected[j].height; j++; }
          if (j < expected.length) need += expected[j].height;
          expect(need, msg).toBeGreaterThan(freshAvail - EPS);
        }
        // 5. pageRows = 이 페이지 row 조각들의 행 합집합
        expect(p.pageRows, msg).toEqual(bodyPl.flatMap((x) => x.block.rows));
      });
      // 6. 페이지 수 상한: 조각마다 한 페이지 이상 쓰지 않는다 (첫 영역이 작아 비는 첫 페이지 하나만 예외)
      expect(pages.length, msg).toBeLessThanOrEqual(Math.max(1, expected.length) + 1);
    }
  });
});
