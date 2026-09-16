export type Unit = "mm" | "pt" | "px";
const PT_PER_INCH = 72;
const PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;

export function toMm(value: number, unit: Unit): number {
  if (unit === "mm") return value;
  if (unit === "pt") return (value / PT_PER_INCH) * MM_PER_INCH;
  return (value / PX_PER_INCH) * MM_PER_INCH;
}
export function mmToPx(mm: number): number { return (mm / MM_PER_INCH) * PX_PER_INCH; }
export function mmToPt(mm: number): number { return (mm / MM_PER_INCH) * PT_PER_INCH; }
export function ptToMm(pt: number): number { return toMm(pt, "pt"); }
