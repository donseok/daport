import { NextResponse } from "next/server";
import { reportJsonSchema } from "@daport/core";
export function GET() { return NextResponse.json(reportJsonSchema()); }
