import { compare, applyPatch, deepClone, type Operation } from "fast-json-patch";

export type History<T> = { present: T; past: Operation[][]; future: Operation[][] };   // past[i]는 present→이전 상태로 가는 역패치

export function createHistory<T>(initial: T): History<T> { return { present: initial, past: [], future: [] }; }

/** mutate로 복제본을 고치고, 정방향/역방향 패치를 기록한다 */
export function commit<T extends object>(h: History<T>, mutate: (draft: T) => void, limit = 200): History<T> {
  const draft = deepClone(h.present) as T;
  mutate(draft);
  // JSON 모양으로 맞춘다. undefined 값 키가 present에 남으면 같은 JSON을 다시 반영할 때 역패치가 비어 있는 undo 단계가 쌓인다
  const next = deepClone(draft) as T;
  const forward = compare(h.present as object, next as object);
  if (forward.length === 0) return h;
  const inverse = compare(next as object, h.present as object);
  return { present: next, past: [...h.past.slice(-limit + 1), inverse], future: [] };
}

export function undo<T extends object>(h: History<T>): History<T> {
  const inverse = h.past[h.past.length - 1];
  if (!inverse) return h;
  const prev = applyPatch(deepClone(h.present) as object, deepClone(inverse), false, false).newDocument as T;
  const redoPatch = compare(prev as object, h.present as object);
  return { present: prev, past: h.past.slice(0, -1), future: [...h.future, redoPatch] };
}

export function redo<T extends object>(h: History<T>): History<T> {
  const fwd = h.future[h.future.length - 1];
  if (!fwd) return h;
  const next = applyPatch(deepClone(h.present) as object, deepClone(fwd), false, false).newDocument as T;
  const inverse = compare(next as object, h.present as object);
  return { present: next, past: [...h.past, inverse], future: h.future.slice(0, -1) };
}
