import { compare, applyPatch, deepClone, type Operation } from "fast-json-patch";

export type History<T> = { present: T; past: Operation[][]; future: Operation[][] };   // past[i]는 present→이전 상태로 가는 역패치

export function createHistory<T>(initial: T): History<T> { return { present: initial, past: [], future: [] }; }

/** mutate로 복제본을 고치고, 정방향/역방향 패치를 기록한다 */
export function commit<T extends object>(h: History<T>, mutate: (draft: T) => void, limit = 200): History<T> {
  const next = deepClone(h.present) as T;
  mutate(next);
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
