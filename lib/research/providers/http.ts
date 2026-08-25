import type {
  ProviderError,
  ProviderRequestMetadata,
  ProviderResult,
  ResearchProviderProfile,
} from "../types";

export interface ProviderCacheEntry<T> {
  data: T;
  storedAt: string;
  expiresAt: string;
}

export interface ProviderCache {
  get<T>(key: string): Promise<ProviderCacheEntry<T> | null>;
  set<T>(key: string, entry: ProviderCacheEntry<T>): Promise<void>;
  delete?(key: string): Promise<void>;
}

export class MemoryProviderCache implements ProviderCache {
  private readonly entries = new Map<string, ProviderCacheEntry<unknown>>();

  async get<T>(key: string): Promise<ProviderCacheEntry<T> | null> {
    return (this.entries.get(key) as ProviderCacheEntry<T> | undefined) ?? null;
  }

  async set<T>(key: string, entry: ProviderCacheEntry<T>): Promise<void> {
    this.entries.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface JsonRequestOptions<T = unknown> {
  profile: ResearchProviderProfile;
  operation: string;
  url: URL;
  cacheKey: string;
  cacheTtlMs: number;
  timeoutMs?: number;
  fetcher?: FetchLike;
  cache?: ProviderCache;
  now?: () => Date;
  payloadError?: (data: T) => ProviderError | null;
  beforeNetwork?: (
    context: ProviderPreNetworkContext,
  ) => ProviderError | null | Promise<ProviderError | null>;
  onError?: (error: ProviderError) => void;
}

export interface ProviderPreNetworkContext {
  operation: string;
  cacheKey: string;
  requestedAt: string;
}

function endpointWithoutSecrets(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

function metadata<T>(
  options: JsonRequestOptions<T>,
  requestedAt: string,
): ProviderRequestMetadata {
  return {
    provider: options.profile.id,
    mode: options.profile.mode,
    operation: options.operation,
    endpoint: endpointWithoutSecrets(options.url),
    requestedAt,
    cache: {
      state: options.cache ? "miss" : "not-configured",
      key: options.cache ? options.cacheKey : undefined,
    },
    warnings: [...options.profile.warnings],
  };
}

function httpError(status: number): ProviderError {
  if (status === 401 || status === 403) {
    return {
      code: "authorization",
      message: "The market-data provider rejected the credentials.",
      retryable: false,
      status,
    };
  }
  if (status === 404) {
    return {
      code: "not-found",
      message: "The requested market-data resource was not found.",
      retryable: false,
      status,
    };
  }
  if (status === 429) {
    return {
      code: "rate-limit",
      message: "The market-data provider rate limit was reached.",
      retryable: true,
      status,
    };
  }
  return {
    code: "upstream",
    message: `The market-data provider returned HTTP ${status}.`,
    retryable: status >= 500,
    status,
  };
}

function networkError(error: unknown): ProviderError {
  const isAbort =
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError";
  return isAbort
    ? {
        code: "timeout",
        message: "The market-data provider request timed out.",
        retryable: true,
      }
    : {
        code: "network",
        message: "The market-data provider could not be reached.",
        retryable: true,
      };
}

function staleFallback<T>(
  entry: ProviderCacheEntry<T> | null,
  baseMeta: ProviderRequestMetadata,
  error: ProviderError,
): ProviderResult<T> | null {
  if (!entry) {
    return null;
  }

  return {
    ok: true,
    data: entry.data,
    meta: {
      ...baseMeta,
      receivedAt: baseMeta.requestedAt,
      cache: {
        state: "stale-fallback",
        key: baseMeta.cache.key,
        storedAt: entry.storedAt,
        expiresAt: entry.expiresAt,
      },
      warnings: [
        ...baseMeta.warnings,
        `${error.message} Expired cached data was returned and must not receive a live label.`,
      ],
    },
  };
}

function reportError<T>(
  options: JsonRequestOptions<T>,
  error: ProviderError,
): ProviderError {
  options.onError?.(error);
  return error;
}

function preNetworkFailure(): ProviderError {
  return {
    code: "upstream",
    message: "The market-data request guard could not reserve a request.",
    retryable: true,
  };
}

export async function requestJson<T>(
  options: JsonRequestOptions<T>,
): Promise<ProviderResult<T>> {
  const now = options.now ?? (() => new Date());
  const requestedAtDate = now();
  const requestedAt = requestedAtDate.toISOString();
  const baseMeta = metadata(options, requestedAt);
  let cached = options.cache
    ? await options.cache.get<T>(options.cacheKey)
    : null;

  if (cached && options.payloadError?.(cached.data)) {
    await options.cache?.delete?.(options.cacheKey);
    cached = null;
  }

  if (cached && Date.parse(cached.expiresAt) > requestedAtDate.getTime()) {
    return {
      ok: true,
      data: cached.data,
      meta: {
        ...baseMeta,
        receivedAt: requestedAt,
        cache: {
          state: "hit",
          key: options.cacheKey,
          storedAt: cached.storedAt,
          expiresAt: cached.expiresAt,
        },
      },
    };
  }


  if (options.beforeNetwork) {
    let blocked: ProviderError | null;
    try {
      blocked = await options.beforeNetwork({
        operation: options.operation,
        cacheKey: options.cacheKey,
        requestedAt,
      });
    } catch {
      blocked = preNetworkFailure();
    }
    if (blocked) {
      const normalized = reportError(options, blocked);
      const fallback = staleFallback(cached, baseMeta, normalized);
      if (fallback) return fallback;
      return { ok: false, error: normalized, meta: baseMeta };
    }
  }

  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 10_000,
  );

  let response: Response;
  try {
    response = await fetcher(options.url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    const normalized = reportError(options, networkError(error));
    const fallback = staleFallback(cached, baseMeta, normalized);
    if (fallback) {
      return fallback;
    }
    return { ok: false, error: normalized, meta: baseMeta };
  } finally {
    clearTimeout(timeout);
  }

  const receivedAtDate = now();
  const receivedAt = receivedAtDate.toISOString();
  if (!response.ok) {
    const normalized = reportError(options, httpError(response.status));
    const fallback = staleFallback(cached, baseMeta, normalized);
    if (fallback) {
      return fallback;
    }
    return {
      ok: false,
      error: normalized,
      meta: { ...baseMeta, receivedAt },
    };
  }

  let data: T;
  try {
    data = (await response.json()) as T;
  } catch {
    const normalized = reportError(options, {
      code: "malformed-response",
      message: "The market-data provider returned invalid JSON.",
      retryable: true,
    });
    const fallback = staleFallback(cached, baseMeta, normalized);
    if (fallback) return fallback;
    return {
      ok: false,
      error: normalized,
      meta: { ...baseMeta, receivedAt },
    };
  }

  const payloadError = options.payloadError?.(data);
  if (payloadError) {
    const normalized = reportError(options, payloadError);
    const fallback = staleFallback(cached, baseMeta, normalized);
    if (fallback) return fallback;
    return {
      ok: false,
      error: normalized,
      meta: { ...baseMeta, receivedAt },
    };
  }

  const expiresAt = new Date(
    receivedAtDate.getTime() + options.cacheTtlMs,
  ).toISOString();
  if (options.cache) {
    await options.cache.set(options.cacheKey, {
      data,
      storedAt: receivedAt,
      expiresAt,
    });
  }

  return {
    ok: true,
    data,
    meta: {
      ...baseMeta,
      receivedAt,
      cache: {
        state: options.cache ? "miss" : "not-configured",
        key: options.cache ? options.cacheKey : undefined,
        storedAt: options.cache ? receivedAt : undefined,
        expiresAt: options.cache ? expiresAt : undefined,
      },
    },
  };
}

export function configurationError<T>(
  profile: ResearchProviderProfile,
  operation: string,
  message: string,
  now = new Date(),
): ProviderResult<T> {
  return {
    ok: false,
    error: {
      code: "configuration",
      message,
      retryable: false,
    },
    meta: {
      provider: profile.id,
      mode: profile.mode,
      operation,
      endpoint: "",
      requestedAt: now.toISOString(),
      cache: { state: "not-configured" },
      warnings: [...profile.warnings],
    },
  };
}

export function malformedResponse<T>(
  source: ProviderResult<unknown>,
  message: string,
): ProviderResult<T> {
  return {
    ok: false,
    error: {
      code: "malformed-response",
      message,
      retryable: false,
    },
    meta: source.meta,
  };
}
