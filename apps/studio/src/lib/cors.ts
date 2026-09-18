/** DAPORT_CORS_ORIGINS: MES 프론트 origin의 쉼표 목록 (4단계 스펙 5.5) */
export function parseOrigins(env: string | undefined): string[] {
  return (env ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** 요청 origin이 허용 목록에 있을 때만 CORS 헤더. 없으면 빈 객체(브라우저가 막는다) */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !parseOrigins(process.env.DAPORT_CORS_ORIGINS).includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type, x-api-key",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-expose-headers": "x-daport-version, content-disposition, x-daport-pages",
    "vary": "origin",
  };
}

export function withCors(req: Request, res: Response): Response {
  for (const [k, v] of Object.entries(corsHeaders(req))) res.headers.set(k, v);
  return res;
}

export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}
