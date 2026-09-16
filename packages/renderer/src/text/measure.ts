import metrics from "../metrics.json";
import { ptToMm } from "@daport/core";

type FontMetrics = typeof metrics.regular;

function fm(bold: boolean): FontMetrics { return bold ? metrics.bold : metrics.regular; }

function isHangul(cp: number) { return (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f); }
/** 전각으로 추정하는 범위: 한글, CJK 한자, CJK 기호·가나, 전각 형태, 도형(U+25A0–25FF)·기타 기호(U+2600–26FF) */
function isWide(cp: number) {
  return isHangul(cp) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3000 && cp <= 0x30ff) || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0x25a0 && cp <= 0x26ff);
}

/** 문자열 폭을 폰트 단위(unitsPerEm 기준)로 합산. 문자별 규칙은 measureWidth 참고 */
function widthUnits(text: string, m: FontMetrics): number {
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const w = (m.widths as Record<string, number>)[ch];
    units += w !== undefined ? w : isWide(cp) ? m.hangul : m.fallback * 0.6;
  }
  return units;
}

function unitsToMm(units: number, m: FontMetrics, fontSize: number): number {
  return ptToMm((units / m.unitsPerEm) * fontSize);
}

/**
 * 문자열 폭(mm). fontSize는 pt.
 *
 * 문자별 폭 규칙:
 * - metrics.json widths에 있는 문자(ASCII·Latin-1·Latin Extended-A·일부 기호)는 실제 advance width
 * - 없는 문자 중 isWide 범위(한글·한자·가나·전각·도형/기호)는 한글 폭(hangul)으로 추정
 * - 그 외(탭, 이모지, ẞ 등)는 fallback * 0.6 — 탭도 이 규칙이라 공백의 약 2배로 잡힌다
 * - 제어 문자(\n 등)도 위 규칙으로 폭이 잡히므로 줄바꿈은 wrapText가 먼저 분리해야 한다
 */
export function measureWidth(text: string, fontSize: number, bold: boolean): number {
  const m = fm(bold);
  return unitsToMm(widthUnits(text, m), m, fontSize);
}

export function lineHeightMm(fontSize: number, lineHeight: number): number { return ptToMm(fontSize) * lineHeight; }

/**
 * maxWidth(mm)에 맞춰 줄바꿈. 공백 우선, 없으면 문자 단위.
 * 단락 구분은 "\n"과 "\r\n"만 인식한다(단독 "\r"은 줄바꿈이 아니다).
 */
export function wrapText(text: string, fontSize: number, bold: boolean, maxWidth: number): string[] {
  const m = fm(bold);
  const fits = (units: number) => unitsToMm(units, m, fontSize) <= maxWidth;
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (para === "") { out.push(""); continue; }
    let line = "";
    let lineUnits = 0; // line의 폭을 누적해 두어 토큰마다 줄 전체를 다시 재지 않는다
    const tokens = para.split(/(\s+)/).filter((t) => t !== "");
    for (const tok of tokens) {
      const tokUnits = widthUnits(tok, m);
      if (fits(lineUnits + tokUnits) || line === "" && /^\s+$/.test(tok)) {
        line += tok; lineUnits += tokUnits; continue;
      }
      if (/^\s+$/.test(tok)) { out.push(line); line = ""; lineUnits = 0; continue; }
      if (line !== "") {
        // 선행 공백만 남은 줄은 버려서 빈 줄이 생기지 않게 한다
        const trimmed = line.trimEnd();
        if (trimmed !== "") out.push(trimmed);
        line = ""; lineUnits = 0;
      }
      // 단어 전체가 새 줄에 들어가면 통째로 놓는다
      if (fits(tokUnits)) { line = tok; lineUnits = tokUnits; continue; }
      // 토큰 자체가 넘치면 문자 단위로 쪼갠다
      for (const ch of tok) {
        const chUnits = widthUnits(ch, m);
        if (fits(lineUnits + chUnits) || line === "") { line += ch; lineUnits += chUnits; }
        else { out.push(line); line = ch; lineUnits = chUnits; }
      }
    }
    out.push(line.trimEnd());
  }
  return out.length ? out : [""];
}
