import { redirect } from "next/navigation";
import {
  type ChatGPTUser,
  chatGPTSignInPath,
  getChatGPTUser,
} from "@/app/chatgpt-auth";
import {
  constantTimeEqual,
  evaluateOwnerStatus,
  normalizeEmail,
} from "./auth-policy";
import { getRuntimeEnv, isLocalDevelopment } from "./runtime-env";

const EMAIL_HEADER = "oai-authenticated-user-email";
const NAME_HEADER = "oai-authenticated-user-full-name";
const NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";

export type OwnerAccess =
  | { status: "authorized"; user: ChatGPTUser; localDemo: boolean }
  | { status: "owner_unconfigured"; user: ChatGPTUser }
  | { status: "forbidden"; user: ChatGPTUser }
  | { status: "unauthenticated"; user: null };

function configuredOwner(): string | null {
  return getRuntimeEnv("OWNER_EMAIL")
    ? normalizeEmail(getRuntimeEnv("OWNER_EMAIL")!)
    : null;
}

function localUser(): ChatGPTUser {
  return {
    displayName: "Local owner",
    email: "local-owner@localhost",
    fullName: "Local owner",
  };
}

function evaluateUser(user: ChatGPTUser | null): OwnerAccess {
  const status = evaluateOwnerStatus({
    userEmail: user?.email ?? null,
    configuredOwnerEmail: configuredOwner(),
    localDevelopment: isLocalDevelopment(),
  });
  if (status === "authorized" && !user) {
    return { status: "authorized", user: localUser(), localDemo: true };
  }
  if (status === "unauthenticated" || !user) {
    return { status: "unauthenticated", user: null };
  }
  if (status === "owner_unconfigured") {
    return { status: "owner_unconfigured", user };
  }
  if (status === "forbidden") return { status: "forbidden", user };
  return {
    status: "authorized",
    user,
    localDemo: false,
  };
}

export async function getOwnerPageAccess(): Promise<OwnerAccess> {
  return evaluateUser(await getChatGPTUser());
}

export async function requireOwnerPage(
  returnTo: string,
): Promise<Exclude<OwnerAccess, { status: "unauthenticated" }>> {
  const access = await getOwnerPageAccess();
  if (access.status === "unauthenticated") {
    redirect(chatGPTSignInPath(returnTo));
  }
  return access;
}

export function getRequestUser(request: Request): ChatGPTUser | null {
  const email = request.headers.get(EMAIL_HEADER);
  if (!email) return null;
  const encodedName = request.headers.get(NAME_HEADER);
  const fullName =
    encodedName &&
    request.headers.get(NAME_ENCODING_HEADER) === "percent-encoded-utf-8"
      ? safeDecode(encodedName)
      : null;
  return {
    email,
    fullName,
    displayName: fullName ?? email,
  };
}

export function getOwnerApiAccess(request: Request): OwnerAccess {
  return evaluateUser(getRequestUser(request));
}

export function ownerEmailFromAccess(
  access: OwnerAccess,
): string | null {
  return access.status === "authorized" ? access.user.email : null;
}

export function apiAuthFailure(access: OwnerAccess): Response | null {
  if (access.status === "authorized") return null;
  if (access.status === "unauthenticated") {
    return Response.json(
      { error: "Authentication required", code: "AUTH_REQUIRED" },
      { status: 401 },
    );
  }
  if (access.status === "owner_unconfigured") {
    return Response.json(
      {
        error: "The server-side owner allowlist is not configured.",
        code: "OWNER_UNCONFIGURED",
      },
      { status: 503 },
    );
  }
  return Response.json(
    { error: "This private research desk belongs to another owner." },
    { status: 403 },
  );
}

export function isValidMachineToken(request: Request): boolean {
  const expected = getRuntimeEnv("SCHEDULER_SECRET");
  if (!expected) return false;
  const supplied =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return constantTimeEqual(expected, supplied);
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
