import { requireApiOwner } from "@/lib/api-context";
import { errorResponse, readJson } from "@/lib/http";
import {
  createTransaction,
  listTransactions,
} from "@/lib/transactions";

export async function GET(request: Request) {
  const auth = requireApiOwner(request);
  if (!auth.ok) return auth.response;
  try {
    return Response.json({
      transactions: await listTransactions(auth.ownerEmail),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = requireApiOwner(request);
  if (!auth.ok) return auth.response;
  try {
    const payload = await readJson<Record<string, unknown>>(request);
    return Response.json(
      { transaction: await createTransaction(auth.ownerEmail, payload) },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
