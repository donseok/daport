import { ExpressionError, type DataContext, type Element } from "@daport/core";
import { flatten } from "../layout/flatten";
import { placeStatic, refBoxItem, refErrorItem, ownedInstance, ownItems } from "../layout/place";
import { repaintProps, withProps } from "../layout/props";
import type { PlacedItem } from "../layout/types";
import { paintClipped } from "./paint";
import type { FlowOptions, PageFlowContext } from "./types";

/**
 * 반복 영역 항목·그룹 밴드의 자식을 origin 기준 절대좌표로 그린다. 페이지 값은 컨텍스트에 합친다.
 * 스키마가 템플릿 안의 repeater와 continue 표(컴포넌트 내용 안 포함)를 막으므로 여기서 table은 항상 clip이다.
 * ref는 layout과 같은 flatten으로 펼친다: elementId = ref id, instance = `<항목 경로>/<refId>/<path>`(+표 자기 경로),
 * refBox는 항목 경로를 instance로 갖고 인스턴스의 첫 항목이다. 입력값은 항목마다 새로 평가한다(캐시 범위 = 이 호출)
 */
export function paintChildren(children: Element[], origin: { x: number; y: number }, ctx: DataContext,
  opts: FlowOptions & { instance: string; pageCtx: PageFlowContext }): PlacedItem[] {
  // 이 반복 영역이 컴포넌트 안이면 그리는 시점의 페이지 값으로 인스턴스 입력값을 다시 평가한다(3b 스펙 5.2)
  const full: DataContext = repaintProps({ ...ctx, ...opts.pageCtx }, opts.ref, opts.onExpressionError);
  const items: PlacedItem[] = [];
  const cache = new Map<string, Record<string, unknown>>();
  const boxed = new Set<string>(), broken = new Set<string>();
  for (const el of flatten(children, origin.x, origin.y, [], { components: opts.components })) {
    if (el.type === "repeater") continue;   // 스키마가 막는다. 방어적으로 건너뛴다
    const owner = el.owner;
    if (!owner) {
      if (el.type === "table") items.push(...paintClipped(el, full, opts, opts.pageCtx, opts.instance));
      else items.push(...placeStatic(el, full, { onExpressionError: opts.onExpressionError, instance: opts.instance }));
      continue;
    }
    if (broken.has(owner.refId)) continue;
    let ectx: DataContext;
    try { ectx = withProps(full, owner, cache); }
    catch (e) {
      if (!(e instanceof ExpressionError) || opts.onExpressionError === "fail") throw e;
      broken.add(owner.refId);
      if (!boxed.has(owner.refId)) items.push(refErrorItem(owner, e.message, opts.instance));
      continue;
    }
    if (!boxed.has(owner.refId)) { boxed.add(owner.refId); items.push(refBoxItem(owner, opts.instance)); }
    const base = ownedInstance(owner, opts.instance);
    const painted = el.type === "table"
      ? paintClipped(el, ectx, { ...opts, ref: { owner, cache } }, opts.pageCtx, base)
      : placeStatic(el, ectx, { onExpressionError: opts.onExpressionError, instance: base });
    items.push(...ownItems(painted, owner, el.id, base));
  }
  return items;
}
