import { NextResponse } from "next/server";
import { ready } from "@/lib/report-store";
import { authorize } from "@/lib/auth";
import { readJsonBody, objectField, MAX_BODY_BYTES } from "@/lib/body";
import { renderReport, renderErrorResponse, contentDisposition, isRenderFormat } from "@/lib/render";
import { withCors, preflight } from "@/lib/cors";
import { pickVersion } from "@/lib/pick-version";

export const maxDuration = 60;

export async function OPTIONS(req: Request) { return preflight(req); }

/** MES용 렌더 API (4단계 스펙 5.2). X-API-Key 필수, 본문 { format, params?, data?, version? }. report·props 필드는 무시한다 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(req, id);
  if (!auth.ok) return withCors(req, auth.response);
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return withCors(req, parsed.response);
  const body = parsed.body;
  if (!isRenderFormat(body.format)) return withCors(req, NextResponse.json({ error: "format은 html·pdf·zpl·tspl·png 중 하나여야 합니다" }, { status: 400 }));
  if (body.version !== undefined && !Number.isInteger(body.version)) return withCors(req, NextResponse.json({ error: "version은 정수여야 합니다" }, { status: 400 }));
  try {
    await ready();
    const picked = await pickVersion(id, body.version as number | undefined);
    if ("error" in picked) return withCors(req, picked.error);
    const out = await renderReport(picked.report, { format: body.format, params: objectField(body, "params"), data: objectField(body, "data"), origin: new URL(req.url).origin });
    const headers: Record<string, string> = { "content-type": out.mime, "x-daport-version": String(picked.version) };
    if (body.format !== "html") headers["content-disposition"] = contentDisposition(picked.report, out.filename.split(".").pop()!);
    if (out.pages !== undefined) headers["x-daport-pages"] = String(out.pages);
    return withCors(req, new NextResponse(typeof out.body === "string" ? out.body : new Uint8Array(out.body), { headers }));
  } catch (e) {
    return withCors(req, renderErrorResponse(e));
  }
}
