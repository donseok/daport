"use client";
import { useEditor } from "../store";
import { NumberField, SelectField, TextField, CheckField } from "./Field";
import { defaultSource } from "./ElementPalette";

const PRESETS: Record<string, [number, number]> = {
  "A4 세로": [210, 297], "A4 가로": [297, 210], "A3 세로": [297, 420], "A3 가로": [420, 297], "Letter": [215.9, 279.4], "Tag 60×40": [60, 40], "사용자 정의": [0, 0],
};

export function PagePanel() {
  const page = useEditor((s) => s.report.page);
  const updatePage = useEditor((s) => s.updatePage);
  const report = useEditor((s) => s.report);
  const repeat = useEditor((s) => s.report.repeat);
  const setRepeat = useEditor((s) => s.setRepeat);
  const current = Object.entries(PRESETS).find(([, [w, h]]) => w === page.width && h === page.height)?.[0] ?? "사용자 정의";
  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="text-xs font-semibold">페이지</div>
      <SelectField label="프리셋" value={current} options={Object.keys(PRESETS)} onChange={(k) => { const [w, h] = PRESETS[k]; if (w) updatePage({ width: w, height: h }); }} />
      <NumberField label="너비(mm)" value={page.width} onChange={(width) => { if (width > 0) updatePage({ width }); }} />
      <NumberField label="높이(mm)" value={page.height} onChange={(height) => { if (height > 0) updatePage({ height }); }} />

      <div className="text-xs font-semibold mt-2">반복</div>
      <CheckField label="레코드마다 한 부씩" value={!!repeat} onChange={(on) => setRepeat(on ? { source: defaultSource(report), as: "record" } : undefined)} />
      {repeat && <TextField label="반복 소스" value={repeat.source} onChange={(source) => setRepeat({ ...repeat, source })} />}
    </div>
  );
}
