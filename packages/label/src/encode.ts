import { rowBytes, type Bitmap } from "./bitmap";

export type LabelOptions = { widthMm: number; heightMm: number; dpi: number; copies: number; darkness?: number; speed?: number };

/** ZPL: 라벨(비트맵)마다 ^XA…^XZ 한 블록. ^GFA는 1 = 검정, 16진 대문자 (스펙 6.2) */
export function encodeZpl(bitmaps: Bitmap[], opts: LabelOptions): string {
  return bitmaps.map((bm) => {
    const rb = rowBytes(bm.width), total = rb * bm.height;
    const hex = Buffer.from(bm.bits).toString("hex").toUpperCase();
    return [
      "^XA", `^PW${bm.width}`, `^LL${bm.height}`,
      ...(opts.darkness !== undefined ? [`~SD${opts.darkness}`] : []),
      ...(opts.speed !== undefined ? [`^PR${opts.speed}`] : []),
      `^FO0,0^GFA,${total},${total},${rb},${hex}^FS`,
      `^PQ${opts.copies}`, "^XZ", "",
    ].join("\n");
  }).join("");
}

/** TSPL: SIZE…PRINT 한 블록. BITMAP 모드 0은 0 = 검정이라 비트를 반전한다. 바이너리가 섞이므로 Buffer */
export function encodeTspl(bitmaps: Bitmap[], opts: LabelOptions): Buffer {
  const parts: Buffer[] = [];
  for (const bm of bitmaps) {
    const rb = rowBytes(bm.width);
    const head = [
      `SIZE ${opts.widthMm} mm,${opts.heightMm} mm`, "GAP 3 mm,0 mm",
      ...(opts.darkness !== undefined ? [`DENSITY ${opts.darkness}`] : []),
      ...(opts.speed !== undefined ? [`SPEED ${opts.speed}`] : []),
      "CLS", `BITMAP 0,0,${rb},${bm.height},0,`,
    ].join("\r\n");
    const inverted = Buffer.from(bm.bits.map((b) => ~b & 0xff));
    parts.push(Buffer.from(head, "latin1"), inverted, Buffer.from(`\r\nPRINT 1,${opts.copies}\r\n`, "latin1"));
  }
  return Buffer.concat(parts);
}
