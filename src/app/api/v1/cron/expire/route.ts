import { NextRequest, NextResponse } from "next/server";
import { processExpiries } from "@/server/services/scheduler.service";
import {
  recordCronSuccess,
  recordCronFailure,
  recordDeadLetter,
} from "@/lib/metrics";
import type { ApiResponse } from "@/types";
import { isAuthorizedCronRequest } from "@/server/cron-auth";
import { withErrorHandler } from "@/server/middleware";
import { requestLogger, getCorrelationId } from "@/lib/logger";

/**
 * GET /api/v1/cron/expire
 *
 * Called daily at 02:00 UTC by Vercel Cron (see vercel.json).
 * Expires unlocked gifts that have been unclaimed for more than 365 days,
 * triggers a refund to the sender, and sends an SMS notification.
 *
 * Dead-man's-switch: pings HEALTHCHECK_URL_EXPIRE (or HEALTHCHECK_URL) on
 * success so operators are alerted if the daily cron stops firing.
 */

/** Ping a dead-man's-switch URL (e.g. Healthchecks.io / BetterUptime). */
async function pingHealthcheck(suffix = "") {
  const url = process.env.HEALTHCHECK_URL_EXPIRE ?? process.env.HEALTHCHECK_URL;
  if (!url) return;
  try {
    await fetch(`${url}${suffix}`, { method: "GET" });
  } catch (err) {
    console.error("[cron/expire] healthcheck ping failed", err);
  }
}

// Wrapped with `withErrorHandler` so every response carries a
// request/correlation ID and is logged against it (#509).
export const GET = withErrorHandler(async (req: NextRequest) => {
  const authHeader = req.headers.get("authorization");
  const log = requestLogger(getCorrelationId(req.headers));
  if (!isAuthorizedCronRequest(authHeader)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const startedAt = new Date();
  log.info({ startedAt }, "[cron/expire] run started");

  try {
    await processExpiries();
    const durationMs = Date.now() - startedAt.getTime();

    log.info({ durationMs }, "[cron/expire] run complete");

    await pingHealthcheck("expire"); // success ping

    return NextResponse.json<ApiResponse<{ message: string; durationMs: number }>>({
      success: true,
      data: { message: "Expiry check complete", durationMs },
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt.getTime();
    log.error({ startedAt, err }, "[cron/expire] run failed");
    recordCronFailure("cron/v1/expire", durationMs, err);
    await recordDeadLetter("cron/v1/expire", durationMs, err);
    await pingHealthcheck("expire", "/fail"); // failure ping
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Expiry job failed" },
      { status: 500 }
    );
  }
});
