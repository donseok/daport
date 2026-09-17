import type { FieldNode, FieldType } from "@daport/core";

export const DRAG_MIME = "application/x-daport-field";
/** 필드 트리에서 끄는 항목. children은 배열 노드일 때 원소 필드(표 생성용) */
export type DragField = { dataset: string; path: string; type: FieldType; isArray: boolean; children?: FieldNode[] };

/** 소스 표현식의 루트 식별자. `items` → items, `items[.A == 1]` → items, `record.items` → undefined(레코드 상대), `a.b` → undefined */
export function sourceDataset(source: string): string | undefined {
  const m = source.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)(\s*\[.*)?$/s);
  return m ? m[1] : undefined;
}
