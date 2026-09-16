import { z } from "zod";
import { ReportSchema } from "./report";

export function reportJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ReportSchema, { target: "draft-7", io: "input", unrepresentable: "any" }) as Record<string, unknown>;
}
