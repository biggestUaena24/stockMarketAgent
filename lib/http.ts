export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "BAD_REQUEST",
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError("Request body must be valid JSON.");
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json(
      { error: error.message, code: error.code, details: error.details },
      { status: error.status },
    );
  }
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred.";
  console.error("API failure", error);
  return Response.json(
    { error: message, code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}

export function clampNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new ApiError(
      `${field} must be between ${minimum} and ${maximum}.`,
      400,
      "VALIDATION_ERROR",
      { field },
    );
  }
  return parsed;
}

export function cleanText(
  value: unknown,
  field: string,
  maximumLength = 300,
): string {
  if (typeof value !== "string") {
    throw new ApiError(`${field} is required.`, 400, "VALIDATION_ERROR", {
      field,
    });
  }
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!cleaned || cleaned.length > maximumLength) {
    throw new ApiError(
      `${field} must contain 1–${maximumLength} characters.`,
      400,
      "VALIDATION_ERROR",
      { field },
    );
  }
  return cleaned;
}
