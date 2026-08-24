import assert from "node:assert/strict";
import test from "node:test";

import { FMP_FULL_PROFILE } from "../../lib/research/providers/contracts";
import { collectProviderDiagnostics } from "../../lib/research/provider-diagnostics";
import {
  assessResearchRunQuality,
  isSuccessfulResearchRun,
} from "../../lib/research/run-accounting";
import type {
  ProviderRequestMetadata,
  ProviderResult,
} from "../../lib/research/types";

function metadata(warnings: string[]): ProviderRequestMetadata {
  return {
    provider: "fmp",
    mode: "full",
    operation: "quote",
    endpoint: "https://example.test/quote",
    requestedAt: "2026-08-24T13:30:00.000Z",
    receivedAt: "2026-08-24T13:30:01.000Z",
    cache: { state: "miss" },
    warnings,
  };
}

test("static full-provider notices do not prevent a clean run from succeeding", () => {
  const cleanResult: ProviderResult<unknown> = {
    ok: true,
    data: {},
    meta: metadata([...FMP_FULL_PROFILE.warnings]),
  };
  const diagnostics = collectProviderDiagnostics(
    [cleanResult],
    FMP_FULL_PROFILE.warnings,
  );
  assert.deepEqual(diagnostics, []);

  const quality = assessResearchRunQuality({
    providerConfigured: true,
    acceptedSymbolCount: 1,
    recommendationCount: 1,
    blockedByDataCount: 0,
    researchDiagnostics: diagnostics,
    portfolioDiagnostics: [],
  });
  assert.equal(
    isSuccessfulResearchRun({ ...quality, errors: diagnostics }),
    true,
  );
});

test("request failures and stale-fallback warnings remain diagnostics", () => {
  const staleWarning =
    "The provider timed out. Expired cached data was returned and must not receive a live label.";
  const staleResult: ProviderResult<unknown> = {
    ok: true,
    data: {},
    meta: {
      ...metadata([...FMP_FULL_PROFILE.warnings, staleWarning]),
      cache: { state: "stale-fallback" },
    },
  };
  const failedResult: ProviderResult<unknown> = {
    ok: false,
    error: {
      code: "rate-limit",
      message: "The market-data provider rate limit was reached.",
      retryable: true,
    },
    meta: metadata([...FMP_FULL_PROFILE.warnings]),
  };

  assert.deepEqual(
    collectProviderDiagnostics(
      [staleResult, failedResult],
      FMP_FULL_PROFILE.warnings,
    ),
    [
      staleWarning,
      "The market-data provider rate limit was reached.",
    ],
  );
});

test("provider diagnostics redact configured and recognizable secret values", () => {
  const apiKey = "SECRETKEY123456";
  const failedResult: ProviderResult<unknown> = {
    ok: false,
    error: {
      code: "rate-limit",
      message: `API key as ${apiKey} exceeded the limit at https://example.test?q=1&apikey=${apiKey}`,
      retryable: true,
    },
    meta: metadata([]),
  };

  const diagnostics = collectProviderDiagnostics(
    [failedResult],
    [],
    [apiKey],
  );
  assert.equal(diagnostics.join(" ").includes(apiKey), false);
  assert.match(diagnostics[0] ?? "", /\[REDACTED\]/);
});
