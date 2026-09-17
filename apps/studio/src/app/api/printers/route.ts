import { NextResponse } from "next/server";
import { parsePrinters } from "@/lib/printers";

/** 허용 목록의 이름만. 호스트·포트는 노출하지 않는다 */
export function GET() { return NextResponse.json(parsePrinters(process.env.DAPORT_PRINTERS).map((p) => ({ name: p.name }))); }
