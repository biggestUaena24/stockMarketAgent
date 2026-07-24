"use client";

import { useCallback, useEffect, useState } from "react";

export function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const payload = (await response.json()) as T & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Request failed.");
      setData(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(url, {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        const payload = (await response.json()) as T & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Request failed.");
        if (active) setData(payload);
      } catch (caught) {
        if (active) {
          setError(
            caught instanceof Error ? caught.message : "Request failed.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [url]);

  return { data, error, loading, reload, setData };
}

export async function apiRequest<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body instanceof FormData
        ? {}
        : { "content-type": "application/json" }),
      ...init.headers,
    },
  });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : `Request failed (${response.status}).`;
    throw new Error(detail);
  }
  return payload as T;
}

export function money(
  value: number | null | undefined,
  currency: "CAD" | "USD" = "CAD",
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function percent(
  value: number | null | undefined,
  digits = 1,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(digits)}%`;
}

export function dateTime(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not available";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function dateOnly(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not available";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    dateStyle: "medium",
  }).format(new Date(value));
}

export function actionTone(
  action: string,
): "neutral" | "good" | "watch" | "risk" | "info" {
  const value = action.toLowerCase();
  if (value.includes("consider") || value === "hold") return "good";
  if (value.includes("watch") || value.includes("review")) return "watch";
  if (value.includes("avoid") || value.includes("exit")) return "risk";
  if (value.includes("insufficient")) return "neutral";
  return "info";
}
