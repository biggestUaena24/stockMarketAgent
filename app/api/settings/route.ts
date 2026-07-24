import { requireApiOwner } from "@/lib/api-context";
import { errorResponse, readJson } from "@/lib/http";
import {
  getOrCreateSettings,
  updateOwnerSettings,
} from "@/lib/settings";

export async function GET(request: Request) {
  const auth = requireApiOwner(request);
  if (!auth.ok) return auth.response;
  try {
    return Response.json({
      settings: await getOrCreateSettings(auth.ownerEmail),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const auth = requireApiOwner(request);
  if (!auth.ok) return auth.response;
  try {
    const payload = await readJson<Record<string, unknown>>(request);
    return Response.json({
      settings: await updateOwnerSettings(auth.ownerEmail, payload),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
