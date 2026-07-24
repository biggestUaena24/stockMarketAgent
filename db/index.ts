import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import { runtimeSchemaStatements } from "./runtime-schema";

let schemaReady: Promise<void> | null = null;

export function getRawDb(): D1Database {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. The app requires `d1: \"DB\"` in .openai/hosting.json.",
    );
  }
  return env.DB;
}

export function getDb() {
  return drizzle(getRawDb(), { schema });
}

export async function ensureDatabase(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const d1 = getRawDb();
      await d1.batch(
        runtimeSchemaStatements.map((statement) => d1.prepare(statement)),
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export async function getReadyDb() {
  await ensureDatabase();
  return getDb();
}
