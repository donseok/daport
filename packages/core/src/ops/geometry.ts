import type { Element } from "../schema/elements";

export type Box = { x: number; y: number; w: number; h: number };

/** 좌표를 1e-6mm 단위로 반올림한다. 상대좌표로 옮겼다가 되돌려도(그룹화 → 해제) 부동소수 오차가 남지 않게 한다 */
const snap = (v: number) => Math.round(v * 1e6) / 1e6;

/** 요소의 경계 상자(요소가 들어 있는 배열 기준 좌표). 선은 두 끝점으로 만든다(x/y가 끝점보다 오른쪽·아래일 수 있다) */
export function elementBox(el: Element): Box {
  if (el.type === "line") {
    return { x: Math.min(el.x, el.x2), y: Math.min(el.y, el.y2), w: Math.abs(el.x2 - el.x), h: Math.abs(el.y2 - el.y) };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

/** 상자들을 모두 담는 가장 작은 상자. 빈 배열이면 던진다 */
export function unionBox(boxes: Box[]): Box {
  if (boxes.length === 0) throw new Error("unionBox: no boxes");
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: snap(x), y: snap(y), w: snap(right - x), h: snap(bottom - y) };
}

/**
 * 요소를 (dx, dy)만큼 옮긴 복제본. 선은 끝점(x2, y2)도 옮긴다.
 * 그룹·반복 영역의 자식은 부모 기준 상대좌표라 그대로 둔다(자기 x/y만 바뀐다)
 */
export function translateElement<T extends Element>(el: T, dx: number, dy: number): T {
  const copy = structuredClone(el);
  copy.x = snap(copy.x + dx);
  copy.y = snap(copy.y + dy);
  if (copy.type === "line") { copy.x2 = snap(copy.x2 + dx); copy.y2 = snap(copy.y2 + dy); }
  return copy;
}
