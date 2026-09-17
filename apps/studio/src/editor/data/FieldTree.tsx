"use client";
import { useState, type DragEvent } from "react";
import type { FieldNode } from "@daport/core";
import { DRAG_MIME, type DragField } from "./bindings";

const MARK: Record<FieldNode["type"], string> = { string: "T", number: "#", boolean: "✓", date: "◷", object: "{}", array: "[]", null: "∅" };

function Node({ dataset, node, depth }: { dataset: string; node: FieldNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);   // 루트(데이터셋)와 그 필드까지 펼쳐 둔다
  const hasChildren = !!node.children?.length;
  const onDragStart = (e: DragEvent) => {
    const field: DragField = { dataset, path: node.path, type: node.type, isArray: node.type === "array" };
    if (node.type === "array" && node.children) field.children = node.children;
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(field));
    e.dataTransfer.effectAllowed = "copy";
  };
  return (
    <li>
      <div draggable data-path={node.path} onDragStart={onDragStart} onClick={() => hasChildren && setOpen(!open)}
        className="flex items-center gap-1 text-xs px-1 py-0.5 rounded cursor-grab hover:bg-neutral-100" style={{ paddingLeft: depth * 12 + 4 }}>
        <span className="w-5 text-neutral-400 font-mono">{MARK[node.type]}</span>
        <span>{node.name}</span>
        {hasChildren && <span className="text-neutral-400">{open ? "▾" : "▸"}</span>}
      </div>
      {hasChildren && open && <ul>{node.children!.map((c) => <Node key={c.path} dataset={dataset} node={c} depth={depth + 1} />)}</ul>}
    </li>
  );
}

/**
 * 데이터셋 하나의 필드 트리. 루트 노드는 데이터셋 자체(path "", array)라 캔버스에 끌면 표가 된다.
 * 각 노드는 캔버스·표·반복 영역으로 끌 수 있다
 */
export function FieldTree({ dataset, nodes }: { dataset: string; nodes: FieldNode[] }) {
  const root: FieldNode = { name: dataset, path: "", type: "array", children: nodes };
  return (
    <ul data-testid={`fields-${dataset}`}>
      <Node dataset={dataset} node={root} depth={0} />
      {nodes.length === 0 && <li className="text-xs text-neutral-400 px-1">필드 없음 (샘플을 가져오세요)</li>}
    </ul>
  );
}
