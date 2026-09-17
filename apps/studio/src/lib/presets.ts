import { PresetSchema, type Preset } from "@daport/core";

const page = (width: number, height: number, margin: [number, number, number, number] = [10, 10, 10, 10]) => ({ width, height, margin });
const zpl203 = { kind: "label" as const, label: { language: "zpl" as const, dpi: 203 as const } };

/** 내장 프리셋 (스펙 4.3). 사용자 정의는 저장소에 둔다 */
export const BUILTIN_PRESETS: Preset[] = [
  { id: "a4-portrait", name: "A4 세로", page: page(210, 297) },
  { id: "a4-landscape", name: "A4 가로", page: page(297, 210) },
  { id: "a3-portrait", name: "A3 세로", page: page(297, 420) },
  { id: "a3-landscape", name: "A3 가로", page: page(420, 297) },
  { id: "letter", name: "Letter", page: page(215.9, 279.4) },
  { id: "coil-tag-100x150", name: "코일 Tag 100×150 · ZPL 203dpi", page: page(100, 150, [3, 3, 3, 3]), output: zpl203 },
  { id: "product-label-60x40", name: "제품 라벨 60×40 · ZPL 203dpi", page: page(60, 40, [2, 2, 2, 2]), output: zpl203 },
].map((p) => PresetSchema.parse({ ...p, builtin: true }));

export const isBuiltinPresetId = (id: string) => BUILTIN_PRESETS.some((p) => p.id === id);
