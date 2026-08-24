export type OwnerStatus =
  | "authorized"
  | "owner_unconfigured"
  | "forbidden"
  | "unauthenticated";

export function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-CA");
}

export function canonicalOwnerStorageKey(
  configuredOwnerEmail: string | null | undefined,
): string | null {
  if (!configuredOwnerEmail) return null;
  const normalized = normalizeEmail(configuredOwnerEmail);
  return normalized || null;
}

export function evaluateOwnerStatus(input: {
  userEmail: string | null;
  configuredOwnerEmail: string | null;
  localDevelopment: boolean;
}): OwnerStatus {
  if (input.localDevelopment && !input.userEmail) return "authorized";
  if (!input.userEmail) return "unauthenticated";
  if (!input.configuredOwnerEmail) return "owner_unconfigured";
  return normalizeEmail(input.userEmail) ===
    normalizeEmail(input.configuredOwnerEmail)
    ? "authorized"
    : "forbidden";
}

export function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    mismatch |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}
