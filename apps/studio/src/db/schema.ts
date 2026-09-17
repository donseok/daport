import { pgTable, text, jsonb, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";

export const reports = pgTable("reports", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  draft: jsonb("draft").notNull(),
  publishedVersionId: integer("published_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const presets = pgTable("presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  body: jsonb("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 컴포넌트 라이브러리(스펙 6.1). 최신 버전 번호와 표시용 이름만 둔다 */
export const components = pgTable("components", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  latestVersion: integer("latest_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 컴포넌트 버전별 불변 내용. 지우거나 고치지 않고, 컴포넌트를 지우면 함께 지워진다 */
export const componentVersions = pgTable("component_versions", {
  componentId: text("component_id").notNull().references(() => components.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  body: jsonb("body").notNull(),
  hash: text("hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.componentId, t.version] })]);
