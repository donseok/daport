import type { ChatTurn, EditContext } from "./types";
import { MAX_CONTEXT_TOKENS } from "./types";
import { compactFields, compactLibrary, compactReport, estimateTokens } from "./compact";
import { summarizeSchema } from "./schema-summary";
import { EDIT_SYSTEM } from "./prompts/edit.ko";
import { GENERATE_SYSTEM } from "./prompts/generate.ko";
import { IMPORT_SYSTEM } from "./prompts/import.ko";
import { EDIT_RESPONSE_SCHEMA, GENERATE_RESPONSE_SCHEMA, IMPORT_RESPONSE_SCHEMA } from "./response-schema";

export type PromptBundle = {
  system: string;
  messages: { role: "user" | "model"; text: string }[];
  schema: object;
  truncated: string[];
};

type FitOpts = { text: number; depth: number; maxLines?: number };

/** ChatTurn(assistant/user)을 Gemini 메시지 role(model/user)로 바꾼다 */
const historyToMessages = (history: ChatTurn[]): { role: "user" | "model"; text: string }[] =>
  history.map((h) => ({ role: h.role === "assistant" ? ("model" as const) : ("user" as const), text: h.text }));

/**
 * 컨텍스트가 MAX_CONTEXT_TOKENS를 넘으면 이력 → 요소 텍스트 → 트리 깊이 → 요소 줄 수 순으로 줄인다.
 * 각 단계에서 상한 이하가 되면 즉시 멈추고, 무엇을 줄였는지 truncated에 남긴다
 */
function fit(parts: { system: string; history: ChatTurn[]; body: (opts: FitOpts) => string }): {
  history: ChatTurn[];
  body: string;
  truncated: string[];
} {
  const truncated: string[] = [];
  const evaluate = (history: ChatTurn[], opts: FitOpts) => {
    const body = parts.body(opts);
    const historyText = history.map((h) => h.text).join("");
    return { body, total: estimateTokens(parts.system + historyText + body) };
  };

  let history = parts.history;
  let opts: FitOpts = { text: 40, depth: 3 };
  let result = evaluate(history, opts);
  if (result.total <= MAX_CONTEXT_TOKENS) return { history, body: result.body, truncated };

  if (history.length > 0) {
    history = [];
    truncated.push("history");
    result = evaluate(history, opts);
    if (result.total <= MAX_CONTEXT_TOKENS) return { history, body: result.body, truncated };
  }

  opts = { ...opts, text: 16 };
  truncated.push("element-text");
  result = evaluate(history, opts);
  if (result.total <= MAX_CONTEXT_TOKENS) return { history, body: result.body, truncated };

  opts = { ...opts, depth: 1 };
  truncated.push("tree-depth");
  result = evaluate(history, opts);
  if (result.total <= MAX_CONTEXT_TOKENS) return { history, body: result.body, truncated };

  opts = { ...opts, maxLines: 300 };
  truncated.push("elements");
  result = evaluate(history, opts);
  return { history, body: result.body, truncated };
}

/**
 * 현재 모델(요소 트리) 섹션. 맨 위에 페이지 크기·여백 한 줄을 붙인다(compactReport는
 * 첫 줄이 반드시 요소 줄이어야 해서 페이지 정보를 넣지 않으므로 여기서 보충한다).
 * maxLines가 있으면 요소 줄만 앞에서부터 그만큼 남긴다
 */
function renderModel(ctx: Pick<EditContext, "report">, opts: FitOpts): string {
  const { width, height, margin } = ctx.report.page;
  const pageLine = `page ${width}×${height}mm margin ${margin.join(",")}`;
  const compacted = compactReport(ctx.report, { text: opts.text, depth: opts.depth });
  const elementLines = opts.maxLines === undefined ? compacted : compacted.split("\n").slice(0, opts.maxLines).join("\n");
  return elementLines.length > 0 ? `${pageLine}\n${elementLines}` : pageLine;
}

/** 편집·생성 프롬프트가 공유하는 섹션(현재 모델/데이터 필드/파라미터/컴포넌트 라이브러리) */
function renderCommonSections(ctx: Pick<EditContext, "report" | "fields" | "library">, opts: FitOpts): string[] {
  const hasFields = Object.values(ctx.fields).some((nodes) => nodes.length > 0);
  const fieldsText = hasFields ? compactFields(ctx.fields) : "(없음)";
  const paramsText = ctx.report.params.length > 0
    ? `params: ${ctx.report.params.map((p) => `${p.name}(${p.type})`).join(", ")}`
    : "params: (없음)";
  const libraryText = ctx.library.length > 0 ? compactLibrary(ctx.library) : "(없음)";
  return [
    `# 현재 모델\n${renderModel(ctx, opts)}`,
    `# 데이터 필드\n${fieldsText}`,
    `# 파라미터\n${paramsText}`,
    `# 컴포넌트 라이브러리\n${libraryText}`,
  ];
}

function renderEditBody(ctx: EditContext, instruction: string, opts: FitOpts): string {
  const sections = renderCommonSections(ctx, opts);
  sections.push(`# 선택\n선택: ${ctx.selection.join(", ")}`);
  sections.push(`# 지시\n${instruction}`);
  return sections.join("\n\n");
}

function renderGenerateBody(ctx: Omit<EditContext, "selection" | "history">, brief: string, opts: FitOpts): string {
  const sections = renderCommonSections(ctx, opts);
  sections.push(`# 요청\n${brief}`);
  return sections.join("\n\n");
}

/** 자연어 편집 지시로부터 프롬프트를 만든다. 컨텍스트가 상한을 넘으면 이력→텍스트→깊이→요소 수 순으로 줄인다 */
export function buildEditPrompt(ctx: EditContext, instruction: string): PromptBundle {
  const system = EDIT_SYSTEM(summarizeSchema());
  const { history, body, truncated } = fit({
    system,
    history: ctx.history,
    body: (opts) => renderEditBody(ctx, instruction, opts),
  });
  return {
    system,
    messages: [...historyToMessages(history), { role: "user", text: body }],
    schema: EDIT_RESPONSE_SCHEMA,
    truncated,
  };
}

/** 빈 레포트에서 페이지 전체를 만드는 생성 프롬프트를 만든다. 이력·선택은 없다 */
export function buildGeneratePrompt(ctx: Omit<EditContext, "selection" | "history">, brief: string): PromptBundle {
  const system = GENERATE_SYSTEM(summarizeSchema());
  const { history, body, truncated } = fit({
    system,
    history: [],
    body: (opts) => renderGenerateBody(ctx, brief, opts),
  });
  return {
    system,
    messages: [...historyToMessages(history), { role: "user", text: body }],
    schema: GENERATE_RESPONSE_SCHEMA,
    truncated,
  };
}

/** 이관 프롬프트 (스펙 5.3). 컨텍스트는 페이지 크기뿐이다 — 빈 레포트에서만 시작하므로 압축할 모델이 없다 */
export function buildImportPrompt(page: { width: number; height: number }, image: { mimeType: string; data: string }) {
  const text = `# 대상 페이지\n${page.width}×${page.height}mm\n\n# 지시\n이 이미지의 양식을 위 페이지 크기의 레포트로 옮기세요.`;
  return { system: IMPORT_SYSTEM, messages: [{ role: "user" as const, text }], schema: IMPORT_RESPONSE_SCHEMA, images: [image] };
}
