import type { Report, Element } from "@daport/core";

export function resolveAssetUrls(report: Report, baseUrl: string): Report {
  const clone = structuredClone(report);
  const walk = (els: Element[]) => { for (const el of els) {
    if (el.type === "image" && el.src.startsWith("asset://")) el.src = `${baseUrl}/api/assets/${el.src.slice("asset://".length)}`;
    if (el.type === "group") walk(el.children);
  } };
  walk(clone.elements);
  return clone;
}
