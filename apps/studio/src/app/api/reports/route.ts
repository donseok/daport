import { NextResponse } from "next/server";
import { getStore } from "@/lib/report-store";

export async function GET() { return NextResponse.json(await getStore().list()); }

export async function POST(req: Request) {
  try {
    const r = await getStore().create(await req.json());
    return NextResponse.json(r, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
