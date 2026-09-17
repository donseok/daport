import { wrapText } from "./measure";

export type MeasureCache = { wrap(text: string, fontSize: number, bold: boolean, width: number): string[] };

/** 줄바꿈 결과를 (text, fontSize, bold, width)로 캐시한다. layout() 호출마다 새로 만들어 호출 사이에 메모리를 붙들지 않는다 */
export function createMeasureCache(): MeasureCache {
  const map = new Map<string, string[]>();
  return {
    wrap(text, fontSize, bold, width) {
      const key = `${fontSize}|${bold ? 1 : 0}|${width}|${text}`;
      let lines = map.get(key);
      if (!lines) { lines = wrapText(text, fontSize, bold, width); map.set(key, lines); }
      return lines;
    },
  };
}
