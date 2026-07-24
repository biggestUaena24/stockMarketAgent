declare module "cloudflare:workers" {
  export const env: Record<string, unknown> & {
    DB?: D1Database;
  };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(
    columnName?: string,
  ): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{
    results: T[];
    success: boolean;
    meta: Record<string, unknown>;
  }>;
  run(): Promise<{
    success: boolean;
    meta: Record<string, unknown>;
  }>;
  raw<T = unknown[]>(): Promise<T[]>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<T[]>;
  exec(query: string): Promise<{
    count: number;
    duration: number;
  }>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
