import { pgTable, text, jsonb, timestamp, integer } from "drizzle-orm/pg-core";

export const reports = pgTable("reports", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  draft: jsonb("draft").notNull(),
  publishedVersionId: integer("published_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
