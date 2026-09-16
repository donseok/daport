import type { ReactNode } from "react";
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex items-center gap-2 text-xs"><span className="w-16 shrink-0 text-neutral-500">{label}</span>{children}</label>;
}
/** min보다 작은 값은 커밋하지 않는다. 스토어의 편집은 스키마 검증을 거치지 않아, 음수 크기 등이 들어가면 저장이 400으로 실패한다 */
export function NumberField({ label, value, onChange, step = 0.5, min }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  return <Field label={label}><input aria-label={label} type="number" step={step} min={min} value={value} className="w-full border rounded px-1 py-0.5"
    onChange={(e) => { const n = e.target.valueAsNumber; if (Number.isFinite(n) && (min === undefined || n >= min)) onChange(n); }} /></Field>;   // 빈 값·입력 중인 "-" 등은 NaN이라 커밋하지 않는다
}
export function TextField({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return <Field label={label}>{multiline
    ? <textarea aria-label={label} value={value} rows={3} className="w-full border rounded px-1 py-0.5" onChange={(e) => onChange(e.target.value)} />
    : <input aria-label={label} type="text" value={value} className="w-full border rounded px-1 py-0.5" onChange={(e) => onChange(e.target.value)} />}</Field>;
}
export function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: T[]; onChange: (v: T) => void }) {
  return <Field label={label}><select aria-label={label} value={value} className="w-full border rounded px-1 py-0.5" onChange={(e) => onChange(e.target.value as T)}>
    {options.map((o) => <option key={o} value={o}>{o}</option>)}</select></Field>;
}
export function CheckField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <Field label={label}><input aria-label={label} type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /></Field>;
}
