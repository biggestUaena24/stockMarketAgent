import type { ProviderResult } from "./types";

export function collectProviderDiagnostics(
  results: readonly ProviderResult<unknown>[],
  profileNotices: readonly string[],
): string[] {
  const informational = new Set(
    profileNotices.map((notice) => notice.trim()).filter(Boolean),
  );
  const diagnostics = results.flatMap((result) => [
    ...(result.ok ? [] : [result.error.message]),
    ...result.meta.warnings.filter(
      (warning) => !informational.has(warning.trim()),
    ),
  ]);
  return [...new Set(diagnostics.map((item) => item.trim()).filter(Boolean))];
}
