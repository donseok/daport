const PX_PER_MM = 96 / 25.4;
export function snapMm(v: number, grid = 0.5): number { return Math.round(v / grid) * grid; }
export function pxToMm(px: number, zoom: number): number { return px / PX_PER_MM / zoom; }
export function mmToPxScaled(mm: number, zoom: number): number { return mm * PX_PER_MM * zoom; }
