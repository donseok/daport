import { NextResponse } from "next/server";
import type { PresetInput } from "@daport/core";
import { getPresetStore, ConflictError } from "@/lib/preset-store";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";

export async function GET() { return NextResponse.json(await getPresetStore().list()); }

export async function POST(req: Request) {
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  try {
    return NextResponse.json(await getPresetStore().create(parsed.body as PresetInput), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof ConflictError ? 409 : 400 });
  }
}
