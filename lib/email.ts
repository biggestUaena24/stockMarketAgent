import { and, eq } from "drizzle-orm";
import { getReadyDb } from "@/db";
import {
  notificationDeliveries,
  recommendations,
  researchRuns,
} from "@/db/schema";
import { sha256, newId } from "./ids";
import { getRuntimeEnv } from "./runtime-env";

export type EmailDeliveryResult =
  | { status: "skipped"; reason: string }
  | { status: "sent"; providerMessageId: string | null }
  | { status: "failed"; reason: string };

export async function sendResearchRunEmail(
  ownerEmail: string,
  runId: string,
): Promise<EmailDeliveryResult> {
  const apiKey = getRuntimeEnv("RESEND_API_KEY");
  const destination = getRuntimeEnv("NOTIFICATION_EMAIL");
  if (!apiKey || !destination) {
    return {
      status: "skipped",
      reason: "Resend or notification email is not configured.",
    };
  }
  const db = await getReadyDb();
  const [run] = await db
    .select()
    .from(researchRuns)
    .where(
      and(
        eq(researchRuns.id, runId),
        eq(researchRuns.ownerEmail, ownerEmail),
      ),
    )
    .limit(1);
  if (!run) return { status: "failed", reason: "Research run not found." };
  const destinationHash = (await sha256(destination.toLowerCase())).slice(0, 32);
  const [existing] = await db
    .select()
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.runId, runId),
        eq(notificationDeliveries.channel, "email"),
        eq(notificationDeliveries.destinationHash, destinationHash),
      ),
    )
    .limit(1);
  if (existing?.status === "sent") {
    return {
      status: "sent",
      providerMessageId: existing.providerMessageId,
    };
  }
  const id = existing?.id ?? newId("notify");
  if (!existing) {
    await db.insert(notificationDeliveries).values({
      id,
      ownerEmail,
      runId,
      channel: "email",
      destinationHash,
      status: "sending",
    });
  } else {
    await db
      .update(notificationDeliveries)
      .set({ status: "sending", error: null })
      .where(eq(notificationDeliveries.id, id));
  }

  const rows = await db
    .select()
    .from(recommendations)
    .where(eq(recommendations.runId, runId));
  const siteUrl =
    getRuntimeEnv("NEXT_PUBLIC_SITE_URL") ??
    "https://cedar-tfsa-research.sites.openai.com";
  const label = run.slot === "morning" ? "Morning brief" : "Evening review";
  const subject = `Cedar ${label.toLowerCase()} · ${run.actualTime.slice(0, 10)}`;
  const recommendationHtml =
    rows.length > 0
      ? rows
          .slice(0, 8)
          .map(
            (row) => `<tr>
              <td style="padding:10px 0;border-bottom:1px solid #e5e1d8"><strong>${escapeHtml(row.canonicalSymbol)}</strong></td>
              <td style="padding:10px 0;border-bottom:1px solid #e5e1d8">${escapeHtml(row.action)}</td>
              <td style="padding:10px 0;border-bottom:1px solid #e5e1d8;text-align:right">${row.score === null ? "—" : Math.round(row.score)}</td>
            </tr>`,
          )
          .join("")
      : `<tr><td style="padding:14px 0">No complete research results were available.</td></tr>`;
  const html = `<!doctype html>
  <html><body style="margin:0;background:#f5f2eb;color:#1d2925;font:15px Arial,sans-serif">
    <div style="max-width:620px;margin:0 auto;padding:32px 20px">
      <div style="background:#173d32;color:#fff;border-radius:18px 18px 0 0;padding:24px 28px">
        <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#b9d0c6">Cedar · Calgary time</div>
        <h1 style="font-size:26px;margin:9px 0 5px">${label}</h1>
        <div style="color:#dbe7e2">${escapeHtml(run.dataFreshness)} data · ${escapeHtml(run.providerVersion)}</div>
      </div>
      <div style="background:#fff;border:1px solid #e5e1d8;border-top:0;border-radius:0 0 18px 18px;padding:25px 28px">
        <p style="margin-top:0"><strong>Research support only.</strong> Verify the current Wealthsimple quote and place any order manually. No result guarantees profit.</p>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr><th align="left">Symbol</th><th align="left">Status</th><th align="right">Score</th></tr></thead>
          <tbody>${recommendationHtml}</tbody>
        </table>
        <p style="margin:24px 0 0"><a href="${escapeHtml(siteUrl)}/reports" style="display:inline-block;background:#173d32;color:#fff;text-decoration:none;padding:11px 17px;border-radius:10px">Open the full evidence</a></p>
      </div>
      <p style="font-size:12px;color:#697770;line-height:1.5">The dashboard is the source of truth. Email is a concise notification and may omit caveats or source detail.</p>
    </div>
  </body></html>`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": `cedar-run-${runId}`,
      },
      body: JSON.stringify({
        from:
          getRuntimeEnv("RESEND_FROM_EMAIL") ??
          "Cedar Research <onboarding@resend.dev>",
        to: [destination],
        subject,
        html,
      }),
    });
    const payload = (await response.json()) as {
      id?: string;
      message?: string;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(
        payload.error?.message ??
          payload.message ??
          `Resend returned ${response.status}.`,
      );
    }
    await db
      .update(notificationDeliveries)
      .set({
        status: "sent",
        providerMessageId: payload.id ?? null,
        sentAt: new Date().toISOString(),
        error: null,
      })
      .where(eq(notificationDeliveries.id, id));
    return { status: "sent", providerMessageId: payload.id ?? null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Email failed.";
    await db
      .update(notificationDeliveries)
      .set({ status: "failed", error: reason.slice(0, 500) })
      .where(eq(notificationDeliveries.id, id));
    return { status: "failed", reason };
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
