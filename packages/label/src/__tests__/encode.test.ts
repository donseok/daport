import { describe, it, expect } from "vitest";
import { encodeZpl, encodeTspl } from "../encode";
import type { Bitmap } from "../bitmap";

const bm: Bitmap = { width: 9, height: 2, bits: new Uint8Array([0xff, 0x00, 0x00, 0x80]) };
const opts = { widthMm: 1.13, heightMm: 0.25, dpi: 203, copies: 1 };

describe("encodeZpl", () => {
  it("wraps each bitmap in one ^XA block with ^GFA hex, 1 = black", () => {
    expect(encodeZpl([bm], opts)).toBe("^XA\n^PW9\n^LL2\n^FO0,0^GFA,4,4,2,FF000080^FS\n^PQ1\n^XZ\n");
  });
  it("adds darkness, speed and copies, one block per label", () => {
    const out = encodeZpl([bm, bm], { ...opts, copies: 3, darkness: 15, speed: 4 });
    expect(out.match(/\^XA/g)).toHaveLength(2);
    expect(out).toContain("~SD15\n^PR4\n");
    expect(out).toContain("^PQ3\n");
  });
});

describe("encodeTspl", () => {
  it("emits SIZE/GAP/CLS/BITMAP/PRINT with inverted bytes (0 = black) and CRLF", () => {
    const out = encodeTspl([bm], opts);
    const text = out.toString("latin1");
    expect(text.startsWith("SIZE 1.13 mm,0.25 mm\r\nGAP 3 mm,0 mm\r\nCLS\r\nBITMAP 0,0,2,2,0,")).toBe(true);
    const start = text.indexOf("BITMAP 0,0,2,2,0,") + "BITMAP 0,0,2,2,0,".length;
    expect(Array.from(out.subarray(start, start + 4))).toEqual([0x00, 0xff, 0xff, 0x7f]);
    expect(text.endsWith("\r\nPRINT 1,1\r\n")).toBe(true);
  });
  it("adds DENSITY and SPEED and one label block per bitmap", () => {
    const text = encodeTspl([bm, bm], { ...opts, copies: 2, darkness: 8, speed: 3 }).toString("latin1");
    expect(text.match(/SIZE /g)).toHaveLength(2);
    expect(text).toContain("DENSITY 8\r\nSPEED 3\r\n");
    expect(text).toContain("PRINT 1,2\r\n");
  });
});
