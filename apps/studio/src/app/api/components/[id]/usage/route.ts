import { NextResponse } from "next/server";
import { getComponentStore } from "@/lib/component-store";
import { findUsage } from "@/lib/component-usage";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!(await getComponentStore().get(id))) return NextResponse.json({ error: `component not found: ${id}` }, { status: 404 });
  return NextResponse.json(await findUsage(id));
}
