import { NextRequest, NextResponse } from "next/server";
import { processUnlocks } from "@/server/services/scheduler.service";
import {
  startTimer,
  recordCronSuccess,
  recordCronFailure,
  recordDeadLetter,
} from "@/lib/metrics";
import type { ApiResponse } from "@/types";
import { isAuthorizedCronRequest } from "@/server/cron-auth";
import { withErrorHandler } from "@/server/middleware";
import { requestLogger, getCorrelationId } from "@/lib/logger";

/** Ping a dead-man's-switch URL (e.g. Healthchecks.io / BetterUptime). */
async function pingHealthcheck(suffix = "") {
  const url = process.env.HEALTHCHECK_URL;
  if (!url) return;
  try {
    await fetch(`${url}${suffix}`, { method: "GET" });
  } catch (err) {
    // Non-fatal: healthcheck ping failure should never mask the actual result
    console.error("[cron] healthcheck ping failed", err);
  }
}

/**
 * Called by Vercel Cron or an external scheduler every minute.
 * Wrapped with `withErrorHandler` so every response carries a
 * request/correlation ID and is logged against it (#509).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const authHeader = req.headers.get("authorization");
  const log = requestLogger(getCorrelationId(req.headers));
  if (!isAuthorizedCronRequest(authHeader)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const elapsed = startTimer();

  try {
    const processed = await processUnlocks();
    const durationMs = elapsed();

    recordCronSuccess("cron/v1/unlock", durationMs, { processed });
    log.info({ processed, durationMs }, "[cron/v1/unlock] run complete");
    await pingHealthcheck(); // success ping

    return NextResponse.json<ApiResponse<{ processed: number; durationMs: number }>>({
      success: true,
      data: { processed, durationMs },
    });
  } catch (err) {
    const durationMs = elapsed();
    recordCronFailure("cron/v1/unlock", durationMs, err);
    await recordDeadLetter("cron/v1/unlock", durationMs, err);
    log.error({ err, durationMs }, "[cron/v1/unlock] run failed");
    await pingHealthcheck("/fail"); // failure ping
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Cron job failed" },
      { status: 500 }
    );
  }
});
