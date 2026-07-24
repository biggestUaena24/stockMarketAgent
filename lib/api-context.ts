import {
  apiAuthFailure,
  getOwnerApiAccess,
  ownerEmailFromAccess,
} from "./auth";

export function requireApiOwner(
  request: Request,
):
  | { ok: true; ownerEmail: string }
  | { ok: false; response: Response } {
  const access = getOwnerApiAccess(request);
  const failure = apiAuthFailure(access);
  if (failure) return { ok: false, response: failure };
  return {
    ok: true,
    ownerEmail: ownerEmailFromAccess(access)!,
  };
}
