"use client";
import type { ComponentProp } from "@daport/core";
import { useEditor } from "../store";
import { TextField, NumberField, CheckField, SelectField } from "./Field";

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TYPES: ComponentProp["type"][] = ["string", "number", "boolean", "image"];

/** 타입을 바꾸면 기본값을 그 타입의 빈 값으로 맞춘다 (ComponentPropSchema: default는 타입과 맞아야 한다) */
function withType(p: ComponentProp, type: ComponentProp["type"]): ComponentProp {
  const base = { name: p.name, ...(p.label !== undefined ? { label: p.label } : {}) };
  switch (type) {
    case "number": return { ...base, type, default: 0 };
    case "boolean": return { ...base, type, default: false };
    case "string": return { ...base, type, default: "" };
    case "image": return { ...base, type, default: "" };
  }
}

function nameProblem(props: ComponentProp[], i: number): string | null {
  const name = props[i].name;
  if (!IDENT_RE.test(name)) return "이름은 영문자·숫자·_이며 숫자로 시작할 수 없습니다";
  if (props.some((p, j) => j !== i && p.name === name)) return "이름이 겹칩니다";
  return null;
}

/** 기본값·샘플 값 입력 칸. 타입마다 입력 방식이 다르다 */
function ValueInput({ prop, label, value, onChange }: { prop: ComponentProp; label: string; value: unknown; onChange: (v: string | number | boolean) => void }) {
  if (prop.type === "number") return <NumberField label={label} step={1} value={typeof value === "number" ? value : prop.default} onChange={onChange} />;
  if (prop.type === "boolean") return <CheckField label={label} value={typeof value === "boolean" ? value : prop.default} onChange={onChange} />;
  return <TextField label={label} value={typeof value === "string" ? value : prop.default} onChange={onChange} />;
}

/**
 * 컴포넌트 편집 화면의 입력값 패널 (스펙 7.5). 선언은 setComponentProps(저장 대상, dirty), 샘플 값은 setSampleProps(저장하지 않음, 캔버스·미리보기용).
 * 둘 다 되돌리기 히스토리 밖이다. 이름 규칙 위반·중복은 입력 중에도 커밋하고 경고만 보인다(저장 시 서버가 400으로 거부)
 */
export function PropsPanel() {
  const mode = useEditor((s) => s.componentMode);
  const setComponentProps = useEditor((s) => s.setComponentProps);
  const setSampleProps = useEditor((s) => s.setSampleProps);
  if (!mode) return null;
  const { props, sampleProps } = mode;

  const replaceAt = (i: number, next: ComponentProp) => setComponentProps(props.map((p, j) => (j === i ? next : p)));
  const withoutSample = (name: string) => { const { [name]: _drop, ...rest } = sampleProps; return rest; };

  const add = () => {
    const names = new Set(props.map((p) => p.name));
    let n = 1; while (names.has(`prop${n}`)) n++;
    setComponentProps([...props, { name: `prop${n}`, type: "string", default: "" }]);
  };
  const rename = (i: number, name: string) => {
    const old = props[i].name;
    replaceAt(i, { ...props[i], name });
    if (Object.hasOwn(sampleProps, old)) { const rest = withoutSample(old); setSampleProps({ ...rest, [name]: sampleProps[old] }); }
  };
  const changeType = (i: number, type: ComponentProp["type"]) => {
    if (props[i].type === type) return;
    replaceAt(i, withType(props[i], type));
    if (Object.hasOwn(sampleProps, props[i].name)) setSampleProps(withoutSample(props[i].name));
  };
  const setDefault = (i: number, v: string | number | boolean) => replaceAt(i, { ...props[i], default: v } as ComponentProp);
  const setLabel = (i: number, label: string) => {
    const { label: _old, ...rest } = props[i];
    replaceAt(i, (label === "" ? rest : { ...rest, label }) as ComponentProp);
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...props]; [next[i], next[i + d]] = [next[i + d], next[i]];
    setComponentProps(next);
  };
  const remove = (i: number) => {
    setComponentProps(props.filter((_, j) => j !== i));
    if (Object.hasOwn(sampleProps, props[i].name)) setSampleProps(withoutSample(props[i].name));
  };

  const btn = "text-xs border rounded px-2 py-0.5 bg-white hover:bg-neutral-100 disabled:opacity-40";
  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="text-xs font-semibold">입력값</div>
      <div className="text-[11px] text-neutral-500">요소 안에서 {"{{ props.이름 }}"}으로 읽습니다</div>
      {props.map((p, i) => {
        const problem = nameProblem(props, i);
        return (
          <fieldset key={i} data-testid={`prop-${i}`} className="border rounded p-2 flex flex-col gap-1">
            <TextField label="이름" value={p.name} onChange={(v) => rename(i, v)} />
            {problem && <div className="text-xs text-red-700">{problem}</div>}
            <SelectField label="타입" value={p.type} options={TYPES} onChange={(t) => changeType(i, t)} />
            <ValueInput prop={p} label="기본값" value={p.default} onChange={(v) => setDefault(i, v)} />
            <TextField label="라벨" value={p.label ?? ""} onChange={(v) => setLabel(i, v)} />
            <ValueInput prop={p} label="샘플 값" value={sampleProps[p.name]} onChange={(v) => setSampleProps({ ...sampleProps, [p.name]: v })} />
            <div className="flex gap-1 mt-1">
              <button className={btn} disabled={i === 0} onClick={() => move(i, -1)}>위로</button>
              <button className={btn} disabled={i === props.length - 1} onClick={() => move(i, 1)}>아래로</button>
              <button className={btn + " ml-auto"} onClick={() => remove(i)}>삭제</button>
            </div>
          </fieldset>
        );
      })}
      <button className={btn + " self-start"} onClick={add}>입력값 추가</button>
    </div>
  );
}
