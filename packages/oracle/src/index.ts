import type { SqlConnector } from "@daport/datasource";

export type ManagedConnector = SqlConnector & { ping(): Promise<void>; close(): Promise<void> };
export * from "./convert";
export { FakeSqlConnector } from "./testing";
