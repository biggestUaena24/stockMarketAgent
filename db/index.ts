import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import { runtimeSchemaStatements } from "./runtime-schema";
import { ensureCanonicalOwnerStorage } from "../lib/owner-storage";
import { redactStoredResearchRunSecrets } from "../lib/secret-redaction";
import { getRuntimeEnv } from "../lib/runtime-env";

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
      const configuredOwnerEmail = getRuntimeEnv("OWNER_EMAIL");
      if (configuredOwnerEmail) {
        await ensureCanonicalOwnerStorage(d1, configuredOwnerEmail);
      }
      await redactStoredResearchRunSecrets(
        d1,
        [
          "ALPHA_VANTAGE_API_KEY",
          "FMP_API_KEY",
          "OPENAI_API_KEY",
          "RESEND_API_KEY",
          "SCHEDULER_SECRET",
        ].flatMap((key) => {
          const value = getRuntimeEnv(key);
          return value ? [value] : [];
        }),
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
