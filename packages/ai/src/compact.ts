import type { Element, FieldNode, Report } from "@daport/core";
import type { LibraryItem } from "./types";

/** 대략적인 토큰 수. 정확할 필요는 없고 잘라내기 판단에만 쓴다 */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3);

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * 요소 한 줄: id type x,y w×h [타입별 핵심].
 * walkElements를 쓰지 않고 직접 순회하는 이유는 들여쓰기 깊이(depth)가 필요해서다
 */
function line(el: Element, textLimit: number): string {
  const head = `${el.id} ${el.type} ${el.x},${el.y} ${el.w}×${el.h}`;
  switch (el.type) {
    case "text": return `${head} "${trunc(el.value, textLimit)}"`;
    case "image": return `${head} src=${trunc(el.src, 40)}`;
    case "table": return `${head} source=${el.source} 열 ${el.columns.length}`;
    case "repeater": return `${head} source=${el.source} ${el.layout}`;
    case "barcode": return `${head} ${el.format} "${trunc(el.value, textLimit)}"`;
    case "ref": return `${head} ${el.ref}@${el.version}`;
    case "group": return `${head} [자식 ${el.children.length}]`;
    default: return head;
  }
}

/**
 * 모델의 요소 트리를 한 줄씩 압축한다. depth 아래 자식은 생략한다 (컨텍스트 절약).
 * 첫 줄이 반드시 첫 요소 줄이어야 하므로(T3 테스트 기준) 페이지 정보 줄은 넣지 않는다
 */
export function compactReport(report: Report, opts: { text?: number; depth?: number } = {}): string {
  const textLimit = opts.text ?? 40;
  const maxDepth = opts.depth ?? 3;
  const out: string[] = [];
  const walk = (els: Element[], depth: number) => {
    for (const el of els) {
      out.push(`${"  ".repeat(depth)}${line(el, textLimit)}`);
      if (depth >= maxDepth) continue;
      if (el.type === "group") walk(el.children, depth + 1);
      if (el.type === "repeater") walk(el.item.children, depth + 1);
    }
  };
  walk(report.elements, 0);
  return out.join("\n");
}

/** 필드는 ds.PATH: type 한 줄씩 */
export const compactFields = (fields: Record<string, FieldNode[]>): string =>
  Object.entries(fields).flatMap(([ds, nodes]) => nodes.map((n) => `${ds}.${n.path}: ${n.type}`)).join("\n");

/** 라이브러리(컴포넌트) 항목은 한 줄에 id·이름·버전·크기·props */
export const compactLibrary = (library: LibraryItem[]): string =>
  library.map((c) => `${c.id} ${c.name} v${c.version} ${c.w}×${c.h} props(${c.props.map((p) => `${p.name}:${p.type}`).join(", ")})`).join("\n");
