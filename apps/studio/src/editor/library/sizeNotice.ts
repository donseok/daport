type Sized = { w: number; h: number };

const num = (v: number) => String(Math.round(v * 100) / 100);
const label = (s: Sized) => `${num(s.w)}×${num(s.h)}`;
const differs = (a: Sized, b: Sized) => Math.abs(a.w - b.w) > 1e-6 || Math.abs(a.h - b.h) > 1e-6;

/**
 * 인스턴스를 새 버전으로 올릴 때 크기가 바뀌는 인스턴스가 있으면 확인 대화상자 문구를, 없으면 null을 준다 (스펙 7.2).
 * 예: "180×24 → 180×30, 아래 요소와 겹칠 수 있습니다". 옛 크기가 여럿이면 쉼표로 한 번씩 적는다
 */
export function sizeChangeNotice(refs: Sized[], body: Sized): string | null {
  const old = [...new Set(refs.filter((r) => differs(r, body)).map(label))];
  if (old.length === 0) return null;
  return `${old.join(", ")} → ${label(body)}, 아래 요소와 겹칠 수 있습니다`;
}
