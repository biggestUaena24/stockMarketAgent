import { requireApiOwner } from "@/lib/api-context";
import { errorResponse, readJson } from "@/lib/http";
import {
  deleteTransaction,
  updateTransaction,
} from "@/lib/transactions";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const auth = requireApiOwner(request);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    const payload = await readJson<Record<string, unknown>>(request);
    return Response.json({
      transaction: await updateTransaction(auth.ownerEmail, id, payload),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  const auth = requireApiOwner(request);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    await deleteTransaction(auth.ownerEmail, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
