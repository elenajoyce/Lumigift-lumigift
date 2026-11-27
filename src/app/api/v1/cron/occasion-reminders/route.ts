import { NextRequest, NextResponse } from "next/server";
import { processOccasionReminders } from "@/server/services/occasion.service";
import type { ApiResponse } from "@/types";
import { isAuthorizedCronRequest } from "@/server/cron-auth";
import { withErrorHandler } from "@/server/middleware";
import { requestLogger, getCorrelationId } from "@/lib/logger";

const HEALTHCHECK_URL = process.env.HEALTHCHECK_URL_OCCASION_REMINDERS;

/**
 * Pings the configured Healthchecks.io URL to signal job completion.
 * Pings the base URL on success, or the `/fail` endpoint on error.
 * Failures to ping are logged but never thrown, so they cannot affect the
 * cron job's own response.
 */
const pingHealthcheck = async (failed: boolean): Promise<void> => {
  if (!HEALTHCHECK_URL) {
    return;
  }

  const url = failed ? `${HEALTHCHECK_URL.replace(/\/$/, "")}/fail` : HEALTHCHECK_URL;

  try {
    await fetch(url, { method: "GET" });
  } catch (err) {
    console.error("[cron/occasion-reminders] healthcheck ping failed", { error: err });
  }
};

/**
 * GET /api/v1/cron/occasion-reminders
 *
 * Called daily at 09:00 UTC by Vercel Cron (see vercel.json). Sends an SMS
 * reminder 7 days before each saved occasion with reminders enabled (issue #341).
 *
 * Wrapped with `withErrorHandler` so every response carries a
 * request/correlation ID and is logged against it (#509).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const log = requestLogger(getCorrelationId(req.headers));
  if (!isAuthorizedCronRequest(req.headers.get("authorization"))) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const sent = await processOccasionReminders();
    log.info({ sent }, "[cron/occasion-reminders] run complete");
    return NextResponse.json<ApiResponse<{ sent: number }>>({ success: true, data: { sent } });
  } catch (err) {
    log.error({ err }, "[cron/occasion-reminders] run failed");
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Occasion reminder job failed" },
      { status: 500 }
    );
  }
});
