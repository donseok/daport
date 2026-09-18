import { describe, it, expect } from "vitest";
import { DatasetFailure } from "@daport/datasource";
import { convertColumnType, isTzType, dateToIso, numberFromString, convertRow, sanitizeError, mapOracleError } from "../convert";

describe("convert", () => {
  it("maps Oracle db types to field types", () => {
    expect(convertColumnType("VARCHAR2")).toBe("string"); expect(convertColumnType("NCLOB")).toBe("string");
    expect(convertColumnType("NUMBER")).toBe("number"); expect(convertColumnType("BINARY_DOUBLE")).toBe("number");
    expect(convertColumnType("DATE")).toBe("date"); expect(convertColumnType("TIMESTAMP(6) WITH TIME ZONE")).toBe("date");
    expect(convertColumnType("BOOLEAN")).toBe("boolean");
    expect(convertColumnType("BLOB")).toBeNull(); expect(convertColumnType("RAW")).toBeNull(); expect(convertColumnType("XMLTYPE")).toBeNull();
    expect(isTzType("TIMESTAMP(6) WITH TIME ZONE")).toBe(true); expect(isTzType("TIMESTAMP WITH LOCAL TIME ZONE")).toBe(true); expect(isTzType("DATE")).toBe(false);
  });
  it("dateToIso reads wall-clock components as UTC for DATE/TIMESTAMP and the instant for TZ types", () => {
    const d = new Date(2026, 8, 18, 9, 30, 0, 0);   // 프로세스 로컬 시간 2026-09-18 09:30
    expect(dateToIso(d, false)).toBe("2026-09-18T09:30:00.000Z");
    expect(dateToIso(new Date("2026-09-18T00:30:00.000Z"), true)).toBe("2026-09-18T00:30:00.000Z");
  });
  it("numberFromString keeps safe numbers and falls back to strings", () => {
    expect(numberFromString("42")).toBe(42); expect(numberFromString("-3.25")).toBe(-3.25); expect(numberFromString("1e3")).toBe(1000);
    expect(numberFromString("12345678901234567890")).toBe("12345678901234567890");
    expect(numberFromString("0.30000000000000004441")).toBe("0.30000000000000004441");
    expect(numberFromString("abc")).toBe("abc");
  });
  it("convertRow applies per-column rules and rejects unsupported types", () => {
    const meta = [{ name: "NO", dbTypeName: "VARCHAR2" }, { name: "QTY", dbTypeName: "NUMBER" }, { name: "DT", dbTypeName: "DATE" }, { name: "TS", dbTypeName: "TIMESTAMP(6) WITH TIME ZONE" }, { name: "NOTE", dbTypeName: "CLOB" }];
    const row = convertRow({ NO: "A", QTY: "7", DT: new Date(2026, 0, 2, 3, 4, 5), TS: new Date("2026-01-02T03:04:05.000Z"), NOTE: null }, meta);
    expect(row).toEqual({ NO: "A", QTY: 7, DT: "2026-01-02T03:04:05.000Z", TS: "2026-01-02T03:04:05.000Z", NOTE: null });
    expect(() => convertRow({ B: Buffer.from("x") }, [{ name: "B", dbTypeName: "BLOB" }])).toThrow(/지원하지 않는 컬럼 타입: B/);
  });
  it("sanitizeError masks secrets and mapOracleError classifies", () => {
    expect(sanitizeError("ORA-01017: invalid username/password pw=s3cret", ["s3cret"])).toBe("ORA-01017: invalid username/password pw=***");
    expect(mapOracleError(new Error("NJS-123: call timeout of 30000 ms exceeded"), []).code).toBe("TIMEOUT");
    expect(mapOracleError(new Error("ORA-01013: user requested cancel of current operation"), []).code).toBe("TIMEOUT");
    const conn = mapOracleError(new Error("NJS-501: connection to host db.local port 1521 refused"), []);
    expect(conn.code).toBe("SQL_ERROR"); expect(conn.message).toMatch(/^연결 실패: NJS-501/);
    expect(mapOracleError(new Error("ORA-00942: table or view does not exist"), []).message).toBe("ORA-00942: table or view does not exist");
    const pass = new DatasetFailure("TOO_MANY_ROWS", "x");
    expect(mapOracleError(pass, [])).toBe(pass);
  });
});
