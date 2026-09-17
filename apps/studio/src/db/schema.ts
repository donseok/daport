import { pgTable, text, jsonb, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";

export const reports = pgTable("reports", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  draft: jsonb("draft").notNull(),
  /** 저장 때 계산한 draft의 reportHash. 배포 버전 해시와 비교해 "수정됨"을 판정한다 (4단계 스펙 4.1). 옛 행은 null */
  draftHash: text("draft_hash"),
  /** 배포 포인터. null이면 미배포 */
  publishedVersion: integer("published_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 배포 버전의 불변 모델 (4단계 스펙 4.1). 레포트를 지우면 함께 지워진다 */
export const reportVersions = pgTable("report_versions", {
  reportId: text("report_id").notNull().references(() => reports.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  model: jsonb("model").notNull(),
  hash: text("hash").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.reportId, t.version] })]);

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

/** MES용 API 키 (4단계 스펙 4.3). 원문은 저장하지 않고 sha256만 둔다. allowed_report_ids가 null이면 전체 허용 */
export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  allowedReportIds: text("allowed_report_ids").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
