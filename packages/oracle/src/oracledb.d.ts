/**
 * oracledb(npm) 패키지는 자체 타입 선언을 포함하지 않고, @types/oracledb는 설치돼 있지 않다(4b 태스크 3 시점).
 * 이 모듈이 실제로 쓰는 만큼만 최소 앰비언트 선언으로 채운다. 실 드라이버 동작은 __it__ 통합 테스트가 검증한다.
 */
declare module "oracledb" {
  namespace oracledb {
    interface Result<T = unknown> {
      rows?: T[];
      metaData?: { name: string; dbTypeName?: string }[];
    }
    interface Connection {
      callTimeout: number;
      execute<T = unknown>(
        sql: string,
        binds?: Record<string, unknown> | unknown[],
        options?: Record<string, unknown>,
      ): Promise<Result<T>>;
      close(): Promise<void>;
    }
    interface Pool {
      getConnection(): Promise<Connection>;
      close(drainTime?: number): Promise<void>;
    }
    interface PoolAttributes {
      user?: string;
      password?: string;
      connectString?: string;
      poolMin?: number;
      poolMax?: number;
      poolTimeout?: number;
      sessionCallback?: (connection: Connection, requestedTag: string, callback: (err?: Error) => void) => void;
    }
  }

  const oracledb: {
    createPool(attrs: oracledb.PoolAttributes): Promise<oracledb.Pool>;
    OUT_FORMAT_OBJECT: number;
    STRING: number;
  };

  export = oracledb;
}
