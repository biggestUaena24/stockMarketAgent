const BUILTIN_SECRET_PATTERNS = [
  /(api\s*key(?:\s+(?:as|is)|\s*[:=])\s*)[A-Za-z0-9_-]{8,}/gi,
  /([?&](?:api_?key|apikey|token)=)[^&\s"']+/gi,
  /(\b)sk-[A-Za-z0-9_-]{12,}\b/g,
] as const;

export function redactSensitiveText(
  value: string,
  sensitiveValues: readonly string[] = [],
): string {
  let redacted = value;
  const uniqueValues = Array.from(
    new Set(
      sensitiveValues
        .map((item) => item.trim())
        .filter((item) => item.length >= 4),
    ),
  ).sort((left, right) => right.length - left.length);
  for (const secret of uniqueValues) {
    redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  for (const pattern of BUILTIN_SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "$1[REDACTED]");
  }
  return redacted;
}

export async function redactStoredResearchRunSecrets(
  d1: D1Database,
  sensitiveValues: readonly string[],
): Promise<void> {
  const secrets = Array.from(
    new Set(
      sensitiveValues
        .map((item) => item.trim())
        .filter((item) => item.length >= 4),
    ),
  );
  if (secrets.length === 0) return;

  await d1.batch(
    secrets.map((secret) =>
      d1
        .prepare(
          `UPDATE research_runs
           SET errors_json = replace(errors_json, ?, '[REDACTED]')
           WHERE instr(errors_json, ?) > 0`,
        )
        .bind(secret, secret),
    ),
  );
}
