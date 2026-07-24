import { env } from "cloudflare:workers";

type RuntimeBag = Record<string, unknown>;

export function getRuntimeEnv(name: string): string | undefined {
  const workerValue = (env as unknown as RuntimeBag)[name];
  if (typeof workerValue === "string" && workerValue.trim()) {
    return workerValue.trim();
  }
  const nodeValue = process.env[name];
  return nodeValue?.trim() || undefined;
}

export function hasRuntimeEnv(name: string): boolean {
  return Boolean(getRuntimeEnv(name));
}

export function isLocalDevelopment(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    getRuntimeEnv("ALLOW_LOCAL_DEMO") === "true"
  );
}

export function requireRuntimeEnv(name: string): string {
  const value = getRuntimeEnv(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
